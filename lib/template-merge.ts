/**
 * Template merge field population.
 * Resolves {{key}} placeholders in template HTML with real engagement data.
 * Also expands block placeholders (e.g. {{significant_risks_table}}) into
 * generated HTML using lib/planning-letter-blocks.ts.
 */
import { prisma } from '@/lib/db';
import { AUDIT_TYPE_LABELS } from '@/types/methodology';
import {
  renderEngagementTeamTable,
  renderTimetableTable,
  renderEthicsSafeguardsTable,
  renderSignificantRisksTable,
  renderAreasOfFocusTable,
  type AuditPlanDetail,
} from '@/lib/planning-letter-blocks';

interface RecipientOverride {
  name?: string;
  firstName?: string;
  surname?: string;
  email?: string;
  role?: string;
}

export interface PopulateOptions {
  auditPlanDetail?: AuditPlanDetail;
}

function fmtCurrency(n: any): string {
  if (n === null || n === undefined || n === '' || isNaN(Number(n))) return '';
  return '£' + Number(n).toLocaleString('en-GB', { maximumFractionDigits: 0 });
}

function fmtPercent(n: any): string {
  if (n === null || n === undefined || n === '' || isNaN(Number(n))) return '';
  return Number(n).toLocaleString('en-GB', { maximumFractionDigits: 1 }) + '%';
}

/**
 * Populate all merge fields in a template string with engagement data.
 * Returns the fully populated HTML string.
 */
export async function populateMergeFields(
  templateContent: string,
  engagementId: string,
  currentUserName?: string,
  recipient?: RecipientOverride,
  options?: PopulateOptions,
): Promise<string> {
  // Load engagement with all relations in one query
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    include: {
      client: true,
      period: true,
      firm: { include: { ethicsPartner: { select: { name: true, email: true } } } },
      teamMembers: { include: { user: { select: { name: true, email: true } } } },
      specialists: true,
      contacts: true,
    },
  });

  if (!engagement) return templateContent;

  const client = engagement.client;
  const period = engagement.period;
  const firm = engagement.firm;
  const team = engagement.teamMembers;
  const specialists = engagement.specialists;
  const contacts = engagement.contacts;

  // Find team members by role
  const ri = team.find(m => m.role === 'RI');
  const reviewer = team.find(m => m.role === 'Manager');
  const preparer = team.find(m => m.role === 'Junior');

  // Find specialists by type
  const findSpec = (type: string) => specialists.find(s => s.specialistType === type);
  const ethicsSpec = findSpec('EthicsPartner') || findSpec('Ethics');
  const technicalSpec = findSpec('TechnicalAdvisor') || findSpec('Technical');

  // Primary contact
  const primaryContact = contacts[0];

  // Format dates
  const fmtDate = (d: Date | string | null) => {
    if (!d) return '';
    const date = d instanceof Date ? d : new Date(d);
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  };

  // Prior period end: one day before period start
  const priorPeriodEnd = period?.startDate
    ? (() => { const d = new Date(period.startDate); d.setDate(d.getDate() - 1); return fmtDate(d); })()
    : '';

  // ─── Load planning data (lazily — only if the template actually references it) ──
  const needsPlanning = /\{\{(materiality_|entity_activities_description|engagement_letter_date|prior_auditor|prior_year_review_narrative|informed_management_names|client_name_upper|ri_email|ri_role)/.test(templateContent);

  let materialityData: Record<string, any> = {};
  let continuanceData: Record<string, any> = {};
  let entityActivities = '';
  let informedManagementNames = '';

  if (needsPlanning) {
    const [materialityRow, continuanceRow, permFileRow, informedContacts] = await Promise.all([
      prisma.auditMateriality.findUnique({ where: { engagementId } }).catch(() => null),
      prisma.auditContinuance.findUnique({ where: { engagementId } }).catch(() => null),
      prisma.auditPermanentFile.findUnique({ where: { engagementId_sectionKey: { engagementId, sectionKey: 'understanding_entity' } } }).catch(() => null),
      prisma.auditClientContact.findMany({ where: { engagementId, isInformedManagement: true } }).catch(() => []),
    ]);
    materialityData = (materialityRow?.data as Record<string, any>) || {};
    continuanceData = (continuanceRow?.data as Record<string, any>) || {};
    const pfData = (permFileRow?.data as Record<string, any>) || {};
    entityActivities = (pfData.principal_activities || pfData.activities || pfData.business_description || '').toString();
    informedManagementNames = informedContacts.map(c => c.name).join(', ');
  }

  // Derived materiality merge values
  const benchmark = materialityData.materiality_benchmark || '';
  const benchmarkPct = materialityData.benchmark_pct;
  const materialityMethod = benchmark && benchmarkPct
    ? `${benchmarkPct}% of ${benchmark}`
    : benchmark || '';
  const pyBenchmark = materialityData.py_materiality_benchmark || '';
  const pyBenchmarkPct = materialityData.py_benchmark_pct;
  const materialityMethodPrior = pyBenchmark && pyBenchmarkPct
    ? `${pyBenchmarkPct}% of ${pyBenchmark}`
    : '';
  const materialityBenchmarkRationale =
    (materialityData.benchmark_rationale ||
      materialityData.key_judgements ||
      materialityData.stakeholder_focus ||
      '').toString();

  // Build the replacement map
  const fields: Record<string, string> = {
    // Recipient
    recipient_name: recipient?.name || primaryContact?.name || '',
    recipient_first_name: recipient?.firstName || primaryContact?.name?.split(' ')[0] || '',
    recipient_surname: recipient?.surname || primaryContact?.name?.split(' ').slice(1).join(' ') || '',
    recipient_email: recipient?.email || primaryContact?.email || '',
    recipient_role: recipient?.role || (primaryContact as any)?.role || '',

    // Client
    client_name: client?.clientName || '',
    client_name_upper: (client?.clientName || '').toUpperCase(),
    client_ref: (client as any)?.clientRef || '',
    client_address: (client as any)?.address || '',
    client_reg_number: (client as any)?.registrationNumber || '',
    client_industry: (client as any)?.industry || '',
    client_contact_first_name: primaryContact?.name?.split(' ')[0] || '',
    client_contact_surname: primaryContact?.name?.split(' ').slice(1).join(' ') || '',
    client_contact_email: primaryContact?.email || '',

    // Engagement
    engagement_type: AUDIT_TYPE_LABELS[engagement.auditType as keyof typeof AUDIT_TYPE_LABELS] || engagement.auditType,
    period_end: fmtDate(period?.endDate),
    target_completion: fmtDate(engagement.hardCloseDate),
    compliance_deadline: '', // Not currently stored — can be added
    engagement_partner: ri?.user?.name || '',
    engagement_manager: reviewer?.user?.name || '',
    prior_period_end: priorPeriodEnd,

    // Firm
    firm_name: firm?.name || '',
    firm_address: (firm as any)?.address || '',
    firm_registration: (firm as any)?.registration || '',
    firm_valuations_name: findSpec('Valuations')?.name || '',
    firm_valuations_email: findSpec('Valuations')?.email || '',
    firm_eqr_name: findSpec('EQR')?.name || '',
    firm_eqr_email: findSpec('EQR')?.email || '',
    firm_ethics_name: ethicsSpec?.name || firm?.ethicsPartner?.name || '',
    firm_ethics_email: ethicsSpec?.email || firm?.ethicsPartner?.email || '',
    firm_technical_name: technicalSpec?.name || '',
    firm_technical_email: technicalSpec?.email || '',

    // Team
    ri_name: ri?.user?.name || '',
    ri_email: ri?.user?.email || '',
    ri_role: 'Responsible Individual',
    reviewer_name: reviewer?.user?.name || '',
    preparer_name: preparer?.user?.name || '',
    current_user: currentUserName || '',

    // Planning (letter-specific)
    materiality_overall: fmtCurrency(materialityData.overallMateriality),
    materiality_overall_prior: fmtCurrency(materialityData.py_overallMateriality || materialityData.materiality_manual_prior),
    materiality_method: materialityMethod,
    materiality_method_prior: materialityMethodPrior,
    materiality_performance: fmtCurrency(materialityData.performanceMateriality),
    materiality_performance_percent: fmtPercent(materialityData.pm_pct || materialityData.performance_materiality_pct),
    materiality_trivial: fmtCurrency(materialityData.clearlyTrivial),
    materiality_benchmark_rationale: materialityBenchmarkRationale,
    entity_activities_description: entityActivities,
    engagement_letter_date: continuanceData.continuity_engagement_letter_date
      ? fmtDate(continuanceData.continuity_engagement_letter_date)
      : '',
    prior_auditor: continuanceData.prior_auditor_firm_name || '',
    prior_year_review_narrative: continuanceData.continuity_mgmt_letter_narrative || '',
    informed_management_names: informedManagementNames,

    // System / Dates
    current_date: fmtDate(new Date()),
    current_year: new Date().getFullYear().toString(),

    // Links
    portal_link: `${process.env.NEXTAUTH_URL || ''}/portal`,
    custom_link: '',
    job_section_link: `${process.env.NEXTAUTH_URL || ''}/tools/methodology/StatAudit?engagementId=${engagementId}`,
  };

  // Replace all {{key}} placeholders
  let result = templateContent;
  for (const [key, value] of Object.entries(fields)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }

  // ─── Block placeholder expansion ─────────────────────────────────────────
  // Block placeholders expand into generated HTML (tables). Run AFTER the
  // scalar merge so {{…}} inside the generated blocks isn't touched.
  const detail: AuditPlanDetail = options?.auditPlanDetail === 'detailed' ? 'detailed' : 'high';

  const blockJobs: Array<[RegExp, () => Promise<string>]> = [
    [/\{\{engagement_team_table\}\}/g, () => renderEngagementTeamTable(engagementId)],
    [/\{\{timetable_table\}\}/g, () => renderTimetableTable(engagementId)],
    [/\{\{ethics_safeguards_table\}\}/g, () => renderEthicsSafeguardsTable(engagementId)],
    [/\{\{significant_risks_table\}\}/g, () => renderSignificantRisksTable(engagementId, detail)],
    [/\{\{areas_of_focus_table\}\}/g, () => renderAreasOfFocusTable(engagementId, detail)],
  ];

  for (const [re, loader] of blockJobs) {
    if (re.test(result)) {
      // Reset regex lastIndex before reuse (test() stores it on g-regex)
      re.lastIndex = 0;
      try {
        const html = await loader();
        result = result.replace(re, html);
      } catch (err) {
        console.error('[template-merge] block renderer failed:', err);
        result = result.replace(re, '');
      }
    }
  }

  // Clean up any remaining unresolved merge fields
  result = result.replace(/\{\{[a-z_]+\}\}/g, '');

  return result;
}
