/**
 * How-to registry — every UI element the on-screen yellow-dot guide can
 * point at, plus the pages it can navigate to.
 *
 * To make a new element targetable:
 *   1. Add an entry to HOWTO_ELEMENTS below
 *   2. Add `data-howto-id="<the-id>"` to the rendered element
 *   3. The LLM will now be able to point the dot at it
 *
 * Keep descriptions in plain English — the LLM is using them to decide
 * which element matches the user's natural-language question.
 */

export type HowToPageKey = string;

export interface HowToPage {
  url: string;
  title: string;
  description: string;
}

export interface HowToElement {
  page: HowToPageKey;
  description: string;
  // Optional: the visible label of the element. Helps the LLM disambiguate
  // when multiple elements have similar descriptions.
  label?: string;
}

export const HOWTO_PAGES: Record<HowToPageKey, HowToPage> = {
  'methodology-admin': {
    url: '/methodology-admin',
    title: 'Methodology Admin',
    description: 'Hub of all admin tiles — Performance Dashboard, CSFs, Audit Methodology, Validation Rules, Specialist Roles, Error Log, etc.',
  },
  'performance-dashboard': {
    url: '/methodology-admin/performance-dashboard',
    title: 'Performance Dashboard',
    description: 'Audit Quality lead view — headline KPIs, G3Q pillar performance, monitoring activities, RCA, remediation, CSFs, people metrics, annual schedule, AI Reliance Defensibility, and ISQM(UK)1 readiness.',
  },
  'performance-dashboard-admin': {
    url: '/methodology-admin/performance-dashboard/admin',
    title: 'Performance Dashboard — Manage data',
    description: 'Tabbed admin where the AQT lead enters and edits data: Monitoring activities, Findings & RCA, Remediations, CSFs, People snapshots, Activity schedule, ISQM(UK)1 evidence, Pillar overrides, AI Reliance.',
  },
};

export const HOWTO_ELEMENTS: Record<string, HowToElement> = {
  // ─── methodology-admin landing ─────────────────────────────────────
  'tile.performance-dashboard': {
    page: 'methodology-admin',
    label: 'Performance Dashboard',
    description: 'The "Performance Dashboard" tile — opens the AQT lead dashboard.',
  },

  // ─── performance dashboard ─────────────────────────────────────────
  'pd.toolbar.refresh': {
    page: 'performance-dashboard',
    label: 'Refresh',
    description: 'Refresh button on the dashboard toolbar — reloads all data.',
  },
  'pd.toolbar.manage-data': {
    page: 'performance-dashboard',
    label: 'Manage data',
    description: 'The "Manage data" button — opens the admin screens to enter or edit dashboard data.',
  },
  'pd.section.headline-kpis': {
    page: 'performance-dashboard',
    description: 'Headline KPIs section — the four metrics (Audit Quality Score, RCA Closure Rate, Remediation Effectiveness, ISQM(UK)1 Readiness).',
  },
  'pd.section.pillars': {
    page: 'performance-dashboard',
    description: 'G3Q Pillar Performance section — Goodwill, Governance, Growth, Quality cards.',
  },
  'pd.section.monitoring': {
    page: 'performance-dashboard',
    description: 'Quality Monitoring Activities section — cold/hot/spot/thematic file reviews, EQR, pre-issuance, consultations, ethical compliance.',
  },
  'pd.section.team': {
    page: 'performance-dashboard',
    description: 'Team Performance section — RIs and managers with quality scores and open findings.',
  },
  'pd.section.rca': {
    page: 'performance-dashboard',
    description: 'Root Cause Analysis section — findings categorised by underlying cause.',
  },
  'pd.section.remediation': {
    page: 'performance-dashboard',
    description: 'Remediation Tracker section — actions and effectiveness re-tests.',
  },
  'pd.section.csfs': {
    page: 'performance-dashboard',
    description: 'Critical Success Factors section — CSFs by pillar with RAG status.',
  },
  'pd.section.people': {
    page: 'performance-dashboard',
    description: 'Training & People section — training effectiveness, utilisation, culture, attrition.',
  },
  'pd.section.schedule': {
    page: 'performance-dashboard',
    description: 'Annual Activity Schedule section — the 12-month G3Q Gantt.',
  },
  'pd.section.ai-reliance': {
    page: 'performance-dashboard',
    description: 'AI Reliance Defensibility section — composite score with validation currency, approval coverage, human review evidence and test pass rate, plus tool registry summary.',
  },
  'pd.section.isqm': {
    page: 'performance-dashboard',
    description: 'ISQM(UK)1 Readiness section — evidence captured per quality objective.',
  },

  // ─── admin: tab strip ──────────────────────────────────────────────
  'pa.seed-banner': {
    page: 'performance-dashboard-admin',
    description: 'The "Seed G3Q defaults" banner at the top of the admin page — pre-populates standard CSFs, schedule, ISQM(UK)1 objectives.',
  },
  'pa.tab.monitoring': {
    page: 'performance-dashboard-admin',
    label: 'Monitoring activities',
    description: 'Tab: Monitoring activities — cold/hot/spot/thematic file reviews, EQR, pre-issuance, consultations, ethical compliance.',
  },
  'pa.tab.findings': {
    page: 'performance-dashboard-admin',
    label: 'Findings & RCA',
    description: 'Tab: Findings & RCA — log findings raised from monitoring activities and capture root-cause analysis.',
  },
  'pa.tab.remediations': {
    page: 'performance-dashboard-admin',
    label: 'Remediations',
    description: 'Tab: Remediations — record remediation actions linked to findings, with re-test effectiveness.',
  },
  'pa.tab.csfs': {
    page: 'performance-dashboard-admin',
    label: 'CSFs',
    description: 'Tab: CSFs — Critical Success Factors per pillar with RAG, target metric, current metric, owner.',
  },
  'pa.tab.people': {
    page: 'performance-dashboard-admin',
    label: 'People snapshots',
    description: 'Tab: People snapshots — periodic capture of training effectiveness, utilisation, culture survey score, attrition.',
  },
  'pa.tab.schedule': {
    page: 'performance-dashboard-admin',
    label: 'Activity schedule',
    description: 'Tab: Activity schedule — annual G3Q Gantt entries by month.',
  },
  'pa.tab.isqm': {
    page: 'performance-dashboard-admin',
    label: 'ISQM(UK)1 evidence',
    description: 'Tab: ISQM(UK)1 evidence — evidence count vs target per quality objective.',
  },
  'pa.tab.pillars': {
    page: 'performance-dashboard-admin',
    label: 'Pillar overrides',
    description: 'Tab: Pillar overrides — manually override a pillar score or strapline.',
  },
  'pa.tab.ai': {
    page: 'performance-dashboard-admin',
    label: 'AI Reliance',
    description: 'Tab: AI Reliance — manage the AI tool registry, log AI-assisted decisions, and record validation tests.',
  },

  // ─── admin: per-tab actions ────────────────────────────────────────
  'pa.monitoring.add': {
    page: 'performance-dashboard-admin',
    label: 'Add monitoring activity',
    description: 'Button: Add a new monitoring activity (cold/hot/spot/thematic file review, EQR, consultation, pre-issuance, ethical).',
  },
  'pa.findings.add': {
    page: 'performance-dashboard-admin',
    label: 'Add finding',
    description: 'Button: Add a new finding raised from a monitoring activity.',
  },
  'pa.remediations.add': {
    page: 'performance-dashboard-admin',
    label: 'Add remediation',
    description: 'Button: Add a new remediation action linked to a finding.',
  },
  'pa.csfs.add': {
    page: 'performance-dashboard-admin',
    label: 'Add CSF',
    description: 'Button: Add a new Critical Success Factor.',
  },
  'pa.people.add': {
    page: 'performance-dashboard-admin',
    label: 'Add snapshot',
    description: 'Button: Add a new people-metric snapshot for a period.',
  },
  'pa.schedule.add': {
    page: 'performance-dashboard-admin',
    label: 'Add scheduled activity',
    description: 'Button: Add a scheduled activity to the annual G3Q Gantt.',
  },
  'pa.ai.subtab.tools': {
    page: 'performance-dashboard-admin',
    label: 'Tool registry',
    description: 'AI Reliance sub-tab: Tool registry — every AI tool used in audit work, with vendor, risk, validation status, approval and HITL flag.',
  },
  'pa.ai.subtab.usage': {
    page: 'performance-dashboard-admin',
    label: 'Usage log',
    description: 'AI Reliance sub-tab: Usage log — record each significant AI-assisted decision and the human reviewer\'s output decision.',
  },
  'pa.ai.subtab.validations': {
    page: 'performance-dashboard-admin',
    label: 'Validation tests',
    description: 'AI Reliance sub-tab: Validation tests — record accuracy / bias / regression / drift / golden-set / edge-case test runs.',
  },
  'pa.ai.tools.add': {
    page: 'performance-dashboard-admin',
    label: 'Register AI tool',
    description: 'Button: Register a new AI tool in the firm\'s AI register.',
  },
  'pa.ai.usage.add': {
    page: 'performance-dashboard-admin',
    label: 'Log AI usage',
    description: 'Button: Log a new AI-assisted decision with reviewer and output decision (accepted/overridden/partial/rejected).',
  },
  'pa.ai.validations.add': {
    page: 'performance-dashboard-admin',
    label: 'Log validation test',
    description: 'Button: Record a validation test for an AI tool — passing tests bump validation status to "validated".',
  },
};

/**
 * Format the registry as a compact text block the LLM can consume. We
 * deliberately group by page so the model sees the navigation structure.
 */
export function buildRegistryPrompt(): string {
  const out: string[] = [];
  for (const [pageKey, page] of Object.entries(HOWTO_PAGES)) {
    out.push(`# Page: ${page.title} (${pageKey})`);
    out.push(`URL: ${page.url}`);
    out.push(`What it is: ${page.description}`);
    out.push('Elements on this page you can point at:');
    for (const [elemId, elem] of Object.entries(HOWTO_ELEMENTS)) {
      if (elem.page !== pageKey) continue;
      const labelBit = elem.label ? ` (label: "${elem.label}")` : '';
      out.push(`  - ${elemId}${labelBit}: ${elem.description}`);
    }
    out.push('');
  }
  return out.join('\n');
}

/** A single step the overlay will execute. */
export interface HowToStep {
  /** The howto element ID to point at — must match a key in HOWTO_ELEMENTS. */
  howtoId: string;
  /** What the dot should say to the user when it lands here. */
  narration: string;
  /** The page this step is on. The overlay will navigate if needed. */
  page: HowToPageKey;
}

/** Validate a step plan returned from the LLM. Drops any malformed entries. */
export function sanitiseStepPlan(raw: unknown): HowToStep[] {
  if (!Array.isArray(raw)) return [];
  const out: HowToStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const howtoId = typeof r.howtoId === 'string' ? r.howtoId : null;
    const narration = typeof r.narration === 'string' ? r.narration : null;
    const page = typeof r.page === 'string' ? r.page : null;
    if (!howtoId || !narration || !page) continue;
    if (!HOWTO_ELEMENTS[howtoId]) continue; // unknown ID — drop
    if (!HOWTO_PAGES[page]) continue; // unknown page — drop
    if (HOWTO_ELEMENTS[howtoId].page !== page) continue; // page mismatch — drop
    out.push({ howtoId, narration: narration.slice(0, 300), page });
  }
  return out;
}
