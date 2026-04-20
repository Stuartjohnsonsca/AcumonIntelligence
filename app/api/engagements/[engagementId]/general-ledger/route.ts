import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { uploadToInbox, CONTAINERS, generateSasUrl } from '@/lib/azure-blob';
import { parseGlCsv, parseGlExcel, aggregateGlByAccount, type GlLine } from '@/lib/general-ledger-parser';
import { validateTbAgainstGl, type TbRowForValidation } from '@/lib/general-ledger-validator';

const SECTION_KEY = 'general_ledger';
// Reviewer-asserted agreement overrides — TB row IDs that the auditor
// has manually reconciled via the GL Reconcile modal. Stored separately
// from the main GL metadata so we can wipe it cleanly when a fresh
// G/L is uploaded (a new GL invalidates prior reconciliations).
//
// Data shape:
//   { groups: Array<{ rowIds, delta, tolerance, at, byName, byId }>,
//     updatedAt, updatedByName, updatedById }
// rowIds is derived = flat union across groups. Each group records
// the delta accepted at commit time (how many £'s the auditor let
// through under tolerance) so we can display a cumulative tolerance
// total alongside the count of reconciled rows.
const OVERRIDES_SECTION_KEY = 'general_ledger_overrides';

interface OverrideGroup {
  rowIds: string[];
  delta: number;      // signed delta in £ at commit time
  tolerance: number;  // absolute tolerance in £ the reviewer set
  at: string;
  byName?: string | null;
  byId?: string | null;
}

interface OverridesData {
  groups: OverrideGroup[];
  updatedAt?: string;
  updatedByName?: string | null;
  updatedById?: string | null;
}

async function loadOverridesData(engagementId: string): Promise<OverridesData> {
  const row = await prisma.auditPermanentFile.findUnique({
    where: { engagementId_sectionKey: { engagementId, sectionKey: OVERRIDES_SECTION_KEY } },
  }).catch(() => null);
  const raw = (row?.data as any) || {};
  const groups: OverrideGroup[] = Array.isArray(raw?.groups)
    ? (raw.groups as any[]).filter(g => Array.isArray(g?.rowIds)).map(g => ({
        rowIds: (g.rowIds as string[]).filter(Boolean),
        delta: Number(g.delta) || 0,
        tolerance: Number(g.tolerance) || 0,
        at: typeof g.at === 'string' ? g.at : new Date().toISOString(),
        byName: g.byName ?? null,
        byId: g.byId ?? null,
      }))
    // Back-compat with the old flat rowIds shape — promote to a single
    // zero-delta group so the override rows still force-green.
    : Array.isArray(raw?.rowIds)
    ? [{ rowIds: (raw.rowIds as string[]).filter(Boolean), delta: 0, tolerance: 0, at: raw.updatedAt || new Date().toISOString(), byName: raw.updatedByName ?? null, byId: raw.updatedById ?? null }]
    : [];
  return {
    groups,
    updatedAt: raw.updatedAt,
    updatedByName: raw.updatedByName ?? null,
    updatedById: raw.updatedById ?? null,
  };
}

function overrideRowIds(data: OverridesData): Set<string> {
  const s = new Set<string>();
  for (const g of data.groups) for (const id of g.rowIds) s.add(id);
  return s;
}

function cumulativeToleranceError(data: OverridesData): number {
  let t = 0;
  for (const g of data.groups) t += Math.abs(g.delta);
  return t;
}

async function saveOverridesData(engagementId: string, data: OverridesData, byName?: string | null, byId?: string | null) {
  const toWrite: OverridesData = {
    ...data,
    updatedAt: new Date().toISOString(),
    updatedByName: byName ?? data.updatedByName ?? null,
    updatedById: byId ?? data.updatedById ?? null,
  };
  await prisma.auditPermanentFile.upsert({
    where: { engagementId_sectionKey: { engagementId, sectionKey: OVERRIDES_SECTION_KEY } },
    create: { engagementId, sectionKey: OVERRIDES_SECTION_KEY, data: toWrite as object },
    update: { data: toWrite as object },
  });
}

interface GlMetadata {
  storagePath?: string;
  fileName?: string;
  mimeType?: string;
  uploadedAt?: string;
  uploadedById?: string;
  uploadedByName?: string;
  parsedAt?: string;
  parsedSummary?: {
    totalRows: number;
    inPeriodCount: number;
    outOfPeriodCount: number;
    missingDateCount: number;
    matchedColumns: { date: string; accountCode: string; amount: string };
    warnings: string[];
    byAccount: Record<string, number>;
  };
  portalRequestId?: string | null;
}

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, clientId: true, period: { select: { startDate: true, endDate: true } } },
  });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

async function loadMetadata(engagementId: string): Promise<GlMetadata> {
  const row = await prisma.auditPermanentFile.findUnique({
    where: { engagementId_sectionKey: { engagementId, sectionKey: SECTION_KEY } },
  }).catch(() => null);
  return ((row?.data as any) || {}) as GlMetadata;
}

async function saveMetadata(engagementId: string, meta: GlMetadata) {
  await prisma.auditPermanentFile.upsert({
    where: { engagementId_sectionKey: { engagementId, sectionKey: SECTION_KEY } },
    create: { engagementId, sectionKey: SECTION_KEY, data: meta as object },
    update: { data: meta as object },
  });
}

// GET — return current G/L metadata + a fresh validation against current TB rows
export async function GET(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  const engagement = await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!engagement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const meta = await loadMetadata(engagementId);
  let downloadUrl: string | null = null;
  try {
    if (meta.storagePath) {
      downloadUrl = generateSasUrl(meta.storagePath, CONTAINERS.INBOX, 30);
    }
  } catch { /* ignore — download URL is optional */ }

  // Validate TB against the stored GL summary, if present. Any row IDs
  // in the overrides set have been manually reconciled by the auditor
  // and are force-marked green — the raw calculation stays in the
  // tooltip so reviewers can see what was asserted.
  let checks: ReturnType<typeof validateTbAgainstGl> = [];
  const overridesData = await loadOverridesData(engagementId);
  const overrideIds = overrideRowIds(overridesData);
  const toleranceError = cumulativeToleranceError(overridesData);
  if (meta.parsedSummary?.byAccount) {
    const tbRows = await prisma.auditTBRow.findMany({
      where: { engagementId },
      select: { id: true, accountCode: true, description: true, fsStatement: true, fsLevel: true, currentYear: true, priorYear: true },
    });
    checks = validateTbAgainstGl(tbRows as TbRowForValidation[], meta.parsedSummary.byAccount);
    for (const c of checks) {
      if (overrideIds.has(c.rowId) && c.status !== 'green') {
        c.status = 'green';
        c.message = `Reconciled by auditor — original check: ${c.message}`;
      }
    }
  }

  return NextResponse.json({
    metadata: meta,
    downloadUrl,
    checks,
    byAccount: meta.parsedSummary?.byAccount || {},
    overrides: Array.from(overrideIds),
    toleranceError,
    overrideGroups: overridesData.groups,
    period: engagement.period,
  });
}

// POST — upload, request, parse, or clear
export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  const engagement = await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!engagement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const contentType = req.headers.get('content-type') || '';

  // Multipart upload — file picker on the modal
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'file field required' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = (file.name || 'general-ledger').replace(/[^a-zA-Z0-9._-]/g, '_');
    const isExcel = /\.xlsx?$/i.test(fileName) || file.type.includes('spreadsheet') || file.type.includes('excel');
    const isCsv = /\.csv$/i.test(fileName) || file.type.includes('csv');

    if (!isExcel && !isCsv) {
      return NextResponse.json({ error: 'Unsupported file type — please upload CSV or Excel' }, { status: 400 });
    }

    // Fetch the engagement's TB account codes up front. The parser uses
    // them as a column-detection hint — the column whose values match
    // real TB codes is by far the most reliable signal for "this is the
    // Account column", beating generic shape-based heuristics that can
    // confuse transaction-ids / reference numbers with account codes.
    const tbCodesForHint = await prisma.auditTBRow.findMany({
      where: { engagementId },
      select: { accountCode: true },
    });
    const hintedAccountCodes = tbCodesForHint
      .map(r => r.accountCode)
      .filter((c): c is string => !!c);

    // Parse first so we don't store a file we can't make sense of
    let parsed;
    try {
      parsed = isExcel
        ? await parseGlExcel(buffer, { hintedAccountCodes })
        : parseGlCsv(buffer, { hintedAccountCodes });
    } catch (err: any) {
      return NextResponse.json({ error: `Parse failed: ${err?.message || 'unknown'}` }, { status: 400 });
    }

    // Upload to blob
    const storagePath = `general-ledger/${engagementId}/${Date.now()}_${fileName}`;
    await uploadToInbox(storagePath, buffer, file.type || (isExcel ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv'));

    // Aggregate using engagement period
    const ps = engagement.period?.startDate || null;
    const pe = engagement.period?.endDate || null;
    const agg = aggregateGlByAccount(parsed.lines, ps, pe);

    const previous = await loadMetadata(engagementId);
    const meta: GlMetadata = {
      ...previous,
      storagePath,
      fileName: file.name || fileName,
      mimeType: file.type || (isExcel ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv'),
      uploadedAt: new Date().toISOString(),
      uploadedById: session.user.id,
      uploadedByName: session.user.name || session.user.email || 'Unknown',
      parsedAt: new Date().toISOString(),
      parsedSummary: {
        totalRows: parsed.totalRows,
        inPeriodCount: agg.inPeriodCount,
        outOfPeriodCount: agg.outOfPeriodCount,
        missingDateCount: agg.missingDateCount,
        matchedColumns: parsed.matchedColumns,
        warnings: parsed.warnings,
        byAccount: agg.byAccount,
      },
    };
    await saveMetadata(engagementId, meta);
    // A new GL invalidates all prior reconciliations — the auditor's
    // "agreed" assertion was made against old numbers.
    await saveOverridesData(engagementId, { groups: [] }, session.user.name, session.user.id);

    // Run validation immediately so the response has fresh dots
    const tbRows = await prisma.auditTBRow.findMany({
      where: { engagementId },
      select: { id: true, accountCode: true, description: true, fsStatement: true, fsLevel: true, currentYear: true, priorYear: true },
    });
    const checks = validateTbAgainstGl(tbRows as TbRowForValidation[], agg.byAccount);

    return NextResponse.json({ metadata: meta, checks });
  }

  // JSON actions — request from client, clear, etc.
  const body = await req.json();

  if (body.action === 'request') {
    // Create a portal request that the client can respond to with the GL file
    // section MUST be one of the portal's recognised section values
    // (see components/portal/OutstandingTab.tsx SECTIONS). Anything else is
    // silently dropped from the portal UI even though the row exists in DB.
    // The G/L is evidence, so it lives in the Evidence section card; the
    // 'general_ledger' evidenceTag categorises it within that card.
    const portalRequest = await prisma.portalRequest.create({
      data: {
        clientId: engagement.clientId,
        engagementId,
        requestedById: session.user.id,
        requestedByName: session.user.name || session.user.email || 'Audit Team',
        section: 'evidence',
        // Title-style prefix in question — surfaces in the portal as the request label.
        question: body.message || '[General Ledger] Please upload the General Ledger for the audit period — full transaction listing per account (date, account code, debit, credit).',
        evidenceTag: 'general_ledger',
        status: 'outstanding',
      },
    });

    const meta = await loadMetadata(engagementId);
    meta.portalRequestId = portalRequest.id;
    await saveMetadata(engagementId, meta);

    return NextResponse.json({ portalRequest, metadata: meta });
  }

  if (body.action === 'clear') {
    await saveMetadata(engagementId, {});
    await saveOverridesData(engagementId, { groups: [] }, session.user.name, session.user.id);
    return NextResponse.json({ success: true });
  }

  // Reconcile — record that the auditor has asserted a group of TB
  // rows agrees to the GL (after manually grouping/tagging across the
  // Reconcile modal). The rowIds are added to the override set and
  // their dots flip to green on the next GET / refresh. The delta +
  // tolerance used are captured on the group so we can display a
  // cumulative "tolerance error" total across the engagement.
  if (body.action === 'reconcile') {
    const rowIds = Array.isArray(body.rowIds) ? (body.rowIds as string[]).filter(id => typeof id === 'string' && id) : [];
    if (rowIds.length === 0) return NextResponse.json({ error: 'rowIds required' }, { status: 400 });
    const delta = Number.isFinite(Number(body.delta)) ? Number(body.delta) : 0;
    const tolerance = Number.isFinite(Number(body.tolerance)) ? Math.abs(Number(body.tolerance)) : 0;
    const current = await loadOverridesData(engagementId);
    // Detach any rowIds that were already reconciled under a previous
    // group — the new commit supersedes them.
    for (const g of current.groups) g.rowIds = g.rowIds.filter(id => !rowIds.includes(id));
    current.groups = current.groups.filter(g => g.rowIds.length > 0);
    current.groups.push({
      rowIds,
      delta,
      tolerance,
      at: new Date().toISOString(),
      byName: session.user.name || null,
      byId: session.user.id || null,
    });
    await saveOverridesData(engagementId, current, session.user.name, session.user.id);
    return NextResponse.json({
      success: true,
      overrides: Array.from(overrideRowIds(current)),
      toleranceError: cumulativeToleranceError(current),
    });
  }

  if (body.action === 'unreconcile') {
    const rowIds = Array.isArray(body.rowIds) ? (body.rowIds as string[]).filter(id => typeof id === 'string' && id) : [];
    if (rowIds.length === 0) return NextResponse.json({ error: 'rowIds required' }, { status: 400 });
    const current = await loadOverridesData(engagementId);
    // Remove any group that contained any of the given rowIds — the
    // group's delta is no longer applicable once part of it is undone.
    const toRemove = new Set<number>();
    current.groups.forEach((g, i) => {
      if (g.rowIds.some(id => rowIds.includes(id))) toRemove.add(i);
    });
    current.groups = current.groups.filter((_, i) => !toRemove.has(i));
    await saveOverridesData(engagementId, current, session.user.name, session.user.id);
    return NextResponse.json({
      success: true,
      overrides: Array.from(overrideRowIds(current)),
      toleranceError: cumulativeToleranceError(current),
    });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
