/**
 * How-to registry — every UI element the on-screen yellow-dot guide can
 * point at, plus the pages it can navigate to.
 *
 * To make a new element targetable:
 *   1. Add an entry to HOWTO_ELEMENTS below
 *   2. Add `data-howto-id="<the-id>"` to the rendered element
 *   3. The LLM will now be able to point the dot at it
 *
 * Naming convention for IDs (loose, but follow it where you can):
 *   nav.<thing>            — global navbar items
 *   tile.<page-slug>       — a dashboard / hub tile linking to a sub-page
 *   pd.* / pa.*            — Performance Dashboard / its admin
 *   ma.*                   — Methodology Admin tools
 *   tool.<slug>.*          — top-level audit/tools pages
 *   form.<context>.*       — form fields and submit areas
 *   list.<context>.*       — list / table views (used for "click Edit
 *                            on the row you want" steps; the dot lands
 *                            on the table and any in-table click advances)
 *
 * Keep descriptions in plain English — the LLM uses them to decide
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
  /** Optional: visible label of the element. Helps disambiguate. */
  label?: string;
}

export const HOWTO_PAGES: Record<HowToPageKey, HowToPage> = {
  // ─── Navigation home ────────────────────────────────────────────────
  'global': {
    url: '*',
    title: 'Global navigation',
    description: 'Top navigation bar — visible on every authenticated page. Use these elements when the user needs to navigate to a different area of the site.',
  },

  // ─── Methodology Admin ─────────────────────────────────────────────
  'methodology-admin': {
    url: '/methodology-admin',
    title: 'Methodology Admin',
    description: 'Hub of all firm-wide methodology admin tiles — Performance Dashboard, CSFs, Audit Methodology, Validation Rules, Specialist Roles, TB AI Corpus, Independence Questions, Technical Guidance, File Review, User Performance, Error Log, Portal Searches, Template Documents, Internal Communication.',
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
  'firm-assumptions': {
    url: '/methodology-admin/firm-assumptions',
    title: 'Firm-Wide Assumptions',
    description: 'Risk tables, confidence levels, and assertion mappings.',
  },
  'validation-rules': {
    url: '/methodology-admin/validation-rules',
    title: 'Validation Rules',
    description: 'Firm-wide checks that flag issues on schedules (e.g. audit-fee thresholds).',
  },
  'independence-questions': {
    url: '/methodology-admin/independence-questions',
    title: 'Independence Questions',
    description: 'Firm-wide questions every team member must confirm before accessing an engagement.',
  },
  'specialist-roles': {
    url: '/methodology-admin/specialist-roles',
    title: 'Specialist Roles',
    description: 'Ethics Partner / MRLO / Management Board / ACP — for the "Send for specialist review" button on schedules.',
  },
  'tb-ai-corpus': {
    url: '/methodology-admin/tb-ai-corpus',
    title: 'TB AI Corpus',
    description: 'Firm-wide learning from past trial-balance classifications — descriptions, consensus answers, AI accept/override rates.',
  },
  'audit-methodology': {
    url: '/methodology-admin/audit-methodology',
    title: 'Audit Methodology',
    description: 'Tools, industries, test bank, and schedules. Hub for audit types, FS lines, point headings, questionnaire actions, schedules, team familiarity, test actions, test bank.',
  },
  'technical-guidance': {
    url: '/methodology-admin/technical-guidance',
    title: 'Audit Technical Guidance',
    description: 'Technical guidance documentation and standards.',
  },
  'file-review': {
    url: '/methodology-admin/file-review',
    title: 'Audit File Review Selection',
    description: 'Configure file review criteria and selection.',
  },
  'user-performance': {
    url: '/methodology-admin/user-performance',
    title: 'User Performance Reports',
    description: 'View and configure user performance metrics.',
  },
  'error-log': {
    url: '/methodology-admin/error-log',
    title: 'Error Log',
    description: 'Centralised error tracking across all engagements — diagnose and resolve issues.',
  },
  'portal-searches': {
    url: '/methodology-admin/portal-searches',
    title: 'Portal Searches',
    description: 'Review free-text searches portal users run on their dashboards — promote useful ones to featured quick-filter chips for the whole firm.',
  },
  'template-documents': {
    url: '/methodology-admin/template-documents',
    title: 'Template Documents',
    description: 'Create and manage document templates with merge fields populated from system data.',
  },
  'internal-communication': {
    url: '/methodology-admin/internal-communication',
    title: 'Internal Communication',
    description: 'Email templates for internal audit team communications.',
  },

  // ─── Top-level tools ────────────────────────────────────────────────
  'tool-data-extraction': {
    url: '/tools/data-extraction',
    title: 'Financial Data Extraction',
    description: 'Extract financial data from uploaded documents — pick a client and upload PDFs/images.',
  },
  'tool-fs-checker': {
    url: '/tools/fs-checker',
    title: 'Financial Statement Review',
    description: 'Check disclosures, casting and cross-references on financial statements.',
  },
  'tool-doc-summary': {
    url: '/tools/doc-summary',
    title: 'Document Summarisation',
    description: 'Summarise long audit documents using AI.',
  },
  'tool-bank-audit': {
    url: '/tools/bank-audit',
    title: 'Bank Reconciliation Testing',
    description: 'Test bank reconciliations against statement data.',
  },
  'tool-sampling': {
    url: '/tools/sampling',
    title: 'Sample Selection',
    description: 'Statistical sample selection for substantive testing.',
  },
  'tool-journals': {
    url: '/tools/journals-testing',
    title: 'Journal Entry Testing',
    description: 'AI-assisted journal entry risk scoring and testing.',
  },
  'tool-risk': {
    url: '/tools/risk',
    title: 'Risk Assessment',
    description: 'Engagement risk assessment across audit areas.',
  },
  'tool-risk-forum': {
    url: '/tools/risk-forum',
    title: 'Risk Forum',
    description: 'Cross-engagement risk forum hub — discussions, themes and assessments.',
  },
  'tool-risk-forum-assessments': {
    url: '/tools/risk-forum/assessments',
    title: 'Risk Forum Assessments',
    description: 'Risk assessments raised in the firm risk forum.',
  },
  'tool-assurance': {
    url: '/tools/assurance',
    title: 'Assurance Hub',
    description: 'Hub for assurance services beyond statutory audit.',
  },
  'tool-resource-planning': {
    url: '/tools/resource-planning',
    title: 'Resource Planning',
    description: 'Staff resourcing across engagements and periods.',
  },

  // ─── Clients ────────────────────────────────────────────────────────
  'clients-manage': {
    url: '/clients/manage',
    title: 'Manage Clients',
    description: 'Client master list — search, edit, deactivate, assign portfolio managers.',
  },
  'clients-add-delete': {
    url: '/clients/add-delete',
    title: 'Add / Remove Clients',
    description: 'Add new clients to the firm or remove existing ones.',
  },
  'clients-new-period': {
    url: '/clients/new-period',
    title: 'New Engagement Period',
    description: 'Create a new audit period for a client — sets up the engagement workspace.',
  },

  // ─── My Account ─────────────────────────────────────────────────────
  'my-account': {
    url: '/my-account',
    title: 'My Account',
    description: 'Profile dashboard — links to firm admin, keyboard shortcuts, resource management.',
  },
  'my-account-admin': {
    url: '/my-account/admin',
    title: 'My Account — Firm Admin',
    description: 'Firm-level user management — create users, assign roles, deactivate.',
  },

  // ─── Portal (client-facing) ─────────────────────────────────────────
  'portal-dashboard': {
    url: '/portal/dashboard',
    title: 'Portal Dashboard',
    description: 'Client portal dashboard — service tiles for Audit, Accounting, Consulting, Tax, Technology.',
  },
  'portal-audit': {
    url: '/portal/audit',
    title: 'Portal — Audit',
    description: 'Client view of audit support — evidence requests, document upload, progress tracking.',
  },
};

export const HOWTO_ELEMENTS: Record<string, HowToElement> = {
  // ─── Global navigation (Navbar) ─────────────────────────────────────
  'nav.audit': {
    page: 'global',
    label: 'Audit',
    description: 'Audit dropdown in the top nav — opens menu for SME / PIE / Group audits, Quality Management, methodology admin, financial data extraction.',
  },
  'nav.audit.quality-management': {
    page: 'global',
    label: 'Quality Management',
    description: 'Audit dropdown menu item: Quality Management.',
  },
  'nav.assurance': {
    page: 'global',
    label: 'Assurance',
    description: 'Assurance dropdown in the top nav — Assurance Hub, Risk Assessment, Risk Forum.',
  },
  'nav.assurance.hub': {
    page: 'global',
    label: 'Assurance Hub',
    description: 'Assurance dropdown menu item: Assurance Hub.',
  },
  'nav.assurance.risk': {
    page: 'global',
    label: 'Risk Assessment',
    description: 'Assurance dropdown menu item: Risk Assessment.',
  },
  'nav.assurance.risk-forum': {
    page: 'global',
    label: 'Risk Forum',
    description: 'Assurance dropdown menu item: Risk Forum.',
  },
  'nav.financial': {
    page: 'global',
    label: 'Financial Accounts',
    description: 'Financial Accounts dropdown in the top nav — accounting tools.',
  },
  'nav.about': {
    page: 'global',
    label: 'About',
    description: 'About link in the top nav.',
  },
  'nav.resources': {
    page: 'global',
    label: 'Resources',
    description: 'Resources link in the top nav — opens resource planning.',
  },
  'nav.sessions': {
    page: 'global',
    label: 'Sessions',
    description: 'Sessions dropdown — your active tool sessions across clients/periods.',
  },
  'nav.my-account': {
    page: 'global',
    label: 'My Account',
    description: 'My Account link in the top nav — profile, settings, action items badge.',
  },

  // ─── Methodology Admin tiles (the hub page) ─────────────────────────
  'tile.firm-assumptions': {
    page: 'methodology-admin',
    label: 'Firm Wide Assumptions',
    description: 'Tile: Firm Wide Assumptions — risk tables, confidence levels, assertion mappings.',
  },
  'tile.validation-rules': {
    page: 'methodology-admin',
    label: 'Validation Rules',
    description: 'Tile: Validation Rules — firm-wide checks on schedules.',
  },
  'tile.independence-questions': {
    page: 'methodology-admin',
    label: 'Independence Questions',
    description: 'Tile: Independence Questions — firm-wide independence confirmation questions.',
  },
  'tile.specialist-roles': {
    page: 'methodology-admin',
    label: 'Specialist Roles',
    description: 'Tile: Specialist Roles — Ethics Partner, MRLO, Management Board, ACP.',
  },
  'tile.tb-ai-corpus': {
    page: 'methodology-admin',
    label: 'TB AI Corpus',
    description: 'Tile: TB AI Corpus — firm-wide learning from past trial-balance classifications.',
  },
  'tile.audit-methodology': {
    page: 'methodology-admin',
    label: 'Audit Methodology',
    description: 'Tile: Audit Methodology — tools, industries, test bank, schedules.',
  },
  'tile.technical-guidance': {
    page: 'methodology-admin',
    label: 'Audit Technical Guidance',
    description: 'Tile: Audit Technical Guidance — technical documentation and standards.',
  },
  'tile.file-review': {
    page: 'methodology-admin',
    label: 'Audit File Review Selection',
    description: 'Tile: Audit File Review Selection — configure file review criteria.',
  },
  'tile.user-performance': {
    page: 'methodology-admin',
    label: 'User Performance Reports',
    description: 'Tile: User Performance Reports — staff performance metrics.',
  },
  'tile.performance-dashboard': {
    page: 'methodology-admin',
    label: 'Performance Dashboard',
    description: 'Tile: Performance Dashboard — AQT lead view of audit team performance against the G3Q operational model.',
  },
  'tile.error-log': {
    page: 'methodology-admin',
    label: 'Error Log',
    description: 'Tile: Error Log — centralised error tracking.',
  },
  'tile.portal-searches': {
    page: 'methodology-admin',
    label: 'Portal Searches',
    description: 'Tile: Portal Searches — review and promote portal user searches.',
  },
  'tile.template-documents': {
    page: 'methodology-admin',
    label: 'Template Documents',
    description: 'Tile: Template Documents — document template library with merge fields.',
  },
  'tile.internal-communication': {
    page: 'methodology-admin',
    label: 'Internal Communication',
    description: 'Tile: Internal Communication — email templates for the audit team.',
  },

  // ─── Performance Dashboard sections ─────────────────────────────────
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
    description: 'Headline KPIs section — Audit Quality Score, RCA Closure Rate, Remediation Effectiveness, ISQM(UK)1 Readiness.',
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
    description: 'Team Performance section — RIs and managers ranked by average quality score.',
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
    description: 'AI Reliance Defensibility section — composite score with validation currency, approval coverage, human review evidence and test pass rate.',
  },
  'pd.section.isqm': {
    page: 'performance-dashboard',
    description: 'ISQM(UK)1 Readiness section — evidence captured per quality objective.',
  },

  // ─── Performance Dashboard admin (per-tab) ──────────────────────────
  'pa.seed-banner': {
    page: 'performance-dashboard-admin',
    description: '"Seed G3Q defaults" banner at the top — pre-populates standard CSFs, schedule, ISQM(UK)1 objectives.',
  },
  'pa.tab.monitoring': {
    page: 'performance-dashboard-admin',
    label: 'Monitoring activities',
    description: 'Tab: Monitoring activities.',
  },
  'pa.tab.findings': {
    page: 'performance-dashboard-admin',
    label: 'Findings & RCA',
    description: 'Tab: Findings & RCA.',
  },
  'pa.tab.remediations': {
    page: 'performance-dashboard-admin',
    label: 'Remediations',
    description: 'Tab: Remediations.',
  },
  'pa.tab.csfs': {
    page: 'performance-dashboard-admin',
    label: 'CSFs',
    description: 'Tab: Critical Success Factors.',
  },
  'pa.tab.people': {
    page: 'performance-dashboard-admin',
    label: 'People snapshots',
    description: 'Tab: People snapshots.',
  },
  'pa.tab.schedule': {
    page: 'performance-dashboard-admin',
    label: 'Activity schedule',
    description: 'Tab: Annual activity schedule.',
  },
  'pa.tab.isqm': {
    page: 'performance-dashboard-admin',
    label: 'ISQM(UK)1 evidence',
    description: 'Tab: ISQM(UK)1 evidence.',
  },
  'pa.tab.pillars': {
    page: 'performance-dashboard-admin',
    label: 'Pillar overrides',
    description: 'Tab: Pillar overrides.',
  },
  'pa.tab.ai': {
    page: 'performance-dashboard-admin',
    label: 'AI Reliance',
    description: 'Tab: AI Reliance — manage AI tool registry, log AI usage, record validation tests.',
  },
  'pa.monitoring.add': {
    page: 'performance-dashboard-admin',
    label: 'Add monitoring activity',
    description: 'Button: Add a new monitoring activity.',
  },
  'pa.monitoring.list': {
    page: 'performance-dashboard-admin',
    description: 'Monitoring activities list — click an Edit link on any row to edit that activity, or the bin icon to delete.',
  },
  'pa.findings.add': {
    page: 'performance-dashboard-admin',
    label: 'Add finding',
    description: 'Button: Add a new finding.',
  },
  'pa.findings.list': {
    page: 'performance-dashboard-admin',
    description: 'Findings list — click Edit on the row you want to change.',
  },
  'pa.remediations.add': {
    page: 'performance-dashboard-admin',
    label: 'Add remediation',
    description: 'Button: Add a new remediation action.',
  },
  'pa.remediations.list': {
    page: 'performance-dashboard-admin',
    description: 'Remediations list — click Edit on the row you want to change.',
  },
  'pa.csfs.add': {
    page: 'performance-dashboard-admin',
    label: 'Add CSF',
    description: 'Button: Add a new Critical Success Factor.',
  },
  'pa.csfs.list': {
    page: 'performance-dashboard-admin',
    description: 'CSFs list (grouped by pillar) — click Edit on the row you want to change.',
  },
  'pa.people.add': {
    page: 'performance-dashboard-admin',
    label: 'Add snapshot',
    description: 'Button: Add a new people-metric snapshot for a period.',
  },
  'pa.people.list': {
    page: 'performance-dashboard-admin',
    description: 'People snapshots list — click Edit on a row to update its values.',
  },
  'pa.schedule.add': {
    page: 'performance-dashboard-admin',
    label: 'Add scheduled activity',
    description: 'Button: Add a scheduled activity to the annual G3Q Gantt.',
  },
  'pa.schedule.list': {
    page: 'performance-dashboard-admin',
    description: 'Schedule grid (one column per month). Hover over an item and click "edit" to change its status, owner, or dates.',
  },
  'pa.ai.subtab.tools': {
    page: 'performance-dashboard-admin',
    label: 'Tool registry',
    description: 'AI Reliance sub-tab: Tool registry.',
  },
  'pa.ai.subtab.usage': {
    page: 'performance-dashboard-admin',
    label: 'Usage log',
    description: 'AI Reliance sub-tab: Usage log.',
  },
  'pa.ai.subtab.validations': {
    page: 'performance-dashboard-admin',
    label: 'Validation tests',
    description: 'AI Reliance sub-tab: Validation tests.',
  },
  'pa.ai.tools.add': {
    page: 'performance-dashboard-admin',
    label: 'Register AI tool',
    description: 'Button: Register a new AI tool.',
  },
  'pa.ai.tools.list': {
    page: 'performance-dashboard-admin',
    description: 'AI tools list — click Edit on the row you want to change.',
  },
  'pa.ai.usage.list': {
    page: 'performance-dashboard-admin',
    description: 'AI usage log — click the bin icon on a row to delete an entry.',
  },
  'pa.ai.validations.list': {
    page: 'performance-dashboard-admin',
    description: 'AI validation tests log — click the bin icon on a row to delete an entry.',
  },
  'pa.ai.usage.add': {
    page: 'performance-dashboard-admin',
    label: 'Log AI usage',
    description: 'Button: Log a new AI-assisted decision.',
  },
  'pa.ai.validations.add': {
    page: 'performance-dashboard-admin',
    label: 'Log validation test',
    description: 'Button: Record a validation test for an AI tool.',
  },

  // ─── Per-tool generic anchors (page top + main content area) ────────
  'page.firm-assumptions.body': {
    page: 'firm-assumptions',
    description: 'The Firm-Wide Assumptions screen — adjust risk tables, confidence levels, and assertion mappings here. Look for Save buttons after editing.',
  },
  'page.validation-rules.body': {
    page: 'validation-rules',
    description: 'The Validation Rules screen — set firm-wide checks that flag issues on schedules.',
  },
  'page.independence-questions.body': {
    page: 'independence-questions',
    description: 'The Independence Questions screen — manage the firm\'s independence confirmation questions.',
  },
  'page.specialist-roles.body': {
    page: 'specialist-roles',
    description: 'The Specialist Roles screen — assign Ethics Partner, MRLO, Management Board, ACP and any custom roles.',
  },
  'page.tb-ai-corpus.body': {
    page: 'tb-ai-corpus',
    description: 'The TB AI Corpus screen — review past trial-balance classifications and AI accept/override rates.',
  },
  'page.audit-methodology.body': {
    page: 'audit-methodology',
    description: 'The Audit Methodology hub — links to audit types, FS lines, industries, point headings, questionnaire actions, schedules, team familiarity, test actions, test bank, tools.',
  },
  'page.technical-guidance.body': {
    page: 'technical-guidance',
    description: 'The Audit Technical Guidance screen.',
  },
  'page.file-review.body': {
    page: 'file-review',
    description: 'The Audit File Review Selection screen.',
  },
  'page.user-performance.body': {
    page: 'user-performance',
    description: 'The User Performance Reports screen.',
  },
  'page.error-log.body': {
    page: 'error-log',
    description: 'The Error Log screen — filter by severity, status, tool. Click an error row to expand it.',
  },
  'page.portal-searches.body': {
    page: 'portal-searches',
    description: 'The Portal Searches screen — review portal-user searches and promote useful ones.',
  },
  'page.template-documents.body': {
    page: 'template-documents',
    description: 'The Template Documents hub.',
  },
  'page.internal-communication.body': {
    page: 'internal-communication',
    description: 'The Internal Communication screen — email templates for the audit team.',
  },

  // ─── Top-level tools — page-level anchors only ──────────────────────
  'tool.data-extraction.body': {
    page: 'tool-data-extraction',
    description: 'The Financial Data Extraction screen — choose a client, upload a document, run extraction.',
  },
  'tool.fs-checker.body': {
    page: 'tool-fs-checker',
    description: 'The Financial Statement Review screen — check disclosures, casting and cross-references.',
  },
  'tool.doc-summary.body': {
    page: 'tool-doc-summary',
    description: 'The Document Summarisation screen — upload a document for AI summary.',
  },
  'tool.bank-audit.body': {
    page: 'tool-bank-audit',
    description: 'The Bank Reconciliation Testing screen.',
  },
  'tool.sampling.body': {
    page: 'tool-sampling',
    description: 'The Sample Selection screen — set parameters and generate a statistical sample.',
  },
  'tool.journals.body': {
    page: 'tool-journals',
    description: 'The Journal Entry Testing screen — AI-assisted journal risk scoring.',
  },
  'tool.risk.body': {
    page: 'tool-risk',
    description: 'The Risk Assessment screen.',
  },
  'tool.risk-forum.body': {
    page: 'tool-risk-forum',
    description: 'The Risk Forum screen.',
  },
  'tool.assurance.body': {
    page: 'tool-assurance',
    description: 'The Assurance Hub screen.',
  },
  'tool.resource-planning.body': {
    page: 'tool-resource-planning',
    description: 'The Resource Planning screen — staff allocation across engagements.',
  },

  // ─── Clients ────────────────────────────────────────────────────────
  'page.clients-manage.body': {
    page: 'clients-manage',
    description: 'The Manage Clients screen — search, edit, deactivate, assign portfolio managers.',
  },
  'page.clients-add-delete.body': {
    page: 'clients-add-delete',
    description: 'The Add / Remove Clients screen.',
  },
  'page.clients-new-period.body': {
    page: 'clients-new-period',
    description: 'The New Engagement Period screen — sets up a new audit period for a client.',
  },

  // ─── My Account ─────────────────────────────────────────────────────
  'page.my-account.body': {
    page: 'my-account',
    description: 'The My Account screen — profile and settings.',
  },
  'myaccount.methodology-admin': {
    page: 'my-account',
    label: 'Methodology Admin',
    description: 'My Account banner: "Methodology Admin" button — opens the firm-wide methodology configuration hub. Visible only to methodology admins / super admins.',
  },
  'myaccount.administration-panel': {
    page: 'my-account',
    label: 'Administration Panel',
    description: 'My Account banner: "Administration Panel" button — opens the super-admin firm controls.',
  },
  'myaccount.resource-management': {
    page: 'my-account',
    label: 'Manage Resources',
    description: 'My Account banner: "Manage Resources" button — opens the resource management screen.',
  },
  'myaccount.keyboard-shortcuts': {
    page: 'my-account',
    label: 'View Shortcuts',
    description: 'My Account banner: "View Shortcuts" button — opens the keyboard shortcuts reference.',
  },
  'page.my-account-admin.body': {
    page: 'my-account-admin',
    description: 'The My Account — Firm Admin screen — user list, role assignment.',
  },

  // ─── Portal ─────────────────────────────────────────────────────────
  'page.portal-dashboard.body': {
    page: 'portal-dashboard',
    description: 'The Portal Dashboard — service tiles and engagement summary for client users.',
  },
  'page.portal-audit.body': {
    page: 'portal-audit',
    description: 'The Portal Audit screen — evidence requests, document upload, progress tracking.',
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
    let count = 0;
    for (const [elemId, elem] of Object.entries(HOWTO_ELEMENTS)) {
      if (elem.page !== pageKey) continue;
      const labelBit = elem.label ? ` (label: "${elem.label}")` : '';
      out.push(`  - ${elemId}${labelBit}: ${elem.description}`);
      count++;
    }
    if (count === 0) out.push('  (none registered yet)');
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
    if (!HOWTO_ELEMENTS[howtoId]) continue;
    if (!HOWTO_PAGES[page]) continue;
    // 'global' elements (navbar) match any page — accept either.
    const elementPage = HOWTO_ELEMENTS[howtoId].page;
    if (elementPage !== page && elementPage !== 'global') continue;
    out.push({ howtoId, narration: narration.slice(0, 300), page });
  }
  return out;
}
