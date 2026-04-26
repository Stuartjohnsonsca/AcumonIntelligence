import { NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { getPermanentFileSignOffs, handlePermanentFileSignOff, handlePermanentFileUnsignOff, savePermanentFileFieldMeta } from '@/lib/signoff-handler';
import { columnExists } from '@/lib/prisma-column-exists';

// All AuditRMMRow columns that existed BEFORE the 2026-04-20 migration.
// Used to build an explicit select when the `source` column hasn't yet
// been added in production, so Prisma doesn't 500 the GET by asking
// for a column the DB doesn't have.
const RMM_ROW_SELECT_PRE_SOURCE = {
  id: true, engagementId: true, lineItem: true, lineType: true,
  riskIdentified: true, amount: true, assertions: true, relevance: true,
  complexityText: true, subjectivityText: true, changeText: true,
  uncertaintyText: true, susceptibilityText: true, inherentRiskLevel: true,
  aiSummary: true, isAiEdited: true, likelihood: true, magnitude: true,
  finalRiskAssessment: true, controlRisk: true, overallRisk: true,
  rowCategory: true, isHidden: true, isMandatory: true, notes: true,
  sortOrder: true, fsStatement: true, fsLevel: true, fsNote: true,
} satisfies Prisma.AuditRMMRowSelect;

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

/** Per-row Inherent Risk sub-component levels.
 *  Stored as a single auditPermanentFile entry with sectionKey 'rmm_ir_levels'
 *  to avoid a DB schema change. Shape:
 *  { [rowId]: { complexity?, subjectivity?, change?, uncertainty?, susceptibility? } }
 */
const IR_LEVELS_SECTION = 'rmm_ir_levels';

async function loadIrLevels(engagementId: string) {
  const row = await prisma.auditPermanentFile.findUnique({
    where: { engagementId_sectionKey: { engagementId, sectionKey: IR_LEVELS_SECTION } },
  }).catch(() => null);
  return ((row?.data as any) || {}) as Record<string, Record<string, string>>;
}

async function saveIrLevels(engagementId: string, levels: Record<string, Record<string, string>>) {
  await prisma.auditPermanentFile.upsert({
    where: { engagementId_sectionKey: { engagementId, sectionKey: IR_LEVELS_SECTION } },
    create: { engagementId, sectionKey: IR_LEVELS_SECTION, data: levels as object },
    update: { data: levels as object },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(req.url);
  if (url.searchParams.get('meta') === 'signoffs') {
    return getPermanentFileSignOffs(engagementId, 'rmm');
  }

  const hasSource = await columnExists('audit_rmm_rows', 'source');
  const [rawRows, irLevels] = await Promise.all([
    hasSource
      ? prisma.auditRMMRow.findMany({ where: { engagementId }, orderBy: { sortOrder: 'asc' } })
      : prisma.auditRMMRow.findMany({ where: { engagementId }, orderBy: { sortOrder: 'asc' }, select: RMM_ROW_SELECT_PRE_SOURCE }),
    loadIrLevels(engagementId),
  ]);
  const rows = hasSource ? rawRows : (rawRows as Array<Record<string, unknown>>).map(r => ({ ...r, source: null }));
  return NextResponse.json({ rows, irLevels });
}

export async function PUT(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  const body = await req.json();
  const { rows } = body as { rows: Array<Record<string, unknown>> };

  // Diagnostic — log every non-empty `riskIdentified` value we're about
  // to persist along with its row id + lineItem. Visible in Vercel logs
  // so we can trace whether the Nature column save is reaching the
  // server with the typed text intact. Only logs rows where
  // riskIdentified has actual content (so we don't swamp logs with the
  // 200+ untouched rows on every save).
  const natureSamples = rows
    .filter(r => typeof r.riskIdentified === 'string' && (r.riskIdentified as string).trim() !== '')
    .map(r => ({ id: r.id || '(new)', lineItem: r.lineItem, riskIdentified: r.riskIdentified }));
  if (natureSamples.length > 0) {
    console.log(
      `[RMM PUT] engagement=${engagementId} rows=${rows.length} natureRows=${natureSamples.length} sample=${JSON.stringify(natureSamples.slice(0, 5))}`,
    );
  } else {
    console.log(`[RMM PUT] engagement=${engagementId} rows=${rows.length} natureRows=0 (no riskIdentified values in body)`);
  }

  const existingIds = rows.filter(r => r.id).map(r => r.id as string);
  // Only delete non-mandatory rows that were removed
  await prisma.auditRMMRow.deleteMany({ where: { engagementId, id: { notIn: existingIds }, isMandatory: false } });

  const hasSource = await columnExists('audit_rmm_rows', 'source');

  // Per-row error isolation: a single bad row in the array (e.g. one
  // with a Prisma constraint violation, or stale client state pointing
  // at a row id that's been deleted) used to throw out of the loop and
  // 500 the whole PUT — including all the rows that came AFTER the
  // bad one. The user types Nature into row 50, autosave fires, row 5
  // fails, rows 6-210 (including row 50) never save. UI shows "Saved"
  // because the network round-trip "completed" (with an error), then
  // on reload the typed Nature is gone. This was the silent-data-loss
  // bug behind the "Nature column is not saved" report.
  //
  // Now: wrap each row's persist in try/catch, log failures with the
  // row id + lineItem so they're visible in Vercel logs, and continue
  // the loop. We also collect failures and surface them in the
  // response so useAutoSave's error-state can fire.
  type RowFailure = { id: string | null; lineItem: string | null; error: string };
  const failures: RowFailure[] = [];

  // Build the full data payload for one row. Pulled out so both the
  // update and create branches stay in sync — easy to forget a field
  // when adding new columns otherwise.
  function buildRowData(row: Record<string, unknown>) {
    const baseData = {
      lineItem: row.lineItem as string,
      lineType: (row.lineType as string) || 'fs_line',
      riskIdentified: row.riskIdentified as string || null,
      amount: row.amount != null ? Number(row.amount) : null,
      assertions: row.assertions ? (row.assertions as Prisma.InputJsonValue) : Prisma.JsonNull,
      relevance: row.relevance as string || null,
      complexityText: row.complexityText as string || null,
      subjectivityText: row.subjectivityText as string || null,
      changeText: row.changeText as string || null,
      uncertaintyText: row.uncertaintyText as string || null,
      susceptibilityText: row.susceptibilityText as string || null,
      inherentRiskLevel: row.inherentRiskLevel as string || null,
      aiSummary: row.aiSummary as string || null,
      isAiEdited: (row.isAiEdited as boolean) ?? false,
      likelihood: row.likelihood as string || null,
      magnitude: row.magnitude as string || null,
      finalRiskAssessment: row.finalRiskAssessment as string || null,
      controlRisk: row.controlRisk as string || null,
      overallRisk: row.overallRisk as string || null,
      rowCategory: (row.rowCategory as string) || null,
      isHidden: (row.isHidden as boolean) ?? false,
      sortOrder: (row.sortOrder as number) ?? 0,
    };
    return hasSource ? { ...baseData, source: (row.source as string) || null } : baseData;
  }

  // Parallelise the per-row writes in chunks of 20. The previous
  // serial loop awaited each prisma.update sequentially — at ~50ms per
  // network round-trip on a 210-row engagement that's 10+ seconds,
  // which is right on Vercel's 10s function timeout. The browser
  // would see a 504 and abandon the typed Nature value. Chunking
  // keeps total runtime under ~1s while staying within pgbouncer's
  // connection-limit guidance.
  //
  // Switched from update / create to UPSERT so a stale client-side
  // row id (deleted by another tab, or never persisted to begin with)
  // doesn't lose the user's edit — upsert creates the row if it
  // doesn't exist, otherwise updates.
  const CHUNK = 20;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await Promise.all(slice.map(async row => {
      try {
        const data = buildRowData(row);
        if (row.id) {
          // Upsert by id — idempotent. If the row vanished between
          // the client's last load and this save (e.g. another tab
          // deleted it), upsert creates it again with the same id.
          await prisma.auditRMMRow.upsert({
            where: { id: row.id as string },
            create: { id: row.id as string, engagementId, isMandatory: (row.isMandatory as boolean) ?? false, ...data },
            update: data,
          });
        } else {
          await prisma.auditRMMRow.create({ data: { engagementId, isMandatory: (row.isMandatory as boolean) ?? false, ...data } });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push({
          id: (row.id as string) || null,
          lineItem: (row.lineItem as string) || null,
          error: msg,
        });
        console.error(
          `[RMM PUT] Row failed — engagement=${engagementId} id=${row.id || '(new)'} lineItem="${row.lineItem || ''}" riskIdentified=${JSON.stringify(row.riskIdentified)}: ${msg}`,
        );
      }
    }));
  }

  const updated = hasSource
    ? await prisma.auditRMMRow.findMany({ where: { engagementId }, orderBy: { sortOrder: 'asc' } })
    : (await prisma.auditRMMRow.findMany({ where: { engagementId }, orderBy: { sortOrder: 'asc' }, select: RMM_ROW_SELECT_PRE_SOURCE })).map(r => ({ ...r, source: null }));
  // Return the fresh server view of every row plus the list of any
  // per-row failures. Status stays 200 so the autosave hook treats it
  // as a successful save (the user's edits that DID land should not
  // be marked as failed in the UI). When `failures` is non-empty the
  // server-side console.error gives auditors / operators a way to
  // diagnose; the UI can render it explicitly later if we need a
  // visible warning.
  return NextResponse.json({ rows: updated, failures });
}

export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  const body = await req.json();
  if (body.action === 'signoff') {
    return handlePermanentFileSignOff(engagementId, {
      engagementId,
      userId: session.user.id!,
      userName: session.user.name || session.user.email || 'Unknown',
      role: body.role,
    }, 'rmm');
  }
  if (body.action === 'unsignoff') {
    return handlePermanentFileUnsignOff(engagementId, session.user.id, body.role, 'rmm');
  }
  if (body.action === 'fieldMeta') {
    await savePermanentFileFieldMeta(engagementId, body.fieldMeta, 'rmm');
    return NextResponse.json({ success: true });
  }
  if (body.action === 'save_ir_levels') {
    // body.irLevels: { [rowId]: { complexity?, subjectivity?, change?, uncertainty?, susceptibility? } }
    if (!body.irLevels || typeof body.irLevels !== 'object') {
      return NextResponse.json({ error: 'irLevels object required' }, { status: 400 });
    }
    await saveIrLevels(engagementId, body.irLevels);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
