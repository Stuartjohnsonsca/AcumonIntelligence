import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

type ScheduleVisibility = {
  requiresListed?: boolean;
  requiresEQR?: boolean;
  requiresPriorPeriod?: boolean;
  /** Only show if this IS a first-year audit (no prior-period engagement). Mutually exclusive with requiresPriorPeriod. */
  requiresFirstYear?: boolean;
};

type StageKeyedMapping = {
  planning: string[];
  fieldwork: string[];
  completion: string[];
  conditions: Record<string, ScheduleVisibility>;
};

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
  const out: StageKeyedMapping = { planning: [], fieldwork: [], completion: [], conditions: {} };
  for (const k of flat) {
    const m = master.find(s => s.key === k);
    const stage = (m?.defaultStage as 'planning' | 'fieldwork' | 'completion') || 'planning';
    out[stage].push(k);
  }
  return out;
}

function isStageKeyed(obj: any): obj is StageKeyedMapping {
  return obj && typeof obj === 'object' && !Array.isArray(obj) &&
         Array.isArray(obj.planning) && Array.isArray(obj.fieldwork) && Array.isArray(obj.completion);
}

export async function GET(req: Request) {
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
      where: { firmId, templateType: 'audit_type_schedules', auditType: '__framework_options' },
    }),
    prisma.methodologyRiskTable.findUnique({
      where: { firmId_tableType: { firmId, tableType: 'master_schedules' } },
    }),
  ]);

  const masterSchedules = (masterRow?.data as any)?.schedules || DEFAULT_MASTER_SCHEDULES;

  const stageKeyedMappings: Record<string, StageKeyedMapping> = {};
  // Backward-compat: also expose flat mappings (used by EngagementTabs until migrated)
  const mappings: Record<string, string[]> = {};

  for (const t of scheduleTemplates) {
    if (t.auditType === '__framework_options') continue;
    const raw = t.items as any;
    if (isStageKeyed(raw)) {
      stageKeyedMappings[t.auditType] = {
        planning: raw.planning || [],
        fieldwork: raw.fieldwork || [],
        completion: raw.completion || [],
        conditions: raw.conditions || {},
      };
      // Flat mapping is the concatenation in stage order — consumers that ignore stages just see everything
      mappings[t.auditType] = [...raw.planning, ...raw.fieldwork, ...raw.completion];
    } else if (Array.isArray(raw)) {
      // Old flat shape — upgrade on the fly (persist happens on next save)
      stageKeyedMappings[t.auditType] = upgradeFlatToStageKeyed(raw, masterSchedules);
      mappings[t.auditType] = raw;
    }
  }

  const frameworks: Record<string, string> = {};
  for (const t of frameworkTemplates) {
    const data = t.items as unknown;
    frameworks[t.auditType] = typeof data === 'string' ? data : (data as { framework?: string })?.framework || '';
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

  // Copy one audit type's mapping to another
  if (body.action === 'copy') {
    const { fromAuditType, toAuditType } = body;
    if (!fromAuditType || !toAuditType) {
      return NextResponse.json({ error: 'fromAuditType and toAuditType required' }, { status: 400 });
    }
    const source = await prisma.methodologyTemplate.findUnique({
      where: { firmId_templateType_auditType: { firmId, templateType: 'audit_type_schedules', auditType: fromAuditType } },
    });
    if (!source) return NextResponse.json({ error: 'Source audit type has no schedule config' }, { status: 404 });

    const copiedItems = JSON.parse(JSON.stringify(source.items));
    await prisma.methodologyTemplate.upsert({
      where: { firmId_templateType_auditType: { firmId, templateType: 'audit_type_schedules', auditType: toAuditType } },
      create: { firmId, templateType: 'audit_type_schedules', auditType: toAuditType, items: copiedItems },
      update: { items: copiedItems },
    });
    return NextResponse.json({ success: true });
  }

  // Save per-audit-type schedules
  const { auditType, schedules, stageKeyed, framework } = body;
  if (!auditType) {
    return NextResponse.json({ error: 'auditType required' }, { status: 400 });
  }

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
      firmId_templateType_auditType: { firmId, templateType: 'audit_type_schedules', auditType },
    },
    create: { firmId, templateType: 'audit_type_schedules', auditType, items: itemsToStore },
    update: { items: itemsToStore },
  });

  // Save framework if provided (not for __framework_options)
  if (auditType !== '__framework_options' && framework !== undefined) {
    await prisma.methodologyTemplate.upsert({
      where: {
        firmId_templateType_auditType: { firmId, templateType: 'audit_type_framework', auditType },
      },
      create: { firmId, templateType: 'audit_type_framework', auditType, items: { framework } as any },
      update: { items: { framework } as any },
    });
  }

  return NextResponse.json({ success: true });
}
