// Generates a Word document that documents the three pipeline audit
// tests (Year-End Accruals, Unrecorded Liabilities, Gross Margin
// Analytical Review) with detailed steps and flow-chart-style
// diagrams.
//
// Output: C:\Users\stuart\Downloads\Acumon-Pipeline-Tests-Reference.docx
//
// Usage: node scripts/generate-pipeline-reference.js
/* eslint-disable no-console */

// Register ts-node so we can import SYSTEM_ACTIONS directly from the
// TypeScript source of truth — the catalog appendix stays in sync with
// whatever is currently seeded in lib/action-seed.ts.
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'commonjs',
    target: 'es2020',
    esModuleInterop: true,
    skipLibCheck: true,
    moduleResolution: 'node',
  },
});

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  VerticalAlign, LevelFormat, PageBreak, TableOfContents, Bookmark,
} = require('docx');
const { SYSTEM_ACTIONS } = require('../lib/action-seed.ts');

// ── Layout constants ─────────────────────────────────────────────────────
const PAGE_WIDTH = 12240;     // US Letter
const PAGE_HEIGHT = 15840;
const MARGIN = 1440;          // 1 inch
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;   // 9360 DXA

// ── Palette ──────────────────────────────────────────────────────────────
const COLOUR = {
  accruals: '0EA5E9',
  ul: '7C3AED',
  gm: '14B8A6',
  slate: '475569',
  lightSlate: 'F1F5F9',
  borderGrey: 'CCCCCC',
  text: '1E293B',
  red: 'DC2626',
  orange: 'F97316',
  green: '16A34A',
  amber: 'F59E0B',
};

// ── Helpers ──────────────────────────────────────────────────────────────
function para(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 120, before: opts.before ?? 0 },
    alignment: opts.alignment,
    heading: opts.heading,
    children: [new TextRun({
      text,
      bold: opts.bold,
      italics: opts.italics,
      color: opts.color,
      size: opts.size,
      font: opts.font || 'Arial',
    })],
  });
}

function spacer(after = 160) {
  return new Paragraph({ spacing: { after }, children: [new TextRun('')] });
}

function bullet(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text, font: 'Arial', size: 22 })],
  });
}

function subBullet(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 1 },
    spacing: { after: 60 },
    children: [new TextRun({ text, font: 'Arial', size: 22 })],
  });
}

const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: COLOUR.borderGrey };
const thinBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

// ── Flow-chart node (single-cell table) ──────────────────────────────────
function flowNode({ index, title, code, role, fill }) {
  const headerFill = fill || COLOUR.slate;
  return new Table({
    width: { size: 6480, type: WidthType.DXA },
    columnWidths: [6480],
    alignment: AlignmentType.CENTER,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: {
              top: { style: BorderStyle.SINGLE, size: 8, color: headerFill },
              left: { style: BorderStyle.SINGLE, size: 8, color: headerFill },
              right: { style: BorderStyle.SINGLE, size: 8, color: headerFill },
              bottom: { style: BorderStyle.SINGLE, size: 8, color: headerFill },
            },
            shading: { fill: headerFill, type: ShadingType.CLEAR, color: 'auto' },
            margins: { top: 60, bottom: 40, left: 120, right: 120 },
            width: { size: 6480, type: WidthType.DXA },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 20 },
                children: [new TextRun({ text: `STEP ${index}`, bold: true, color: 'FFFFFF', size: 18, font: 'Arial' })],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 20 },
                children: [new TextRun({ text: title, bold: true, color: 'FFFFFF', size: 22, font: 'Arial' })],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 20 },
                children: [new TextRun({ text: code, italics: true, color: 'E2E8F0', size: 18, font: 'Consolas' })],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 0 },
                children: [new TextRun({ text: role, color: 'FFFFFF', size: 18, font: 'Arial' })],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function flowArrow() {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 60, after: 60 },
    children: [new TextRun({ text: '▼', size: 28, color: COLOUR.slate, font: 'Arial' })],
  });
}

function flowBranchArrow(label) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 40, after: 40 },
    children: [
      new TextRun({ text: '▼ ', size: 24, color: COLOUR.slate, font: 'Arial' }),
      new TextRun({ text: label, size: 18, italics: true, color: COLOUR.slate, font: 'Arial' }),
    ],
  });
}

// Build the full flow-chart section for one test
function buildFlowChart(steps, fill) {
  const out = [];
  for (let i = 0; i < steps.length; i++) {
    out.push(flowNode({ ...steps[i], fill }));
    if (i < steps.length - 1) {
      out.push(steps[i].branchLabel ? flowBranchArrow(steps[i].branchLabel) : flowArrow());
    }
  }
  return out;
}

// ── Step-detail table ────────────────────────────────────────────────────
function stepDetailTable(rows, accentFill) {
  const headerCells = ['#', 'Step', 'What happens', 'Pause / Continue'].map((label, i) =>
    new TableCell({
      borders: thinBorders,
      shading: { fill: accentFill, type: ShadingType.CLEAR, color: 'auto' },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      width: { size: [600, 2200, 5460, 1100][i], type: WidthType.DXA },
      children: [new Paragraph({
        children: [new TextRun({ text: label, bold: true, color: 'FFFFFF', size: 20, font: 'Arial' })],
      })],
    }),
  );

  const bodyRows = rows.map(r => new TableRow({
    children: [
      new TableCell({
        borders: thinBorders, margins: { top: 80, bottom: 80, left: 120, right: 120 },
        width: { size: 600, type: WidthType.DXA },
        verticalAlign: VerticalAlign.TOP,
        children: [new Paragraph({ children: [new TextRun({ text: String(r.n), bold: true, size: 20, font: 'Arial' })] })],
      }),
      new TableCell({
        borders: thinBorders, margins: { top: 80, bottom: 80, left: 120, right: 120 },
        width: { size: 2200, type: WidthType.DXA },
        verticalAlign: VerticalAlign.TOP,
        children: [
          new Paragraph({ children: [new TextRun({ text: r.title, bold: true, size: 20, font: 'Arial' })] }),
          new Paragraph({ spacing: { before: 40 }, children: [new TextRun({ text: r.code, italics: true, size: 16, color: COLOUR.slate, font: 'Consolas' })] }),
        ],
      }),
      new TableCell({
        borders: thinBorders, margins: { top: 80, bottom: 80, left: 120, right: 120 },
        width: { size: 5460, type: WidthType.DXA },
        verticalAlign: VerticalAlign.TOP,
        children: r.details.map(d => new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: d, size: 20, font: 'Arial' })],
        })),
      }),
      new TableCell({
        borders: thinBorders, margins: { top: 80, bottom: 80, left: 120, right: 120 },
        width: { size: 1100, type: WidthType.DXA },
        verticalAlign: VerticalAlign.TOP,
        children: [new Paragraph({ children: [new TextRun({ text: r.mode, size: 18, italics: true, font: 'Arial' })] })],
      }),
    ],
  }));

  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [600, 2200, 5460, 1100],
    rows: [new TableRow({ tableHeader: true, children: headerCells }), ...bodyRows],
  });
}

// ── Pop-up config table ──────────────────────────────────────────────────
function configTable(fields, accentFill) {
  const header = new TableRow({
    tableHeader: true,
    children: ['Field', 'Type', 'Description'].map((h, i) => new TableCell({
      borders: thinBorders,
      shading: { fill: accentFill, type: ShadingType.CLEAR, color: 'auto' },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      width: { size: [2500, 1500, 5360][i], type: WidthType.DXA },
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: 'FFFFFF', size: 20, font: 'Arial' })] })],
    })),
  });
  const body = fields.map(f => new TableRow({
    children: [
      new TableCell({
        borders: thinBorders, margins: { top: 60, bottom: 60, left: 120, right: 120 },
        width: { size: 2500, type: WidthType.DXA },
        children: [new Paragraph({ children: [new TextRun({ text: f.label, bold: true, size: 20, font: 'Arial' })] })],
      }),
      new TableCell({
        borders: thinBorders, margins: { top: 60, bottom: 60, left: 120, right: 120 },
        width: { size: 1500, type: WidthType.DXA },
        children: [new Paragraph({ children: [new TextRun({ text: f.type, italics: true, size: 18, font: 'Consolas', color: COLOUR.slate })] })],
      }),
      new TableCell({
        borders: thinBorders, margins: { top: 60, bottom: 60, left: 120, right: 120 },
        width: { size: 5360, type: WidthType.DXA },
        children: [new Paragraph({ children: [new TextRun({ text: f.desc, size: 20, font: 'Arial' })] })],
      }),
    ],
  }));
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [2500, 1500, 5360],
    rows: [header, ...body],
  });
}

// ═════════════════════════════════════════════════════════════════════════
//   TEST 1 — YEAR-END ACCRUALS
// ═════════════════════════════════════════════════════════════════════════
const accrualsConfig = [
  { label: 'Post-YE Evidence Window (X days)', type: 'number', desc: 'How many days after period end we look at for subsequent invoices / payments that corroborate the recorded accrual. Typical: 60 days.' },
];

const accrualsFlow = [
  { index: 0, title: 'Request Accruals Listing', code: 'request_accruals_listing', role: 'Portal · Parse · Reconcile to TB' },
  { index: 1, title: 'Select Sample', code: 'select_sample', role: 'MUS / Stratified / Top Items / Risk-based' },
  { index: 2, title: 'Request Supporting Documents', code: 'request_documents', role: 'Portal (batch, individual, zip)' },
  { index: 3, title: 'Extract Accruals Evidence', code: 'extract_accruals_evidence', role: 'Server-side AI extraction per document' },
  { index: 4, title: 'Verify Accruals Sample (R/O/G)', code: 'verify_accruals_sample', role: 'Match · Period · Spread · Apportion' },
  { index: 5, title: 'Team Review', code: 'team_review', role: 'Sign-off · Error Schedule · In TB' },
];

const accrualsDetails = [
  {
    n: 1, title: 'Pipeline kick-off config',
    code: 'pipelineConfigSchema',
    details: [
      'A modal pops up as soon as the audit team runs the test. It captures: Post-YE Evidence Window (X days).',
      'The answer is persisted on the TestExecution.configJson record and is available to every downstream step via $ctx.execution.config.x_days_post_ye.',
    ],
    mode: 'User',
  },
  {
    n: 2, title: 'Request accruals listing',
    code: 'request_accruals_listing',
    details: [
      'Creates a PortalRequest on the Client portal asking for the YE accruals listing (supplier, description, what it relates to, service period, amount, nominal code, journal ref, supporting refs).',
      'Adds an OutstandingItem so the request is tracked on the Outstanding tab.',
      'Pauses the pipeline until the client responds and the audit team commits.',
    ],
    mode: 'PAUSE portal_response',
  },
  {
    n: 3, title: 'Parse listing & reconcile to TB',
    code: 'request_accruals_listing (phase: listing_received)',
    details: [
      'On resume, the handler parses the returned file (CSV / XLSX / JSON) into rows.',
      'Sums the listing total and the sum of TB rows flagged isAccrualAccount (or the explicit account codes on the action input).',
      'If reconciled within tolerance → emits data_table (the accruals population) and continues.',
      'If the variance exceeds tolerance → raises a follow-up Outstanding item and pauses again until the client explains or re-uploads.',
    ],
    mode: 'Continue / Pause',
  },
  {
    n: 4, title: 'Select sample',
    code: 'select_sample',
    details: [
      'The auditor picks the sampling method (MUS, stratified, top items, risk-based).',
      'System selects the sample server-side from the accruals population.',
      'Sample method + rationale are recorded against the execution.',
    ],
    mode: 'Continue (via UI)',
  },
  {
    n: 5, title: 'Request supporting documents',
    code: 'request_documents',
    details: [
      'For each sampled accrual, the auditor picks a DocumentType from: Accrual calculation / schedule support, Supplier invoice (post-YE), Supplier statement, Purchase order / contract, GRN / delivery note, Service completion evidence, Remittance advice.',
      'Portal request created; responses may be one-by-one attachments or a batch (Word / Excel / image / PDF / zip).',
      'Batch grouping window: if the client posts multiple files within a 2-minute window, they are processed as a single batch.',
    ],
    mode: 'PAUSE portal_response',
  },
  {
    n: 6, title: 'Extract supporting evidence',
    code: 'extract_accruals_evidence',
    details: [
      'Every uploaded document is OCR-read and parsed server-side by an AI extractor (Llama 3.3 70B with vision).',
      'Extracts: supplier / payee, amount, currency, invoice date, service period start / end, description, references (invoice no, PO, GRN, contract).',
      'Emits one row per document; any file that could not be parsed confidently is surfaced as an extraction_issue for auditor review.',
    ],
    mode: 'Continue',
  },
  {
    n: 7, title: 'Verify sample (R/O/G markers)',
    code: 'verify_accruals_sample',
    details: [
      'For each sample item, the handler runs a deterministic scoring chain:',
      '  (a) Match evidence to the sampled accrual by supplier + amount.',
      '  (b) Classify obligation date (service end → invoice date) vs Period.End.',
      '  (c) If obligation > YE → RED (Incorrect Accrual).',
      '  (d) If obligation ≤ YE → search returned evidence within X days post-YE for a supporting invoice / payment. Match → GREEN (Accrual Supported). Mismatch → RED. Missing within window → ORANGE (Support Missing).',
      '  (e) If not Red, detect a service period spanning YE → ORANGE (Spread).',
      '  (f) For Orange Spread items, time-apportion (pre-YE days ÷ total days × amount); compare to recorded accrual → GREEN if within tolerance, otherwise RED.',
      'Each outcome is persisted to sample_item_markers (one row per sample item) so the Audit Verification UI can render dots and the auditor can override with a timestamped reason.',
    ],
    mode: 'Continue',
  },
  {
    n: 8, title: 'Findings & Conclusions',
    code: 'Runtime UI',
    details: [
      'All RED items land in the Findings & Conclusions section with Date, Description, Amount columns plus two buttons: Error (red) and In TB (green). Selecting one clears the other.',
      '“Error” creates an AuditErrorSchedule row linked via sampleItemMarkerId; it shows on the engagement Error Schedule tab. “In TB” records the resolution without booking an error.',
      'The auditor may override any marker colour; the override user, timestamp, reason, and the handler’s original colour are all preserved.',
    ],
    mode: 'User',
  },
  {
    n: 9, title: 'Team review',
    code: 'team_review',
    details: [
      'A final OutstandingItem is created for the reviewer (RI / Engagement Partner).',
      'Reviewer confirms that every Red item has been resolved as Error or In TB and signs off.',
    ],
    mode: 'PAUSE review',
  },
];

// ═════════════════════════════════════════════════════════════════════════
//   TEST 2 — UNRECORDED LIABILITIES
// ═════════════════════════════════════════════════════════════════════════
const ulConfig = [
  { label: 'Post-YE Window (X days)', type: 'number', desc: 'How many days after period end to scan for payments that may represent prior-period obligations. Typical: 60 days.' },
];

const ulFlow = [
  { index: 0, title: 'Request Bank Statements', code: 'request_documents', role: 'Portal · Period.End+1 to Period.End+X' },
  { index: 1, title: 'Extract Post-YE Payments', code: 'extract_post_ye_bank_payments', role: 'Server-side parse → payments population' },
  { index: 2, title: 'Request Creditors Listing', code: 'request_accruals_listing', role: 'Creditors & accruals at YE (for match)' },
  { index: 3, title: 'Select UL Sample', code: 'select_unrecorded_liabilities_sample', role: 'Above-PM · AI risk rank · Residual MUS/stratified/haphazard' },
  { index: 4, title: 'Request Supporting Documents', code: 'request_documents', role: 'Invoices · Remittances · POs · GRNs · Service evidence' },
  { index: 5, title: 'Extract Supporting Evidence', code: 'extract_accruals_evidence', role: 'Server-side AI extraction per document' },
  { index: 6, title: 'Verify UL Sample (R/O/G)', code: 'verify_unrecorded_liabilities_sample', role: 'Match · Period · Creditor lookup · Spread · Apportion' },
  { index: 7, title: 'Team Review', code: 'team_review', role: 'Sign-off · Error Schedule tagged Unrecorded Liability' },
];

const ulDetails = [
  {
    n: 1, title: 'Pipeline kick-off config',
    code: 'pipelineConfigSchema',
    details: [
      'Modal captures the Post-YE Window (X days) used for the bank-statement scan.',
      'Persisted on TestExecution.configJson; read by every downstream step.',
    ],
    mode: 'User',
  },
  {
    n: 2, title: 'Request post-YE bank statements',
    code: 'request_documents',
    details: [
      'PortalRequest asks the client for bank statements / transaction exports covering Period.End+1 to Period.End+X for every relevant bank account.',
      'Response may be individual files or a batch (PDF / XLSX / CSV / zip).',
      'Outstanding item created; pipeline pauses until the team commits.',
    ],
    mode: 'PAUSE portal_response',
  },
  {
    n: 3, title: 'Extract post-YE payments',
    code: 'extract_post_ye_bank_payments',
    details: [
      'Parses each returned file:',
      '  • CSV / XLSX → structured column discovery (Date, Payee, Debit / Amount Out, Reference, Narrative).',
      '  • PDF statements → re-uses the existing bank-statement AI extractor.',
      'Keeps only debit rows (payments) dated inside [Period.End+1, Period.End+X].',
      'Emits data_table: date · payee · amount · reference · narrative · bank_account · source_document. This becomes the Unrecorded Liabilities population.',
    ],
    mode: 'Continue',
  },
  {
    n: 4, title: 'Request creditors & accruals listing',
    code: 'request_accruals_listing',
    details: [
      'Reuses the Accruals action: requests the client’s creditors / accruals listing as at Period.End so the verify step can look up whether a matching creditor already exists in the TB / ledger.',
      'Same reconcile-to-TB loop as the accruals test.',
    ],
    mode: 'PAUSE portal_response',
  },
  {
    n: 5, title: 'Select UL sample',
    code: 'select_unrecorded_liabilities_sample',
    details: [
      'Three-layer sampling engine:',
      '  1. Above-threshold — every payment ≥ threshold (explicit or performance materiality) is auto-selected.',
      '  2. AI risk rank — remaining payments are scored for "likely prior-period obligation" (payee keywords, prior-period references, round-£ values, recency). Top-N selected.',
      '  3. Residual method — MUS / stratified / haphazard applied to what is left.',
      'Any of the three layers can be disabled per run. Each selected row is tagged with a select_reason so the auditor has a clear justification per sample item.',
    ],
    mode: 'Continue',
  },
  {
    n: 6, title: 'Request supporting documents',
    code: 'request_documents',
    details: [
      'Auditor selects one or more DocumentTypes for the sampled payments: Supplier invoice(s), Remittance advice / payment breakdown, Supplier statement, Purchase order / contract, GRN / delivery note, Service completion evidence.',
      'PortalRequest created; individual or batch attachments; 2-minute commit window grouping.',
    ],
    mode: 'PAUSE portal_response',
  },
  {
    n: 7, title: 'Extract supporting evidence',
    code: 'extract_accruals_evidence',
    details: [
      'Same AI extractor as the accruals pipeline — per document: supplier, amount, invoice date, service period, description, references.',
    ],
    mode: 'Continue',
  },
  {
    n: 8, title: 'Verify UL sample (R/O/G markers)',
    code: 'verify_unrecorded_liabilities_sample',
    details: [
      'For each sampled payment:',
      '  (a) Match evidence by payee + amount.',
      '  (b) Classify obligation date (service end → invoice date → payment date) vs Period.End.',
      '  (c) If obligation > YE → GREEN (Post-YE Obligation — payment correctly outside the audited year).',
      '  (d) If obligation ≤ YE → search the creditors / accruals listing for a matching supplier + amount (within tolerance). Found → GREEN (In TB). Not found → RED (Unrecorded Liability).',
      '  (e) Detect service period spanning YE before finalising Red — if spread, time-apportion and re-test the ≤-YE portion against any matching creditor → GREEN / RED / ORANGE (Spread).',
      'Markers persisted to sample_item_markers; Red items tagged "Unrecorded Liability" which propagates into the error-schedule description.',
    ],
    mode: 'Continue',
  },
  {
    n: 9, title: 'Findings & Conclusions',
    code: 'Runtime UI',
    details: [
      'Every RED item appears with Date / Description / Amount plus Error and In TB buttons (mutually exclusive).',
      'Error → AuditErrorSchedule row tagged “Unrecorded Liability”, linked to the sample marker and evidence refs.',
      'In TB → resolution recorded without booking an error.',
      'Auditor can override any marker colour; override is timestamped with user name and a reason.',
    ],
    mode: 'User',
  },
  {
    n: 10, title: 'Team review',
    code: 'team_review',
    details: [
      'Final sign-off by the reviewer / RI. Confirms each Red item is resolved and the test is complete.',
    ],
    mode: 'PAUSE review',
  },
];

// ═════════════════════════════════════════════════════════════════════════
//   TEST 3 — GROSS MARGIN ANALYTICAL REVIEW
// ═════════════════════════════════════════════════════════════════════════
const gmConfig = [
  { label: 'Comparison Periods', type: 'multiselect', desc: 'Which periods / benchmarks to compare current-year GM % against: Prior year actual, Multiple prior periods, Budget / forecast, Industry benchmark.' },
  { label: 'Expectation Model', type: 'select', desc: 'Consistency with PY %, Consistency with average of prior periods, Comparison to budgeted margin %, Reasonableness (PY margin applied to CY movements).' },
  { label: 'Type of Analysis', type: 'select', desc: 'Trend analysis, Ratio analysis (gross margin %), Reasonableness test, Combination — drives the wording of the final audit conclusion.' },
  { label: 'Tolerance — % point movement', type: 'number', desc: 'Flag a variance if the GM% movement exceeds this many percentage points (default 2pp).' },
  { label: 'Tolerance — × Performance Materiality', type: 'number', desc: 'Flag a variance if the £ impact on profit exceeds this multiple of performance materiality (default 1× PM).' },
];

const gmFlow = [
  { index: 0, title: 'Request GM Data', code: 'request_gm_data', role: 'Revenue · COS · Budget · PY · TB reconcile' },
  { index: 1, title: 'Compute GM Analysis', code: 'compute_gm_analysis', role: 'GM% per period · Variance · Tolerance flag' },
  { index: 2, title: 'Request Explanations', code: 'request_gm_explanations', role: 'Portal · Only for flagged variances' },
  { index: 3, title: 'AI Plausibility Assessment', code: 'assess_gm_explanations', role: 'R/O/G per variance · Additional procedures prompt' },
  { index: 4, title: 'Team Review', code: 'team_review', role: 'Sign-off · Error Schedule · In TB' },
];

const gmDetails = [
  {
    n: 1, title: 'Pipeline kick-off config',
    code: 'pipelineConfigSchema',
    details: [
      'The pop-up captures: Comparison Periods (multi-select), Expectation Model, Type of Analysis, and the two tolerance thresholds (% point and × PM).',
      'All settings persist on TestExecution.configJson so every downstream step and every resume uses the same assumptions.',
    ],
    mode: 'User',
  },
  {
    n: 2, title: 'Request GM data',
    code: 'request_gm_data',
    details: [
      'PortalRequest asks the client for: revenue and cost-of-sales breakdowns for CY and comparison periods, budget / forecast figures used by management, and any explanations already prepared for significant movements.',
      'Outstanding item created; pipeline pauses until the team commits.',
    ],
    mode: 'PAUSE portal_response',
  },
  {
    n: 3, title: 'Parse & reconcile CY to TB',
    code: 'request_gm_data (phase: data_received)',
    details: [
      'Handler parses the returned file into one row per period (period_label, revenue, cost_of_sales, gross_profit, gm_pct, source).',
      'Sums TB rows mapped to Revenue / Sales / Turnover and Cost-of-Sales FS lines; compares magnitudes to the CY row from the submitted listing (1% tolerance).',
      'Mismatch → raises an outstanding follow-up (“CY revenue/COS does not agree to TB”) and pauses again.',
      'Reconciled → continues with the parsed listing.',
    ],
    mode: 'Continue / Pause',
  },
  {
    n: 4, title: 'Compute GM analysis',
    code: 'compute_gm_analysis',
    details: [
      'Computes GM % per period; absolute and percentage movements between periods; variance vs budget; and an Expected GM % derived from the selected model.',
      'Auto-flags any variance that breaches either tolerance: (i) | movement | > tolerance_pct (percentage points), or (ii) | £ impact on profit | > tolerance_pm_multiple × PM.',
      'Flagged items get an initial Amber status on the variance table and carry a flag_reason describing which rule tripped.',
      'Emits calculations (period table) and variances (comparison table) to the UI.',
    ],
    mode: 'Continue',
  },
  {
    n: 5, title: 'Request management explanations',
    code: 'request_gm_explanations',
    details: [
      'If no variance was flagged, the step short-circuits (no portal request, pipeline continues).',
      'Otherwise, a single PortalRequest lists every flagged variance (actual vs expected, £ impact) and asks for: business reason (pricing / mix / volume / input costs / FX / one-offs) and supporting evidence (management reports, pricing analysis, cost breakdowns).',
      'Tracked on the Outstanding tab until the team commits the response.',
    ],
    mode: 'PAUSE portal_response / Skip',
  },
  {
    n: 6, title: 'AI plausibility assessment',
    code: 'assess_gm_explanations',
    details: [
      'Server-side AI call (Llama 3.3 70B) with the full variance table, per-period calculations and explanation blob.',
      'Returns a verdict per variance: GREEN (adequately explained), ORANGE (weak / partially supported), RED (not explained or inconsistent with evidence).',
      'Each verdict is persisted as a sample_item_marker row (same schema used by the accruals & UL tests) so override and resolution flows work identically.',
      'If the AI call fails, every variance falls back to Orange with a “review manually” reason — nothing silently passes.',
      'Emits additional_procedures_prompt: a banner telling the auditor that ToD (test-of-details) may be required if Red or Orange items remain.',
    ],
    mode: 'Continue',
  },
  {
    n: 7, title: 'Findings & Conclusions',
    code: 'Runtime UI',
    details: [
      'Red items land in Findings with: Period, GM% movement, £ impact on profit, summary of missing / insufficient explanation.',
      'Two buttons per row: Error (red) and In TB (green). Selecting one clears the other. Error creates an AuditErrorSchedule row linked via sampleItemMarkerId with back-references to the GM calculation, the underlying revenue / COS figures, and the explanation record.',
      'A highlighted banner surfaces the additional_procedures_prompt when analytical evidence alone is not sufficient.',
      'Auditor override is available on every marker (user, timestamp, reason captured).',
    ],
    mode: 'User',
  },
  {
    n: 8, title: 'Team review',
    code: 'team_review',
    details: [
      'Final OutstandingItem for the reviewer / RI. Confirms tolerance settings, expectation model, AI verdicts and Red-item resolutions; signs off once complete.',
    ],
    mode: 'PAUSE review',
  },
];

// ═════════════════════════════════════════════════════════════════════════
//   PIPELINE ACTIONS CATALOG — reads SYSTEM_ACTIONS at build time
// ═════════════════════════════════════════════════════════════════════════

// Category presentation (colour chip + header fill) used in the catalog.
const CATEGORY_META = {
  evidence:     { label: 'Evidence',     fill: '3B82F6' },
  sampling:     { label: 'Sampling',     fill: 'F59E0B' },
  analysis:     { label: 'Analysis',     fill: '8B5CF6' },
  verification: { label: 'Verification', fill: '22C55E' },
  reporting:    { label: 'Reporting',    fill: '64748B' },
};

// Map every Action code to the tests that currently use it. This lets the
// catalog show which pipelines each Action is wired into, so the reader
// can tell at a glance which building blocks are "generic" and which are
// currently specific to one pipeline.
const ACTION_TESTS = {};
function tag(code, testName) {
  if (!ACTION_TESTS[code]) ACTION_TESTS[code] = [];
  if (!ACTION_TESTS[code].includes(testName)) ACTION_TESTS[code].push(testName);
}
// Year-End Accruals Test
['request_accruals_listing', 'select_sample', 'request_documents',
 'extract_accruals_evidence', 'verify_accruals_sample', 'team_review']
  .forEach(c => tag(c, 'Year-End Accruals'));
// Unrecorded Liabilities Test
['request_documents', 'extract_post_ye_bank_payments', 'request_accruals_listing',
 'select_unrecorded_liabilities_sample', 'extract_accruals_evidence',
 'verify_unrecorded_liabilities_sample', 'team_review']
  .forEach(c => tag(c, 'Unrecorded Liabilities'));
// Gross Margin AR
['request_gm_data', 'compute_gm_analysis', 'request_gm_explanations',
 'assess_gm_explanations', 'team_review']
  .forEach(c => tag(c, 'Gross Margin AR'));

// Render one Action's input or output rows as a compact 3-column table.
function schemaTable(schema, kind) {
  if (!Array.isArray(schema) || schema.length === 0) {
    return para('(none)', { italics: true, color: COLOUR.slate, size: 18, after: 80 });
  }
  const headerFill = kind === 'inputs' ? '334155' : '0F766E';
  const headerCells = ['Field', 'Type', 'Details'].map((h, i) => new TableCell({
    borders: thinBorders,
    shading: { fill: headerFill, type: ShadingType.CLEAR, color: 'auto' },
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    width: { size: [2200, 1100, 6060][i], type: WidthType.DXA },
    children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: 'FFFFFF', size: 18, font: 'Arial' })] })],
  }));
  const bodyRows = schema.map(f => {
    const flags = [];
    if (f.required) flags.push('required');
    if (f.source === 'auto') flags.push('auto');
    if (f.source === 'user') flags.push('user');
    if (f.defaultValue !== undefined) flags.push(`default ${Array.isArray(f.defaultValue) ? `[${f.defaultValue.join(',')}]` : String(f.defaultValue)}`);
    const detailRuns = [];
    detailRuns.push(new TextRun({ text: f.label || '', size: 18, font: 'Arial' }));
    if (flags.length > 0) {
      detailRuns.push(new TextRun({ text: ' · ', size: 16, color: COLOUR.slate, font: 'Arial' }));
      detailRuns.push(new TextRun({ text: flags.join(' · '), size: 16, italics: true, color: COLOUR.slate, font: 'Arial' }));
    }
    if (f.autoMapFrom) {
      detailRuns.push(new TextRun({ text: '  ← ', size: 16, color: COLOUR.slate, font: 'Arial' }));
      detailRuns.push(new TextRun({ text: f.autoMapFrom, size: 16, italics: true, color: COLOUR.slate, font: 'Consolas' }));
    }
    const paras = [new Paragraph({ spacing: { after: f.description ? 40 : 0 }, children: detailRuns })];
    if (f.description) {
      paras.push(new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: f.description, size: 16, color: COLOUR.slate, font: 'Arial' })] }));
    }
    if (Array.isArray(f.options) && f.options.length > 0) {
      const optText = f.options.map(o => o.label || o.value).slice(0, 8).join(' · ');
      const truncated = f.options.length > 8 ? `${optText} · …` : optText;
      paras.push(new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: `options: ${truncated}`, size: 16, italics: true, color: COLOUR.slate, font: 'Arial' })] }));
    }
    return new TableRow({
      children: [
        new TableCell({
          borders: thinBorders, margins: { top: 60, bottom: 60, left: 120, right: 120 },
          width: { size: 2200, type: WidthType.DXA },
          verticalAlign: VerticalAlign.TOP,
          children: [new Paragraph({ children: [new TextRun({ text: f.code, size: 18, font: 'Consolas' })] })],
        }),
        new TableCell({
          borders: thinBorders, margins: { top: 60, bottom: 60, left: 120, right: 120 },
          width: { size: 1100, type: WidthType.DXA },
          verticalAlign: VerticalAlign.TOP,
          children: [new Paragraph({ children: [new TextRun({ text: f.type, italics: true, size: 16, color: COLOUR.slate, font: 'Consolas' })] })],
        }),
        new TableCell({
          borders: thinBorders, margins: { top: 60, bottom: 60, left: 120, right: 120 },
          width: { size: 6060, type: WidthType.DXA },
          verticalAlign: VerticalAlign.TOP,
          children: paras,
        }),
      ],
    });
  });
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [2200, 1100, 6060],
    rows: [new TableRow({ tableHeader: true, children: headerCells }), ...bodyRows],
  });
}

// Card for a single Action: coloured header bar + description + inputs + outputs.
function actionCard(a) {
  const meta = CATEGORY_META[a.category] || { label: a.category, fill: COLOUR.slate };
  const usedIn = ACTION_TESTS[a.code] || [];

  // Header bar (1-row, 1-cell table filled with the category colour).
  const header = new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [CONTENT_WIDTH],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: {
              top: { style: BorderStyle.SINGLE, size: 8, color: meta.fill },
              left: { style: BorderStyle.SINGLE, size: 8, color: meta.fill },
              right: { style: BorderStyle.SINGLE, size: 8, color: meta.fill },
              bottom: { style: BorderStyle.SINGLE, size: 8, color: meta.fill },
            },
            shading: { fill: meta.fill, type: ShadingType.CLEAR, color: 'auto' },
            margins: { top: 80, bottom: 80, left: 160, right: 160 },
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            children: [
              new Paragraph({
                spacing: { after: 20 },
                children: [
                  new TextRun({ text: meta.label.toUpperCase(), bold: true, color: 'FFFFFF', size: 18, font: 'Arial' }),
                  new TextRun({ text: '    ', size: 18 }),
                  new TextRun({ text: a.name, bold: true, color: 'FFFFFF', size: 24, font: 'Arial' }),
                ],
              }),
              new Paragraph({
                spacing: { after: 0 },
                children: [new TextRun({ text: a.code, color: 'F1F5F9', size: 18, font: 'Consolas' })],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const children = [header];

  // Used-in chip row (blank if unused in any of the three seeded tests).
  if (usedIn.length > 0) {
    children.push(new Paragraph({
      spacing: { before: 80, after: 80 },
      children: [
        new TextRun({ text: 'Used in: ', size: 18, bold: true, color: COLOUR.slate, font: 'Arial' }),
        new TextRun({ text: usedIn.join(' · '), size: 18, color: COLOUR.slate, font: 'Arial' }),
      ],
    }));
  } else {
    children.push(new Paragraph({
      spacing: { before: 80, after: 80 },
      children: [new TextRun({ text: 'Used in: (generic — available to wire into new tests)', size: 18, italics: true, color: COLOUR.slate, font: 'Arial' })],
    }));
  }

  children.push(new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text: a.description, size: 20, font: 'Arial' })],
  }));

  children.push(para('Inputs', { bold: true, size: 20, after: 60 }));
  children.push(schemaTable(a.inputSchema, 'inputs'));
  children.push(spacer(100));

  children.push(para('Outputs', { bold: true, size: 20, after: 60 }));
  children.push(schemaTable(a.outputSchema, 'outputs'));
  children.push(spacer(240));

  return children;
}

function buildCatalogAppendix() {
  const children = [];
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: true,
    children: [new Bookmark({ id: 'actions-catalog', children: [new TextRun({ text: 'Appendix — Pipeline Actions Catalog', bold: true, size: 32 })] })],
  }));
  children.push(para('A Pipeline Action is a self-contained, server-side unit of audit work exposed by the platform. Every pipeline Test — including the three documented above — is just an ordered chain of Actions with inputs wired to the outputs of earlier steps. Because Actions are registered in a global catalog (firmId null, isSystem true), they can be re-used across any number of Tests without duplication.', { size: 22, after: 140 }));
  children.push(para('Each card below gives:', { size: 22, after: 60 }));
  children.push(bullet('Category chip (Evidence, Sampling, Analysis, Verification, Reporting) and the Action\u2019s unique code.'));
  children.push(bullet('Which of the currently-seeded Tests reference this Action (so you can tell reusable building-blocks from pipeline-specific ones).'));
  children.push(bullet('Inputs — the fields the Action expects, the type, how they are sourced (user prompt or auto-mapped from an earlier step / engagement context), defaults, and any fixed options.'));
  children.push(bullet('Outputs — the fields the Action emits, which any later step can consume via $prev.<field> or $step.<N>.<field> bindings.'));
  children.push(spacer(120));
  children.push(para('To compose a new Test, add a MethodologyTest record with executionMode = action_pipeline, then add one TestActionStep per position in the chain pointing at the Action you want at that step plus the input bindings. The runtime engine pauses automatically on any Action that returns action: \u2018pause\u2019 (portal response, sampling selection, team review, etc.) and resumes when the user commits the pending step.', { size: 22, after: 200 }));

  // Group by category in the presentation order that matches the runtime
  // Pipelines admin UI.
  const order = ['evidence', 'sampling', 'analysis', 'verification', 'reporting'];
  for (const cat of order) {
    const inCat = SYSTEM_ACTIONS.filter(a => a.category === cat);
    if (inCat.length === 0) continue;
    const meta = CATEGORY_META[cat] || { label: cat, fill: COLOUR.slate };
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 240, after: 120 },
      children: [
        new TextRun({ text: meta.label + ' Actions', bold: true, size: 28, color: meta.fill, font: 'Arial' }),
        new TextRun({ text: `   (${inCat.length})`, size: 22, color: COLOUR.slate, font: 'Arial' }),
      ],
    }));
    for (const a of inCat) {
      for (const block of actionCard(a)) children.push(block);
    }
  }

  return children;
}

// ═════════════════════════════════════════════════════════════════════════
//   DOCUMENT ASSEMBLY
// ═════════════════════════════════════════════════════════════════════════
function testSection({ id, title, summary, chainOrder, config, flow, details, accent }) {
  const sectionChildren = [];
  sectionChildren.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: true,
    children: [new Bookmark({ id, children: [new TextRun({ text: title, bold: true, font: 'Arial', size: 32 })] })],
  }));
  sectionChildren.push(para(summary, { after: 200, size: 22 }));

  sectionChildren.push(para('Action chain', { heading: HeadingLevel.HEADING_2, bold: true, size: 26, before: 120, after: 120 }));
  sectionChildren.push(para(chainOrder, { italics: true, size: 20, color: COLOUR.slate, after: 200 }));

  sectionChildren.push(para('Kick-off configuration pop-up', { heading: HeadingLevel.HEADING_2, bold: true, size: 26, before: 120, after: 120 }));
  sectionChildren.push(para('Captured once, at the start of every run, and persisted on TestExecution.configJson for every downstream action to read via $ctx.execution.config.', { size: 20, color: COLOUR.slate, after: 120 }));
  sectionChildren.push(configTable(config, accent));
  sectionChildren.push(spacer(200));

  sectionChildren.push(para('Flow chart', { heading: HeadingLevel.HEADING_2, bold: true, size: 26, before: 120, after: 120 }));
  for (const block of buildFlowChart(flow, accent)) sectionChildren.push(block);
  sectionChildren.push(spacer(200));

  sectionChildren.push(para('Detailed steps', { heading: HeadingLevel.HEADING_2, bold: true, size: 26, before: 200, after: 120 }));
  sectionChildren.push(stepDetailTable(details, accent));

  return sectionChildren;
}

const doc = new Document({
  creator: 'Acumon Intelligence',
  title: 'Pipeline Tests — Technical Reference',
  description: 'Detailed steps and flow charts for the three seeded pipeline audit tests.',
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 320, after: 200 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 160, after: 100 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [
        { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
      ]},
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
        margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
      },
    },
    children: [
      // Title block
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 2400, after: 240 },
        children: [new TextRun({ text: 'Acumon Intelligence', bold: true, size: 28, color: COLOUR.slate, font: 'Arial' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [new TextRun({ text: 'Pipeline Audit Tests', bold: true, size: 48, font: 'Arial' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [new TextRun({ text: 'Technical Reference — Detailed Steps & Flow Charts', size: 24, color: COLOUR.slate, font: 'Arial' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 2400 },
        children: [new TextRun({ text: 'April 2026', size: 22, italics: true, color: COLOUR.slate, font: 'Arial' })],
      }),

      // Introduction
      new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun({ text: 'Overview', bold: true, size: 32 })] }),
      para('This document describes the three action-pipeline audit tests seeded for the firm in April 2026. All three are built on the same execution engine (a linear chain of Actions whose outputs feed the next step), share the same Outstanding tab routing, use the same Red / Orange / Green marker schema, and resolve findings through the same Error vs In-TB flow into the engagement Error Schedule.', { size: 22 }),
      para('Each test starts with a pop-up that captures the run-specific configuration, then runs a chain of server-side Actions that pause the pipeline whenever client input is required. Every document the client returns is processed server-side, every AI call happens server-side, and every marker / finding persists through the generic sample_item_markers + audit_error_schedules tables.', { size: 22 }),
      para('The tests are:', { size: 22, after: 60 }),
      bullet('Year-End Accruals Test — samples the client-supplied accruals listing at year end and verifies each accrual against post-YE invoices and payments.'),
      bullet('Unrecorded Liabilities Test — samples post-YE bank payments and asks: is this payment for an obligation of the audited year, and if so, is there a matching creditor or accrual at year end?'),
      bullet('Gross Margin Analytical Review — computes GM % per period against an expectation model, flags tolerance breaches, and uses AI to assess the plausibility of management’s explanations.'),

      para('Shared infrastructure', { heading: HeadingLevel.HEADING_2, bold: true, size: 26, before: 200, after: 120 }),
      bullet('Outstanding tab: every portal request and every follow-up the pipeline raises shows up for the audit team with the right routing (assigned to client vs team).'),
      bullet('Sample-item markers: one row per sampled item / flagged variance with colour, reason, calculation JSON, and timestamped override fields. The same table backs all three tests.'),
      bullet('Error schedule linkage: resolving a Red item as Error creates an AuditErrorSchedule row linked back to the sample marker. Resolving as In TB records the decision without booking an error.'),
      bullet('Override tracking: any marker colour can be changed by the auditor; the override captures user, timestamp, reason and the handler’s original colour.'),

      // Three test sections
      ...testSection({
        id: 'accruals',
        title: '1. Year-End Accruals Test',
        summary: 'Samples the client-supplied accruals listing at year end and verifies each accrual against post-year-end invoices and payments. Handles straightforward accruals, mis-dated obligations, missing support, and service periods that span the year end (time-apportioned).',
        chainOrder: 'request_accruals_listing → select_sample → request_documents → extract_accruals_evidence → verify_accruals_sample → team_review',
        config: accrualsConfig,
        flow: accrualsFlow,
        details: accrualsDetails,
        accent: COLOUR.accruals,
      }),

      ...testSection({
        id: 'ul',
        title: '2. Unrecorded Liabilities Test',
        summary: 'Samples post-year-end bank payments and for each asks whether the obligation relates to the audited year and, if so, whether there is a matching creditor or accrual at year end. Includes a three-layer sampling engine: above-performance-materiality auto-selection, AI risk ranking of the remainder, and residual MUS / stratified / haphazard sampling.',
        chainOrder: 'request_documents (bank statements) → extract_post_ye_bank_payments → request_accruals_listing (creditors) → select_unrecorded_liabilities_sample → request_documents (supporting) → extract_accruals_evidence → verify_unrecorded_liabilities_sample → team_review',
        config: ulConfig,
        flow: ulFlow,
        details: ulDetails,
        accent: COLOUR.ul,
      }),

      ...testSection({
        id: 'gm',
        title: '3. Gross Margin Analytical Review',
        summary: 'Analytical review of gross margin %. Computes GM % per period; derives an expected GM % from the selected model (prior year, average of priors, budget, or reasonableness); auto-flags variances that breach the percentage-point or PM-linked tolerance; requests management explanations for flagged variances; and uses AI plausibility assessment to assign a Red / Orange / Green verdict per variance.',
        chainOrder: 'request_gm_data → compute_gm_analysis → request_gm_explanations → assess_gm_explanations → team_review',
        config: gmConfig,
        flow: gmFlow,
        details: gmDetails,
        accent: COLOUR.gm,
      }),

      // Appendix
      new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun({ text: 'Appendix — Colour Markers', bold: true, size: 32 })] }),
      para('All three tests use the same Red / Orange / Green marker vocabulary, persisted in the sample_item_markers table. The semantic meaning of each colour differs per test.', { size: 22, after: 120 }),

      new Table({
        width: { size: CONTENT_WIDTH, type: WidthType.DXA },
        columnWidths: [1400, 2650, 2650, 2660],
        rows: [
          new TableRow({
            tableHeader: true,
            children: ['', 'Accruals', 'Unrecorded Liabilities', 'Gross Margin'].map((t, i) => new TableCell({
              borders: thinBorders,
              shading: { fill: COLOUR.slate, type: ShadingType.CLEAR, color: 'auto' },
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              width: { size: [1400, 2650, 2650, 2660][i], type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, color: 'FFFFFF', font: 'Arial', size: 20 })] })],
            })),
          }),
          new TableRow({
            children: [
              new TableCell({
                borders: thinBorders, margins: { top: 60, bottom: 60, left: 120, right: 120 },
                shading: { fill: COLOUR.green, type: ShadingType.CLEAR, color: 'auto' },
                width: { size: 1400, type: WidthType.DXA },
                children: [new Paragraph({ children: [new TextRun({ text: 'GREEN', bold: true, color: 'FFFFFF', size: 22, font: 'Arial' })] })],
              }),
              new TableCell({ borders: thinBorders, margins: { top: 60, bottom: 60, left: 120, right: 120 }, width: { size: 2650, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: 'Accrual supported (obligation ≤ YE, subsequent invoice / payment within window).', size: 20, font: 'Arial' })] })] }),
              new TableCell({ borders: thinBorders, margins: { top: 60, bottom: 60, left: 120, right: 120 }, width: { size: 2650, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: 'Post-YE obligation (correctly outside audited year) OR obligation ≤ YE matched to a creditor in the listing (In TB).', size: 20, font: 'Arial' })] })] }),
              new TableCell({ borders: thinBorders, margins: { top: 60, bottom: 60, left: 120, right: 120 }, width: { size: 2660, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: 'Variance adequately explained and supported by management.', size: 20, font: 'Arial' })] })] }),
            ],
          }),
          new TableRow({
            children: [
              new TableCell({
                borders: thinBorders, margins: { top: 60, bottom: 60, left: 120, right: 120 },
                shading: { fill: COLOUR.orange, type: ShadingType.CLEAR, color: 'auto' },
                width: { size: 1400, type: WidthType.DXA },
                children: [new Paragraph({ children: [new TextRun({ text: 'ORANGE', bold: true, color: 'FFFFFF', size: 22, font: 'Arial' })] })],
              }),
              new TableCell({ borders: thinBorders, margins: { top: 60, bottom: 60, left: 120, right: 120 }, width: { size: 2650, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: 'Support missing within window, or service period spans YE (Spread) before apportionment.', size: 20, font: 'Arial' })] })] }),
              new TableCell({ borders: thinBorders, margins: { top: 60, bottom: 60, left: 120, right: 120 }, width: { size: 2650, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: 'Support missing, or service spans YE with no matching apportioned creditor (Spread).', size: 20, font: 'Arial' })] })] }),
              new TableCell({ borders: thinBorders, margins: { top: 60, bottom: 60, left: 120, right: 120 }, width: { size: 2660, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: 'Explanation weak or partially supported — consider additional substantive procedures.', size: 20, font: 'Arial' })] })] }),
            ],
          }),
          new TableRow({
            children: [
              new TableCell({
                borders: thinBorders, margins: { top: 60, bottom: 60, left: 120, right: 120 },
                shading: { fill: COLOUR.red, type: ShadingType.CLEAR, color: 'auto' },
                width: { size: 1400, type: WidthType.DXA },
                children: [new Paragraph({ children: [new TextRun({ text: 'RED', bold: true, color: 'FFFFFF', size: 22, font: 'Arial' })] })],
              }),
              new TableCell({ borders: thinBorders, margins: { top: 60, bottom: 60, left: 120, right: 120 }, width: { size: 2650, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: 'Incorrect accrual (obligation > YE), amount mismatch vs subsequent invoice, or apportionment mismatch.', size: 20, font: 'Arial' })] })] }),
              new TableCell({ borders: thinBorders, margins: { top: 60, bottom: 60, left: 120, right: 120 }, width: { size: 2650, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: 'Unrecorded liability — obligation ≤ YE with no matching creditor.', size: 20, font: 'Arial' })] })] }),
              new TableCell({ borders: thinBorders, margins: { top: 60, bottom: 60, left: 120, right: 120 }, width: { size: 2660, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: 'Variance not explained or inconsistent with the underlying financial evidence.', size: 20, font: 'Arial' })] })] }),
            ],
          }),
        ],
      }),

      spacer(200),
      para('In all three tests, every Red item flows to Findings & Conclusions with two mutually-exclusive resolution buttons (Error / In TB). Selecting Error creates an AuditErrorSchedule row tagged with the marker type (e.g. “Unrecorded Liability”) and back-linked to the sample marker and the supporting evidence record. Selecting In TB records the resolution without booking an error but preserves traceability.', { size: 22, after: 120 }),
      para('Any user override of a marker colour is timestamped with the user identity, the reason given, and the handler’s original colour — so the reviewer can always see whether the outcome was system-generated or auditor-amended.', { size: 22 }),

      // Pipeline Actions Catalog — one card per registered system Action.
      ...buildCatalogAppendix(),
    ],
  }],
});

// ── Write ────────────────────────────────────────────────────────────────
const outputPath = 'C:\\Users\\stuart\\Downloads\\Acumon-Pipeline-Tests-Reference.docx';
Packer.toBuffer(doc).then(buf => {
  try {
    fs.writeFileSync(outputPath, buf);
    console.log('Wrote:', outputPath);
  } catch (err) {
    if (err.code === 'EBUSY' || err.code === 'EACCES') {
      // The file is locked (almost always because it is open in Word).
      // Fall back to a timestamped sibling path so the user still gets
      // the latest version without having to close the previous one.
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const fallback = outputPath.replace(/\.docx$/, `-${stamp}.docx`);
      fs.writeFileSync(fallback, buf);
      console.log('Primary file is locked (open in Word?). Wrote fallback:');
      console.log('  ', fallback);
    } else {
      throw err;
    }
  }
  console.log('Size:', (buf.length / 1024).toFixed(1), 'KB');
});
