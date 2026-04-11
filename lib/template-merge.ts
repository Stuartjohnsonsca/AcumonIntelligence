/**
 * Template merge field population.
 * Resolves {{key}} placeholders in template HTML with real engagement data.
 */
import { prisma } from '@/lib/db';
import { AUDIT_TYPE_LABELS } from '@/types/methodology';

interface RecipientOverride {
  name?: string;
  firstName?: string;
  surname?: string;
  email?: string;
  role?: string;
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
    reviewer_name: reviewer?.user?.name || '',
    preparer_name: preparer?.user?.name || '',
    current_user: currentUserName || '',

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

  // Clean up any remaining unresolved merge fields
  result = result.replace(/\{\{[a-z_]+\}\}/g, '');

  return result;
}
