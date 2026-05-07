import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { uploadToInbox } from '@/lib/azure-blob';
import { processPdf } from '@/lib/pdf-to-images';
import { aiExtractProposals } from '@/lib/import-options/ai-extractor';
import {
  AI_POPULATE_EXCLUDED_TABS,
  type ImportOptionsState,
  type ImportSelection,
} from '@/lib/import-options/types';

const PRIOR_PERIOD_ARCHIVE_TAG = '__prior_period_archive__';

const ALLOWED_TAB_KEYS = [
  'opening', 'prior-period', 'permanent-file', 'ethics', 'continuance',
  'new-client', 'materiality', 'par', 'walkthroughs', 'documents',
  'outstanding', 'communication', 'tax-technical', 'subsequent-events',
];

// POST /api/engagements/[id]/import-options/upload
// Uploads a prior audit file (zip pre-expanded by client → File OR PDF),
// stores it as an AuditDocument tagged with the Prior Period archive
// marker, runs AI extraction, and creates an ImportExtractionProposal.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { id: true, firmId: true, clientId: true, importOptions: true },
  });
  if (!engagement || engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  }

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const originalName = (formData.get('originalName') as string) || file?.name || 'prior-audit-file';
  const selectionsRaw = (formData.get('selections') as string) || '[]';
  // sourceType: 'upload' (default — direct local file) | 'claude_cowork' (file
  // produced by a Claude Cowork session driving the user's browser).
  const sourceTypeRaw = (formData.get('sourceType') as string) || 'upload';
  const sourceType: 'upload' | 'claude_cowork' = sourceTypeRaw === 'claude_cowork' ? 'claude_cowork' : 'upload';
  const vendorLabel = (formData.get('vendorLabel') as string) || '';
  let selections: ImportSelection[] = [];
  try { selections = JSON.parse(selectionsRaw) as ImportSelection[]; } catch { /* ignore */ }
  if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const blobName = `documents/${engagement.clientId}/${engagementId}/${Date.now()}_prior_audit_${safeName}`;
  await uploadToInbox(blobName, buffer, file.type || 'application/octet-stream');

  // Tag the document so the Prior Period tab + Documents tab can find it.
  // For Claude Cowork the documentName carries the vendor label so the
  // audit trail makes the source clear ("Prior Period Archive — Claude
  // Cowork (MyWorkPapers) — engagement.zip").
  const docNamePrefix = sourceType === 'claude_cowork' && vendorLabel
    ? `Prior Period Archive — Claude Cowork (${vendorLabel})`
    : `Prior Period Archive`;
  const archiveDoc = await prisma.auditDocument.create({
    data: {
      engagementId,
      documentName: `${docNamePrefix} — ${originalName}`,
      storagePath: blobName,
      uploadedDate: new Date(),
      uploadedById: session.user.id,
      fileSize: file.size,
      mimeType: file.type || null,
      receivedByName: sourceType === 'claude_cowork' && vendorLabel ? `Claude Cowork (${vendorLabel})` : (session.user.name || session.user.email),
      receivedAt: new Date(),
      mappedItems: [PRIOR_PERIOD_ARCHIVE_TAG],
      usageLocation: 'Prior Period',
      documentType: 'Prior Period Audit File',
      source: sourceType === 'claude_cowork' ? 'Third Party' : 'Team',
    },
  });

  // Extract text — for PDF use processPdf, for zip we treat the bytes as-is
  // and let the AI handle whatever falls out (often nothing if it's a binary
  // zip — we don't fabricate content). User can still see the archive in the
  // Prior Period section even if extraction is empty.
  let textContent = '';
  if ((file.type || '').includes('pdf') || /\.pdf$/i.test(originalName)) {
    try {
      const pdf = await processPdf(buffer, 50);
      textContent = pdf.text || '';
    } catch (err) {
      console.warn('[import-options/upload] PDF text extraction failed:', err);
    }
  } else if (/\.(txt|csv|json|xml|md)$/i.test(originalName)) {
    textContent = buffer.toString('utf8');
  }

  // Decide which tab keys the AI may target. Always exclude RMM + TB
  // for the import flow too (the user's hard rule applies to current-year
  // population; we additionally apply it here to keep risk-related tabs
  // human-driven for the prior-period seed).
  const allowedTabKeys = ALLOWED_TAB_KEYS.filter(k => !AI_POPULATE_EXCLUDED_TABS.has(k));

  let extractionId: string | undefined;
  if (selections.includes('import_data') && textContent) {
    const proposalSourceLabel = sourceType === 'claude_cowork' && vendorLabel
      ? `${vendorLabel} (via Claude Cowork) — ${originalName}`
      : originalName;
    try {
      const result = await aiExtractProposals({ textContent, allowedTabKeys });
      const proposal = await prisma.importExtractionProposal.create({
        data: {
          engagementId,
          sourceType,
          sourceLabel: proposalSourceLabel,
          sourceArchiveDocumentId: archiveDoc.id,
          proposals: result.proposals as unknown as object,
          aiModel: result.model,
          rawAiResponse: result.rawAiResponse?.slice(0, 50000),
          status: 'pending',
          createdById: session.user.id,
        },
      });
      extractionId = proposal.id;
    } catch (err) {
      console.warn('[import-options/upload] AI extraction failed:', err);
      // Still create an empty proposal so the user sees the Review modal
      // and can dismiss it cleanly.
      const proposal = await prisma.importExtractionProposal.create({
        data: {
          engagementId,
          sourceType,
          sourceLabel: proposalSourceLabel,
          sourceArchiveDocumentId: archiveDoc.id,
          proposals: [],
          status: 'pending',
          createdById: session.user.id,
        },
      });
      extractionId = proposal.id;
    }
  }

  // Persist Import Options state so the modal does not re-open.
  const at = new Date().toISOString();
  const me = { userId: session.user.id, userName: session.user.name || session.user.email || null };
  const prev = (engagement.importOptions as ImportOptionsState | null) || null;
  const next: ImportOptionsState = {
    prompted: true,
    selections,
    source: {
      type: sourceType,
      sourceFileDocumentId: archiveDoc.id,
      vendorLabel: sourceType === 'claude_cowork' && vendorLabel ? vendorLabel : originalName,
    },
    byUserId: me.userId,
    byUserName: me.userName,
    at,
    status: extractionId ? 'extracted' : 'pending',
    extractionId,
    history: [
      ...(prev?.history || []),
      {
        event: 'uploaded',
        at,
        by: me,
        note: sourceType === 'claude_cowork' ? `Claude Cowork (${vendorLabel || 'unspecified vendor'}) — ${originalName}` : originalName,
      },
      ...(extractionId ? [{ event: 'extracted' as const, at, by: me }] : []),
    ],
  };
  await prisma.auditEngagement.update({
    where: { id: engagementId },
    data: { importOptions: next as unknown as object },
  });

  // If user asked for "Copy documents", do that now (synchronous because
  // it's just metadata — we copy AuditDocument rows from the prior
  // engagement, if there is one). The actual Prior-Period archive file
  // we just uploaded is also visible under the Prior Period folder.
  if (selections.includes('copy_documents')) {
    await copyDocumentsFromPriorEngagement(engagement.id, session.user.id);
  }

  return NextResponse.json({
    importOptions: next,
    extractionId,
    archiveDocumentId: archiveDoc.id,
  });
}

// Copy AuditDocument rows from the engagement's previous priorPeriodEngagement
// (if linked) into the current engagement, tagged with usageLocation='Prior
// Period' and a marker so they appear under the Prior Period Documents folder.
// Documents are CLONED (new rows) — the original blob storagePath is reused
// (read-only access), no copy of the binary is made.
async function copyDocumentsFromPriorEngagement(engagementId: string, userId: string) {
  const eng = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { priorPeriodEngagementId: true },
  });
  if (!eng?.priorPeriodEngagementId) return;
  const priorDocs = await prisma.auditDocument.findMany({
    where: { engagementId: eng.priorPeriodEngagementId, storagePath: { not: null } },
    take: 200,
  });
  for (const doc of priorDocs) {
    const existingTags = Array.isArray(doc.mappedItems) ? doc.mappedItems as string[] : [];
    await prisma.auditDocument.create({
      data: {
        engagementId,
        documentName: doc.documentName,
        storagePath: doc.storagePath,
        containerName: doc.containerName,
        fileSize: doc.fileSize,
        mimeType: doc.mimeType,
        uploadedDate: doc.uploadedDate,
        uploadedById: userId,
        receivedByName: 'Carried forward from prior period',
        receivedAt: new Date(),
        source: doc.source,
        usageLocation: 'Prior Period',
        documentType: doc.documentType,
        mappedItems: Array.from(new Set([...existingTags, '__prior_period_carried__'])),
      },
    });
  }
}
