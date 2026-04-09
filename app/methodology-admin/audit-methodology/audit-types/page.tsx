import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { AuditTypeSchedulesClient } from '@/components/methodology-admin/AuditTypeSchedulesClient';
import { BackButton } from '@/components/methodology-admin/BackButton';

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

export default async function AuditTypesPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) redirect('/login');
  if (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin) redirect('/my-account');

  const firmId = session.user.firmId;

  const [templates, fwTemplates, masterRow] = await Promise.all([
    prisma.methodologyTemplate.findMany({
      where: { firmId, templateType: 'audit_type_schedules' },
    }),
    prisma.methodologyTemplate.findMany({
      where: { firmId, templateType: 'audit_type_framework' },
    }),
    prisma.methodologyRiskTable.findUnique({
      where: { firmId_tableType: { firmId, tableType: 'master_schedules' } },
    }).catch(() => null),
  ]);

  const mappings: Record<string, string[]> = {};
  let frameworkOptions: string[] = [];

  for (const t of templates) {
    if (t.auditType === '__framework_options') {
      frameworkOptions = t.items as string[];
    } else {
      mappings[t.auditType] = t.items as string[];
    }
  }

  const frameworks: Record<string, string> = {};
  for (const t of fwTemplates) {
    frameworks[t.auditType] = (t.items as unknown as { framework: string })?.framework || '';
  }

  const masterSchedules = (masterRow?.data as any)?.schedules || DEFAULT_MASTER_SCHEDULES;

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <BackButton href="/methodology-admin/audit-methodology" label="Back to Audit Methodology" />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Audit Type Configuration</h1>
        <p className="text-slate-600 mt-1">Configure accounting frameworks, master schedule list, and schedule selection per audit type</p>
      </div>
      <AuditTypeSchedulesClient
        firmId={firmId}
        initialMappings={mappings}
        initialFrameworks={frameworks}
        initialFrameworkOptions={frameworkOptions.length > 0 ? frameworkOptions : undefined}
        initialMasterSchedules={masterSchedules}
      />
    </div>
  );
}
