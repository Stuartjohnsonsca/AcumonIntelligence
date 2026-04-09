import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

const DEFAULT_MASTER_SCHEDULES = [
  { key: 'permanent_file_questions', label: 'Permanent File', stage: 'planning' },
  { key: 'ethics_questions', label: 'Ethics', stage: 'planning' },
  { key: 'continuance_questions', label: 'Continuance', stage: 'planning' },
  { key: 'new_client_takeon_questions', label: 'New Client Take-On', stage: 'planning' },
  { key: 'prior_period', label: 'Prior Period', stage: 'planning' },
  { key: 'trial_balance', label: 'TBCYvPY', stage: 'planning' },
  { key: 'materiality_questions', label: 'Materiality', stage: 'planning' },
  { key: 'par', label: 'PAR', stage: 'fieldwork' },
  { key: 'walkthroughs', label: 'Walkthroughs', stage: 'fieldwork' },
  { key: 'rmm', label: 'Identifying & Assessing RMM', stage: 'fieldwork' },
  { key: 'documents', label: 'Documents', stage: 'fieldwork' },
  { key: 'communication', label: 'Communication', stage: 'fieldwork' },
  { key: 'outstanding', label: 'Outstanding', stage: 'completion' },
  { key: 'portal', label: 'Portal', stage: 'completion' },
  { key: 'subsequent_events_questions', label: 'Subsequent Events', stage: 'completion' },
  { key: 'tax_technical_categories', label: 'Tax Technical', stage: 'completion' },
];

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

  const mappings: Record<string, string[]> = {};
  for (const t of scheduleTemplates) {
    if (t.auditType !== '__framework_options') {
      mappings[t.auditType] = t.items as string[];
    }
  }

  const frameworks: Record<string, string> = {};
  for (const t of frameworkTemplates) {
    const data = t.items as unknown;
    frameworks[t.auditType] = typeof data === 'string' ? data : (data as { framework?: string })?.framework || '';
  }

  const frameworkOptions = fwOptionsTemplate ? fwOptionsTemplate.items as string[] : [];

  // Master schedules
  const masterSchedules = (masterRow?.data as any)?.schedules || DEFAULT_MASTER_SCHEDULES;

  return NextResponse.json({ mappings, frameworks, frameworkOptions, masterSchedules });
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

  // Save per-audit-type schedules (existing behaviour)
  const { auditType, schedules, framework } = body;
  if (!auditType || !Array.isArray(schedules)) {
    return NextResponse.json({ error: 'auditType and schedules array required' }, { status: 400 });
  }

  // Save schedules
  await prisma.methodologyTemplate.upsert({
    where: {
      firmId_templateType_auditType: { firmId, templateType: 'audit_type_schedules', auditType },
    },
    create: { firmId, templateType: 'audit_type_schedules', auditType, items: schedules },
    update: { items: schedules },
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
