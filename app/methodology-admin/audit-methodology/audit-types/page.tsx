import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { AuditTypeSchedulesClient } from '@/components/methodology-admin/AuditTypeSchedulesClient';
import { BackButton } from '@/components/methodology-admin/BackButton';

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
  // Part F — Completion sub-tabs as first-class schedules
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
  const stageKeyedMappings: Record<string, any> = {};
  let frameworkOptions: string[] = [];

  for (const t of templates) {
    if (t.auditType === '__framework_options') {
      frameworkOptions = t.items as string[];
    } else {
      const raw = t.items as any;
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray(raw.planning)) {
        stageKeyedMappings[t.auditType] = raw;
        mappings[t.auditType] = [...raw.planning, ...raw.fieldwork, ...raw.completion];
      } else if (Array.isArray(raw)) {
        mappings[t.auditType] = raw as string[];
      }
    }
  }

  const frameworks: Record<string, string> = {};
  for (const t of fwTemplates) {
    frameworks[t.auditType] = (t.items as unknown as { framework: string })?.framework || '';
  }

  const masterSchedules = (masterRow?.data as any)?.schedules || DEFAULT_MASTER_SCHEDULES;

  return (
    <div data-howto-id="page.audit-methodology-audit-types.body" className="container mx-auto px-4 py-8 max-w-5xl">
      <BackButton href="/methodology-admin/audit-methodology" label="Back to Audit Methodology" />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Audit Type Configuration</h1>
        <p className="text-slate-600 mt-1">Configure accounting frameworks, master schedule list, and schedule selection per audit type</p>
      </div>
      <AuditTypeSchedulesClient
        firmId={firmId}
        initialMappings={mappings}
        initialStageKeyedMappings={stageKeyedMappings}
        initialFrameworks={frameworks}
        initialFrameworkOptions={frameworkOptions.length > 0 ? frameworkOptions : undefined}
        initialMasterSchedules={masterSchedules}
      />
    </div>
  );
}
