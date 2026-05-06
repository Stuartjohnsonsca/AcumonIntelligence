/**
 * Schedule Actions — actions that can fire from a schedule
 * question when the auditor's answer matches a configured trigger
 * value. Each action creates a chat item in the Specialists tab
 * for the configured specialist role, opening a conversation
 * between the engagement team and the relevant specialist.
 *
 * Mirrors the lib/audit-tools.ts pattern: a catalog of
 * actions kept in one file, consumed both by the Methodology
 * Admin (for picking actions per question) and by the runtime
 * trigger code (for firing them when conditions are met).
 *
 * Persistence:
 *   - Trigger config lives on TemplateQuestion.scheduleAction (a
 *     `{ key, triggerValue }` object stored in the template's
 *     `items` JSON).
 *   - When fired, an entry is appended to PF section
 *     `specialists_items` under the relevant role key, surfacing as
 *     a new chat item in SpecialistsTab.
 */

export interface ScheduleAction {
  /** Stable key persisted in template config and on the wire. */
  key: string;
  /** Human-readable label shown in admin dropdowns. */
  label: string;
  /** One-line description of what firing this action does. */
  description: string;
  /** The specialist role the action escalates to. References the
   *  role keys configured in Methodology Admin → Specialist Roles
   *  (e.g. 'tax_technical', 'ethics_partner', 'mrlo'). */
  specialistRoleKey: string;
  /** Default opening message seeded into the chat when fired. The
   *  runtime substitutes {{questionText}} / {{response}} / etc. */
  openingMessage: string;
}

export const SCHEDULE_ACTIONS: ScheduleAction[] = [
  {
    key: 'consult_tax_technical',
    label: 'Consult Tax Technical specialist',
    description: 'Open a chat with the Tax Technical specialist about this answer.',
    specialistRoleKey: 'tax_technical',
    openingMessage: 'The team needs Tax Technical input on the following:\n\nQuestion: {{questionText}}\nResponse: {{response}}',
  },
  {
    key: 'consult_ethics_partner',
    label: 'Escalate to Ethics Partner',
    description: 'Initiate a conversation with the Ethics Partner.',
    specialistRoleKey: 'ethics_partner',
    openingMessage: 'Ethics matter raised from a schedule:\n\nQuestion: {{questionText}}\nResponse: {{response}}',
  },
  {
    key: 'consult_mrlo',
    label: 'Refer to MRLO',
    description: 'Open a chat with the MRLO about a money-laundering / regulatory matter.',
    specialistRoleKey: 'mrlo',
    openingMessage: 'MRLO referral from a schedule:\n\nQuestion: {{questionText}}\nResponse: {{response}}',
  },
  {
    key: 'consult_it_specialist',
    label: 'Consult IT specialist',
    description: 'Open a chat with the engagement IT specialist.',
    specialistRoleKey: 'it_specialist',
    openingMessage: 'IT input requested:\n\nQuestion: {{questionText}}\nResponse: {{response}}',
  },
  {
    key: 'consult_actuarial',
    label: 'Consult actuarial specialist',
    description: 'Open a chat with the actuarial specialist (insurance / pensions).',
    specialistRoleKey: 'actuarial',
    openingMessage: 'Actuarial input requested:\n\nQuestion: {{questionText}}\nResponse: {{response}}',
  },
  {
    key: 'consult_valuation',
    label: 'Consult valuations specialist',
    description: 'Open a chat with a valuations specialist.',
    specialistRoleKey: 'valuation',
    openingMessage: 'Valuations input requested:\n\nQuestion: {{questionText}}\nResponse: {{response}}',
  },
];

export function findScheduleAction(key: string): ScheduleAction | undefined {
  return SCHEDULE_ACTIONS.find(a => a.key === key);
}

/**
 * Substitute {{...}} placeholders in the action's opening message.
 * Unrecognised placeholders are left as-is so the auditor sees them
 * and can fill in by hand.
 */
export function renderOpeningMessage(action: ScheduleAction, vars: Record<string, string>): string {
  return action.openingMessage.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}
