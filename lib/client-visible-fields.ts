/**
 * Central registry of user-definable fields whose content will appear on
 * client-facing letter templates.
 *
 * Used by the UI to visually mark fields with a red outline via
 * <ClientVisibleField> so users know what they type will be seen by a client.
 *
 * Format: { formId: [{ key, letter }] } where `key` is the question/field ID
 * within that form, and `letter` is the human-readable letter name used in
 * the tooltip.
 */

export interface ClientVisibleFieldEntry {
  key: string;
  letter: string;
}

export const CLIENT_VISIBLE_FIELDS: Record<string, ClientVisibleFieldEntry[]> = {
  materiality: [
    { key: 'overallMateriality', letter: 'Planning Letter' },
    { key: 'performanceMateriality', letter: 'Planning Letter' },
    { key: 'clearlyTrivial', letter: 'Planning Letter' },
    { key: 'materiality_benchmark', letter: 'Planning Letter' },
    { key: 'benchmark_pct', letter: 'Planning Letter' },
    { key: 'benchmark_rationale', letter: 'Planning Letter' },
    { key: 'key_judgements', letter: 'Planning Letter' },
    { key: 'stakeholder_focus', letter: 'Planning Letter' },
  ],
  permanentFile: [
    { key: 'principal_activities', letter: 'Planning Letter' },
    { key: 'business_description', letter: 'Planning Letter' },
  ],
  continuance: [
    { key: 'continuity_engagement_letter_date', letter: 'Planning Letter' },
    { key: 'prior_auditor_firm_name', letter: 'Planning Letter' },
    { key: 'continuity_mgmt_letter_narrative', letter: 'Planning Letter' },
  ],
  ethics: [
    // All nas_*_safeguard fields are client-visible
    { key: 'nas_prep_accounts_safeguard', letter: 'Planning Letter' },
    { key: 'nas_corp_tax_safeguard', letter: 'Planning Letter' },
    { key: 'nas_advisory_safeguard', letter: 'Planning Letter' },
    { key: 'nas_internal_audit_safeguard', letter: 'Planning Letter' },
    { key: 'nas_other_assurance_safeguard', letter: 'Planning Letter' },
    { key: 'nas_payroll_safeguard', letter: 'Planning Letter' },
    { key: 'nas_vat_bookkeeping_safeguard', letter: 'Planning Letter' },
    { key: 'nas_recruitment_legal_it_safeguard', letter: 'Planning Letter' },
    { key: 'nas_director_verification_safeguard', letter: 'Planning Letter' },
  ],
  rmm: [
    { key: 'lineItem', letter: 'Planning Letter' },
    { key: 'riskIdentified', letter: 'Planning Letter' },
    { key: 'rowCategory', letter: 'Planning Letter' },
  ],
  contacts: [
    { key: 'name', letter: 'Planning Letter' },
    { key: 'isInformedManagement', letter: 'Planning Letter' },
  ],
  agreedDates: [
    { key: 'description', letter: 'Planning Letter' },
    { key: 'targetDate', letter: 'Planning Letter' },
  ],
  team: [
    { key: 'userName', letter: 'Planning Letter' },
    { key: 'role', letter: 'Planning Letter' },
  ],
  firmBranding: [
    // All letterhead text + regulatory fields
    { key: 'letterheadHeaderText', letter: 'All client letters' },
    { key: 'letterheadFooterText', letter: 'All client letters' },
  ],
};

/** Return the letter name(s) associated with a given form field, or null if not client-visible. */
export function getClientVisibleLetter(form: string, key: string): string | null {
  const entries = CLIENT_VISIBLE_FIELDS[form];
  if (!entries) return null;
  const match = entries.find(e => e.key === key);
  return match ? match.letter : null;
}

export function isClientVisible(form: string, key: string): boolean {
  return getClientVisibleLetter(form, key) !== null;
}
