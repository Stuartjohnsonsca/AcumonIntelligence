// Server-side helper that takes an array of approved ProposalRow[] and
// writes them into the engagement's tab storage, tagging each affected
// field with __fieldmeta provenance so the UI renders an orange dashed
// surround.
//
// The function knows which Prisma model + storage shape each tabKey
// uses; unknown tabKeys are skipped (returned in `skipped` count).

import { prisma } from '@/lib/db';
import type { FieldProvenance, ProposalRow } from './types';
import type { Prisma, PrismaClient } from '@prisma/client';

export interface ApplyContext {
  userId: string;
  userName: string;
  source: FieldProvenance['source'];
}

export interface ApplyResult {
  applied: number;
  skipped: number;
  warnings: string[];
}

// Tab → model/section mapping for json-blob style storage. Each entry
// loads the row, merges fieldKey:value into data, also merges
// __fieldmeta[fieldKey] = provenance, and saves back.
type JsonBlobModel =
  | 'auditEthics'
  | 'auditContinuance'
  | 'auditNewClientTakeOn'
  | 'auditSubsequentEvents'
  | 'auditMateriality'
  | 'auditVatReconciliation'
  | 'auditTaxOnProfits';

const JSON_BLOB_TABS: Record<string, JsonBlobModel> = {
  ethics: 'auditEthics',
  continuance: 'auditContinuance',
  'new-client': 'auditNewClientTakeOn',
  'subsequent-events': 'auditSubsequentEvents',
  materiality: 'auditMateriality',
  // tax-technical and prior-period both store in AuditPermanentFile under
  // specific section keys — handled separately below.
};

// Tabs whose data lives in AuditPermanentFile rows keyed by sectionKey.
// The tabKey + (proposal.destination.sectionKey || tabKey) names the row.
const PF_BACKED_TABS = new Set([
  'opening',
  'permanent-file',
  'walkthroughs',
  'tax-technical',
  'outstanding',
  'prior-period',
]);

// Hard-excluded — these tabs may NOT be written by the import flow.
const FORBIDDEN_TABS = new Set(['rmm', 'tb']);

function buildProvenanceEntry(ctx: ApplyContext, sourceLocation?: string): FieldProvenance {
  return {
    source: ctx.source,
    byUserId: ctx.userId,
    byUserName: ctx.userName,
    at: new Date().toISOString(),
    sourceLocation,
  };
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
}

async function applyJsonBlobModel(
  modelName: JsonBlobModel,
  engagementId: string,
  rows: ProposalRow[],
  ctx: ApplyContext,
  warnings: string[],
): Promise<{ applied: number; skipped: number }> {
  if (rows.length === 0) return { applied: 0, skipped: 0 };
  // Use a typed model dispatch — we rely on these models all having
  // the same `findUnique({ where: { engagementId } })` + `upsert` shape,
  // which they do (see prisma/schema.prisma — AuditEthics et al.).
  const client = prisma as unknown as Record<string, {
    findUnique: (args: unknown) => Promise<{ data?: unknown } | null>;
    upsert: (args: unknown) => Promise<unknown>;
  }>;
  const model = client[modelName];

  const existing = await model.findUnique({ where: { engagementId } });
  const data = asObj(existing?.data);
  const fieldMeta = asObj(data.__fieldmeta);

  let applied = 0;
  let skipped = 0;
  for (const row of rows) {
    const fieldKey = row.destination.fieldKey;
    if (!fieldKey) {
      skipped += 1;
      warnings.push(`Skipped row in ${row.destination.tabKey}: missing fieldKey`);
      continue;
    }
    data[fieldKey] = row.proposedValue;
    fieldMeta[fieldKey] = buildProvenanceEntry(ctx, row.sourceLocation);
    applied += 1;
  }
  data.__fieldmeta = fieldMeta;

  await model.upsert({
    where: { engagementId },
    create: { engagementId, data: data as Prisma.JsonObject },
    update: { data: data as Prisma.JsonObject },
  });
  return { applied, skipped };
}

async function applyPermanentFileTab(
  tabKey: string,
  engagementId: string,
  rows: ProposalRow[],
  ctx: ApplyContext,
  warnings: string[],
): Promise<{ applied: number; skipped: number }> {
  // Group rows by sectionKey within this PF-backed tab. The applier
  // updates one AuditPermanentFile row per section. __fieldmeta lives
  // in a dedicated '__fieldmeta' section row on the same engagement
  // (the existing convention used by permanent-file/route.ts).
  const groups = new Map<string, ProposalRow[]>();
  for (const r of rows) {
    const sectionKey = r.destination.sectionKey || tabKey;
    if (!groups.has(sectionKey)) groups.set(sectionKey, []);
    groups.get(sectionKey)!.push(r);
  }

  let applied = 0;
  let skipped = 0;
  for (const [sectionKey, sectionRows] of groups) {
    const existing = await prisma.auditPermanentFile.findUnique({
      where: { engagementId_sectionKey: { engagementId, sectionKey } },
    });
    const data = asObj(existing?.data);
    for (const row of sectionRows) {
      const fieldKey = row.destination.fieldKey;
      if (!fieldKey) {
        skipped += 1;
        warnings.push(`Skipped PF row in ${tabKey}: missing fieldKey`);
        continue;
      }
      data[fieldKey] = row.proposedValue;
      applied += 1;
    }
    await prisma.auditPermanentFile.upsert({
      where: { engagementId_sectionKey: { engagementId, sectionKey } },
      create: { engagementId, sectionKey, data: data as Prisma.JsonObject },
      update: { data: data as Prisma.JsonObject },
    });
  }

  // Update the __fieldmeta section row.
  const metaExisting = await prisma.auditPermanentFile.findUnique({
    where: { engagementId_sectionKey: { engagementId, sectionKey: '__fieldmeta' } },
  });
  const metaData = asObj(metaExisting?.data);
  for (const row of rows) {
    if (!row.destination.fieldKey) continue;
    metaData[row.destination.fieldKey] = buildProvenanceEntry(ctx, row.sourceLocation) as unknown as Record<string, unknown>;
  }
  await prisma.auditPermanentFile.upsert({
    where: { engagementId_sectionKey: { engagementId, sectionKey: '__fieldmeta' } },
    create: { engagementId, sectionKey: '__fieldmeta', data: metaData as Prisma.JsonObject },
    update: { data: metaData as Prisma.JsonObject },
  });

  return { applied, skipped };
}

async function applyParRows(
  engagementId: string,
  rows: ProposalRow[],
  _ctx: ApplyContext,
  warnings: string[],
): Promise<{ applied: number; skipped: number }> {
  // PAR rows have explicit columns (priorYear, particulars, ...).
  // proposal.destination.column tells us which column to set; rowId
  // identifies the row by `particulars` text since AuditPARRow has no
  // natural import-side ID.
  let applied = 0;
  let skipped = 0;
  for (const row of rows) {
    const col = row.destination.column;
    const particulars = row.destination.rowId;
    if (!col || !particulars) {
      skipped += 1;
      warnings.push('Skipped PAR row: missing column or rowId');
      continue;
    }
    if (col !== 'priorYear' && col !== 'currentYear') {
      skipped += 1;
      warnings.push(`Skipped PAR row: unsupported column ${col}`);
      continue;
    }
    const existing = await prisma.auditPARRow.findFirst({
      where: { engagementId, particulars },
    });
    const numericVal = typeof row.proposedValue === 'number'
      ? row.proposedValue
      : (row.proposedValue !== null && row.proposedValue !== undefined && row.proposedValue !== ''
        ? Number(row.proposedValue)
        : null);
    if (Number.isNaN(numericVal as number)) {
      skipped += 1;
      warnings.push(`Skipped PAR row ${particulars}: non-numeric value`);
      continue;
    }
    if (existing) {
      await prisma.auditPARRow.update({
        where: { id: existing.id },
        data: { [col]: numericVal },
      });
    } else {
      await prisma.auditPARRow.create({
        data: { engagementId, particulars, [col]: numericVal },
      });
    }
    applied += 1;
  }
  return { applied, skipped };
}

export async function applyProposals(
  engagementId: string,
  proposals: ProposalRow[],
  ctx: ApplyContext,
): Promise<ApplyResult> {
  const live = proposals.filter(p => !p.deleted);
  const warnings: string[] = [];

  // Bucket rows by tabKey.
  const buckets = new Map<string, ProposalRow[]>();
  for (const p of live) {
    if (FORBIDDEN_TABS.has(p.destination.tabKey)) {
      warnings.push(`Forbidden tab ${p.destination.tabKey} — skipping`);
      continue;
    }
    if (!buckets.has(p.destination.tabKey)) buckets.set(p.destination.tabKey, []);
    buckets.get(p.destination.tabKey)!.push(p);
  }

  let applied = 0;
  let skipped = 0;
  for (const [tabKey, rows] of buckets) {
    if (JSON_BLOB_TABS[tabKey]) {
      const r = await applyJsonBlobModel(JSON_BLOB_TABS[tabKey], engagementId, rows, ctx, warnings);
      applied += r.applied; skipped += r.skipped;
    } else if (PF_BACKED_TABS.has(tabKey)) {
      const r = await applyPermanentFileTab(tabKey, engagementId, rows, ctx, warnings);
      applied += r.applied; skipped += r.skipped;
    } else if (tabKey === 'par') {
      const r = await applyParRows(engagementId, rows, ctx, warnings);
      applied += r.applied; skipped += r.skipped;
    } else {
      // Unknown tab — count all rows as skipped.
      skipped += rows.length;
      warnings.push(`Unknown tab ${tabKey} — skipped ${rows.length} row(s)`);
    }
  }

  return { applied, skipped, warnings };
}
