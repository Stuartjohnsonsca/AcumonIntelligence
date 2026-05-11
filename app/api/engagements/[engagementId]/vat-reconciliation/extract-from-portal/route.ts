import { NextRequest, NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { extractVatReturnsFromUploads, mergeExtractionsIntoPeriodRows } from '@/lib/vat-returns-extractor';
import { deleteBlob } from '@/lib/azure-blob';
import type { VatPeriodRow, VatRecData } from '@/lib/vat-reconciliation';

/**
 * POST /api/engagements/[engagementId]/vat-reconciliation/extract-from-portal
 *
 * Manual recovery path for VAT returns that the client uploaded via
 * the portal but didn't make it into the reconciliation grid — e.g.
 * because the auditor hasn't pressed "Commit" on the portal request
 * (which is what triggers the existing auto-extract on commit), or
 * because the auto-extract fired but silently failed (e.g. the AI
 * call timed out).
 *
 * Behaviour:
 *   1. Find every portal request on this engagement with
 *      section='vat_returns', regardless of status — we re-process
 *      uploads even on already-committed requests so the auditor
 *      can "re-pull" if they need to.
 *   2. Collect every PortalUpload attached to those requests.
 *   3. Run the same lib/vat-returns-extractor pipeline used by the
 *      commit-time auto-extract: download each PDF from Azure Blob,
 *      run processPdf, call Together AI Llama with the strict-JSON
 *      VAT-return prompt, and merge into the engagement's
 *      audit_vat_reconciliations.data.periodRows by closest
 *      periodEnding date.
 *   4. DELETE the uploaded files. The PDFs have done their job —
 *      figures are now in periodRows where the auditor will edit
 *      them going forward. Deleting (PortalUpload rows + Azure
 *      blobs) keeps storage clean and stops the same file being
 *      re-imported on a subsequent click. Failures here are
 *      non-fatal — extraction still completes; we just log.
 *
 * Response: { periodRows, report, deletedUploadCount }
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (engagement.firmId !== session.user.firmId && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 1. Find VAT-returns portal requests for this engagement.
  const requests = await prisma.portalRequest.findMany({
    where: { engagementId, section: 'vat_returns' },
    select: { id: true, status: true },
  });
  if (requests.length === 0) {
    return NextResponse.json({
      error: 'No VAT-returns portal requests found for this engagement. Send one first via the "Request VAT returns via portal" button.',
    }, { status: 412 });
  }

  // 2. Collect uploads across all those requests. Tolerant of one
  //    request having no uploads — only those with files contribute.
  const uploads = await prisma.portalUpload.findMany({
    where: { portalRequestId: { in: requests.map(r => r.id) } },
    select: {
      id: true,
      portalRequestId: true,
      storagePath: true,
      containerName: true,
      originalName: true,
    },
  });
  if (uploads.length === 0) {
    return NextResponse.json({
      error: 'No files have been uploaded by the client yet. Once the client uploads their VAT returns via the portal, re-run this extract.',
    }, { status: 412 });
  }

  // 3. Run extraction. Returns one structured result per upload
  //    (empty fields where the AI couldn't parse the PDF).
  const extractions = await extractVatReturnsFromUploads(uploads);

  // 4. Load existing audit_vat_reconciliations.data + periodRows so
  //    we can merge results in place without clobbering bank
  //    verifications, mappings, opening row, conclusion, etc.
  const existingRow = await (prisma as any).auditVatReconciliation?.findUnique({
    where: { engagementId },
  });
  const baseData = (existingRow?.data && typeof existingRow.data === 'object' && !Array.isArray(existingRow.data))
    ? existingRow.data as unknown as VatRecData
    : null;
  const existingRows: VatPeriodRow[] = baseData?.periodRows ?? [];
  if (existingRows.length === 0) {
    return NextResponse.json({
      error: 'No period rows generated yet — open the VAT Reconciliation panel once so the schedule is built, then retry the extract.',
    }, { status: 412 });
  }

  const { rows: nextRows, report } = mergeExtractionsIntoPeriodRows(existingRows, extractions);

  // 5. Persist the patched periodRows.
  const mergedData: VatRecData = {
    ...(baseData ?? { ratesConsistent: null, revenueMappings: {}, periodRows: [], bankVerifications: [], tbVatRows: [] }),
    periodRows: nextRows,
  };
  try {
    await (prisma as any).auditVatReconciliation?.upsert({
      where: { engagementId },
      create: { id: crypto.randomUUID(), engagementId, data: mergedData as unknown as object },
      update: { data: mergedData as unknown as object },
    });
  } catch (err) {
    console.error('[vat-extract/portal] persist failed:', err);
    return NextResponse.json({
      error: `Extraction succeeded but persistence failed: ${err instanceof Error ? err.message : 'unknown error'}. Period rows in the response can be re-saved manually.`,
      periodRows: nextRows,
      report,
    }, { status: 500 });
  }

  // 6. Delete the source uploads. PDFs have served their purpose —
  //    figures are in periodRows now. Non-fatal: any failed deletes
  //    log but don't abort. Sequential to keep Azure throttling
  //    predictable; uploads counts are tiny (~1-12 per engagement).
  let deletedUploadCount = 0;
  for (const u of uploads) {
    try {
      await deleteBlob(u.storagePath, u.containerName || 'upload-inbox');
    } catch (err) {
      console.warn(`[vat-extract/portal] blob delete failed for ${u.originalName}:`, err instanceof Error ? err.message : err);
    }
    try {
      await prisma.portalUpload.delete({ where: { id: u.id } });
      deletedUploadCount++;
    } catch (err) {
      console.warn(`[vat-extract/portal] PortalUpload row delete failed for ${u.originalName}:`, err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({
    periodRows: nextRows,
    report,
    deletedUploadCount,
    sourceLabel: 'Portal',
  });
}
