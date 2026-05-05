import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  migrateOldToTriggers,
  isStageKeyed as isStageKeyedShared,
  type StageKeyedMapping,
  type OldCondition,
} from '@/lib/schedule-triggers';
import {
  pairKey,
  parsePairKey,
  isFrameworkOptionsKey,
  FRAMEWORK_OPTIONS_KEY,
  DEFAULT_FRAMEWORK,
} from '@/lib/audit-type-framework-key';

/**
 * Audit Type Configuration API.
 *
 * Storage: per-(auditType, framework) rows in `methodology_templates`,
 * keyed via the composite `<auditType>::<framework>` value in the
 * existing `audit_type` column. The framework-options sentinel row
 * (`__framework_options`) is preserved unchanged.
 *
 * GET: returns mappings keyed by composite (`SME::FRS102`), the firm's
 * configured frameworks, the framework option list, and the master
 * schedule list. Pre-migration rows that haven't been re-keyed yet are
 * surfaced under `<auditType>::FRS102` so the UI sees them under the
 * default framework slot.
 *
 * PUT: writes by composite key. Callers must pass `framework`; legacy
 * callers that omit it are treated as the default framework so existing
 * tooling keeps working through the rollout.
 */

const DEFAULT_MASTER_SCHEDULES = [
  { key: 'permanent_file_questions', label: 'Permanent File', defaultStage: 'planning' },
  { key: 'ethics_questions', label: 'Ethics', defaultStage: 'planning' },
  { key: 'continuance_questions', label: 'Continuance', defaultStage: 'planning' },
  { key: 'new_client_takeon_questions', label: 'New Client Take-On', defaultStage: 'planning' },
  { key: 'prior_period', label: 'Prior Period', defaultStage: 'planning' },
  { key: 'trial_balance', label: 'TBCYvPY', defaultStage: 'planning' },
  { key: 'materiality_questions', label: 'Materiality', defaultStage: 'planning' },
  { key: 'par', label: 'PAR', defaultStage: 'fieldwork' },
  { key: 'walkthroughs', label: 'Walkthroughs', defaultStage: 'fieldwork' },
  { key: 'rmm', label: 'Identifying & Assessing RMM', defaultStage: 'fieldwork' },
  { key: 'documents', label: 'Documents', defaultStage: 'fieldwork' },
  { key: 'communication', label: 'Communication', defaultStage: 'fieldwork' },
  { key: 'outstanding', label: 'Outstanding', defaultStage: 'completion' },
  { key: 'portal', label: 'Portal', defaultStage: 'completion' },
  { key: 'subsequent_events_questions', label: 'Subsequent Events', defaultStage: 'completion' },
  { key: 'tax_technical_categories', label: 'Tax Technical', defaultStage: 'completion' },
  // Completion sub-tabs (Part F — now first-class entries in the master list)
  { key: 'audit_summary_memo', label: 'Audit Summary Memo', defaultStage: 'completion' },
  { key: 'significant_risk_completion', label: 'Significant Risk (Completion)', defaultStage: 'completion' },
  { key: 'update_procedures', label: 'Update Procedures', defaultStage: 'completion' },
  { key: 'completion_checklist', label: 'Completion Checklist', defaultStage: 'completion' },
  { key: 'test_summary_results', label: 'Test Summary Results', defaultStage: 'completion' },
  { key: 'overall_review_fs', label: 'Overall Review of FS', defaultStage: 'completion' },
  { key: 'fs_review', label: 'FS Review', defaultStage: 'completion' },
  { key: 'adj_tb', label: 'Adj TB', defaultStage: 'completion' },
  { key: 'error_schedule', label: 'Error Schedule', defaultStage: 'completion' },
  { key: 'eqr_review', label: 'EQR Review', defaultStage: 'completion' },
];

// Back-compat: upgrade a flat ordered list to the new stage-keyed shape using each key's master defaultStage.
function upgradeFlatToStageKeyed(flat: string[], master: Array<{ key: string; defaultStage: string }>): StageKeyedMapping {
  const out: StageKeyedMapping = { planning: [], fieldwork: [], completion: [], triggers: [] };
  for (const k of flat) {
    const m = master.find(s => s.key === k);
    const stage = (m?.defaultStage as 'planning' | 'fieldwork' | 'completion') || 'planning';
    out[stage].push(k);
  }
  return out;
}

const isStageKeyed = isStageKeyedShared;

/** Resolve the composite key a row should be stored under. Pre-migration
 *  rows (no `::` separator) are normalised to the default framework so
 *  the new keying applies to old data immediately. */
function resolveStorageKey(rawAuditType: string): { auditType: string; framework: string } | null {
  if (isFrameworkOptionsKey(rawAuditType)) return null;
  const parsed = parsePairKey(rawAuditType);
  if (parsed) return parsed;
  return { auditType: rawAuditType, framework: DEFAULT_FRAMEWORK };
}

export async function GET(_req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const firmId = session.user.firmId;

  const [scheduleTemplates, frameworkTemplates, fwOptionsTemplate, masterRow] = await Promise.all([
    prisma.methodologyTemplate.findMany({
      where: { firmId, templateType: 'audit_type_schedules' },
    }),
    prisma.methodologyTemplate.findMany({
      where: { firmId, templateType: 'audit_type_framework' },
    }),
    prisma.methodologyTemplate.findFirst({
      where: { firmId, templateType: 'audit_type_schedules', auditType: FRAMEWORK_OPTIONS_KEY },
    }),
    prisma.methodologyRiskTable.findUnique({
      where: { firmId_tableType: { firmId, tableType: 'master_schedules' } },
    }),
  ]);

  const masterSchedules = (masterRow?.data as any)?.schedules || DEFAULT_MASTER_SCHEDULES;

  // Mappings are keyed by composite `<auditType>::<framework>` so the UI
  // and runtime can identify a single pair unambiguously. Legacy bare
  // rows are surfaced under the default framework so the admin sees
  // their previous config in the FRS102 slot until they re-save.
  const stageKeyedMappings: Record<string, StageKeyedMapping> = {};
  // Backward-compat: also expose flat mappings keyed by composite key.
  const mappings: Record<string, string[]> = {};

  for (const t of scheduleTemplates) {
    if (isFrameworkOptionsKey(t.auditType)) continue;
    const resolved = resolveStorageKey(t.auditType);
    if (!resolved) continue;
    const composite = pairKey(resolved.auditType, resolved.framework);

    const raw = t.items as any;
    if (isStageKeyed(raw)) {
      const loaded: StageKeyedMapping = {
        planning: raw.planning || [],
        fieldwork: raw.fieldwork || [],
        completion: raw.completion || [],
        triggers: Array.isArray(raw.triggers) ? raw.triggers : [],
        conditions: (raw.conditions as Record<string, OldCondition> | undefined) || undefined,
      };
      const migrated = migrateOldToTriggers(loaded);
      stageKeyedMappings[composite] = {
        ...migrated,
        conditions: raw.conditions || {},
      };
      mappings[composite] = [...loaded.planning, ...loaded.fieldwork, ...loaded.completion];
    } else if (Array.isArray(raw)) {
      stageKeyedMappings[composite] = upgradeFlatToStageKeyed(raw, masterSchedules);
      mappings[composite] = raw;
    }
  }

  // The frameworks map historically held one selected framework per
  // audit type (the "primary" framework dropdown). With pair-keyed
  // configuration that field is no longer load-bearing, but we keep
  // returning it so older clients that still consult it don't break.
  // Each entry's value is the framework portion of the most recently
  // updated audit_type_framework row for that audit type.
  const frameworks: Record<string, string> = {};
  for (const t of frameworkTemplates) {
    const resolved = resolveStorageKey(t.auditType);
    if (!resolved) continue;
    if (!frameworks[resolved.auditType]) frameworks[resolved.auditType] = resolved.framework;
  }

  const frameworkOptions = fwOptionsTemplate ? fwOptionsTemplate.items as string[] : [];

  return NextResponse.json({ mappings, stageKeyedMappings, frameworks, frameworkOptions, masterSchedules });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const firmId = session.user.firmId;

  // Save master schedule list
  if (body.action === 'save_master') {
    const { schedules } = body;
    if (!Array.isArray(schedules)) return NextResponse.json({ error: 'schedules array required' }, { status: 400 });

    await prisma.methodologyRiskTable.upsert({
      where: { firmId_tableType: { firmId, tableType: 'master_schedules' } },
      create: { firmId, tableType: 'master_schedules', data: { schedules } },
      update: { data: { schedules } },
    });

    return NextResponse.json({ success: true });
  }

  // Copy one (auditType, framework) pair's mapping to another
  if (body.action === 'copy') {
    const fromAuditType: string = body.fromAuditType;
    const toAuditType: string = body.toAuditType;
    const fromFramework: string = body.fromFramework || DEFAULT_FRAMEWORK;
    const toFramework: string = body.toFramework || DEFAULT_FRAMEWORK;
    if (!fromAuditType || !toAuditType) {
      return NextResponse.json({ error: 'fromAuditType and toAuditType required' }, { status: 400 });
    }
    const fromKey = pairKey(fromAuditType, fromFramework);
    const toKey = pairKey(toAuditType, toFramework);

    // Try the composite key first; fall back to the legacy bare key so
    // copies from un-migrated data still work.
    let source = await prisma.methodologyTemplate.findUnique({
      where: { firmId_templateType_auditType: { firmId, templateType: 'audit_type_schedules', auditType: fromKey } },
    });
    if (!source) {
      source = await prisma.methodologyTemplate.findUnique({
        where: { firmId_templateType_auditType: { firmId, templateType: 'audit_type_schedules', auditType: fromAuditType } },
      });
    }
    if (!source) return NextResponse.json({ error: 'Source pair has no schedule config' }, { status: 404 });

    const copiedItems = JSON.parse(JSON.stringify(source.items));
    await prisma.methodologyTemplate.upsert({
      where: { firmId_templateType_auditType: { firmId, templateType: 'audit_type_schedules', auditType: toKey } },
      create: { firmId, templateType: 'audit_type_schedules', auditType: toKey, items: copiedItems },
      update: { items: copiedItems },
    });
    return NextResponse.json({ success: true });
  }

  // Save per-pair schedules
  const rawAuditType: string | undefined = body.auditType;
  const framework: string = body.framework || DEFAULT_FRAMEWORK;
  const { schedules, stageKeyed } = body;
  if (!rawAuditType) {
    return NextResponse.json({ error: 'auditType required' }, { status: 400 });
  }

  // Special row — framework-options list — is stored under its sentinel
  // key, never composite. Everything else is composite.
  const storageKey = isFrameworkOptionsKey(rawAuditType) ? rawAuditType : pairKey(rawAuditType, framework);

  // Accept either the new stageKeyed shape OR the old flat schedules array
  let itemsToStore: any;
  if (stageKeyed && isStageKeyed(stageKeyed)) {
    itemsToStore = stageKeyed;
  } else if (Array.isArray(schedules)) {
    itemsToStore = schedules;
  } else {
    return NextResponse.json({ error: 'schedules or stageKeyed mapping required' }, { status: 400 });
  }

  await prisma.methodologyTemplate.upsert({
    where: {
      firmId_templateType_auditType: { firmId, templateType: 'audit_type_schedules', auditType: storageKey },
    },
    create: { firmId, templateType: 'audit_type_schedules', auditType: storageKey, items: itemsToStore },
    update: { items: itemsToStore },
  });

  // The audit_type_framework template historically tracked a selected
  // framework per audit type. With pair keying, that signal is implicit
  // in `storageKey`, but we still write a row so downstream consumers
  // (template-context legacy paths, etc.) keep seeing an explicit value.
  if (!isFrameworkOptionsKey(rawAuditType)) {
    await prisma.methodologyTemplate.upsert({
      where: {
        firmId_templateType_auditType: { firmId, templateType: 'audit_type_framework', auditType: storageKey },
      },
      create: { firmId, templateType: 'audit_type_framework', auditType: storageKey, items: { framework } as any },
      update: { items: { framework } as any },
    });
  }

  return NextResponse.json({ success: true });
}
