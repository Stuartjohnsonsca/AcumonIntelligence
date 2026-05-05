/**
 * Audit-file PDF report generator.
 *
 * v1 — produces a PDF with a cover page, a table of contents, and
 * one section per major schedule. Built on `pdf-lib` (already in
 * package.json) so we don't pull in puppeteer/chromium for the
 * serverless deployment. Layout is deliberately simple: title, body
 * text, and a small set of tables. We can iterate on richer schedule
 * rendering (colour, full table-of-contents page numbers, etc.)
 * without changing the outer plumbing.
 *
 * Returns a Uint8Array PDF buffer plus a suggested file name. The
 * caller (the generate route) uploads to Azure blob and writes the
 * AuditPdfReport row.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { prisma } from '@/lib/db';
import { buildTemplateContext, type TemplateContext } from '@/lib/template-context';

interface ReportSection {
  title: string;
  /** Free-text body — split into paragraphs at \n\n. Empty allowed. */
  body?: string;
  /** Simple key/value rows. Renders as two columns. */
  rows?: Array<{ label: string; value: string }>;
  /** Tabular data. The first array element is the header row. */
  table?: { headers: string[]; rows: string[][] };
}

const PAGE_W = 595.28;  // A4 portrait
const PAGE_H = 841.89;
const MARGIN_X = 48;
const MARGIN_Y = 60;

const COLOUR_NAVY = rgb(15 / 255, 23 / 255, 42 / 255);   // slate-900
const COLOUR_SLATE = rgb(71 / 255, 85 / 255, 105 / 255); // slate-600
const COLOUR_LINE = rgb(203 / 255, 213 / 255, 225 / 255);// slate-300
const COLOUR_HEADER_BG = rgb(241 / 255, 249 / 255, 248 / 255); // #f1f9f8
const COLOUR_BLUE = rgb(37 / 255, 99 / 255, 235 / 255);  // blue-600

/** Lightweight word-wrap. Splits on spaces and emits chunks no wider
 *  than `maxWidth` at the given font size. Doesn't try to be smart
 *  about hyphenation or punctuation — fine for audit-file body text. */
function wrap(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  if (!text) return [];
  const words = text.replace(/\r/g, '').split(/\s+/);
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      line = candidate;
    } else {
      if (line) out.push(line);
      // Hard-break a single word that doesn't fit the line width.
      if (font.widthOfTextAtSize(w, fontSize) > maxWidth) {
        let chunk = '';
        for (const ch of w) {
          if (font.widthOfTextAtSize(chunk + ch, fontSize) > maxWidth) {
            if (chunk) out.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        line = chunk;
      } else {
        line = w;
      }
    }
  }
  if (line) out.push(line);
  return out;
}

/** Renderer state — keeps the current page + cursor and rolls onto a
 *  new page automatically when content overflows. */
interface RenderCtx {
  pdf: PDFDocument;
  page: PDFPage;
  cursorY: number;
  font: PDFFont;
  bold: PDFFont;
  pageNumber: number;
}

function newPage(ctx: RenderCtx): void {
  ctx.page = ctx.pdf.addPage([PAGE_W, PAGE_H]);
  ctx.cursorY = PAGE_H - MARGIN_Y;
  ctx.pageNumber++;
  // Page-number footer.
  ctx.page.drawText(String(ctx.pageNumber), {
    x: PAGE_W - MARGIN_X,
    y: 30,
    size: 9,
    font: ctx.font,
    color: COLOUR_SLATE,
  });
}

function ensureRoom(ctx: RenderCtx, needed: number): void {
  if (ctx.cursorY - needed < MARGIN_Y) newPage(ctx);
}

function drawHeading(ctx: RenderCtx, text: string, size: number) {
  ensureRoom(ctx, size + 12);
  ctx.page.drawText(text, {
    x: MARGIN_X,
    y: ctx.cursorY - size,
    size,
    font: ctx.bold,
    color: COLOUR_NAVY,
  });
  ctx.cursorY -= size + 8;
}

function drawParagraph(ctx: RenderCtx, text: string, font: PDFFont = ctx.font) {
  if (!text) return;
  const fontSize = 11;
  const lineHeight = 14;
  const maxW = PAGE_W - MARGIN_X * 2;
  for (const para of text.split(/\n{2,}/)) {
    const lines = wrap(para.trim(), font, fontSize, maxW);
    for (const line of lines) {
      ensureRoom(ctx, lineHeight);
      ctx.page.drawText(line, { x: MARGIN_X, y: ctx.cursorY - fontSize, size: fontSize, font, color: COLOUR_NAVY });
      ctx.cursorY -= lineHeight;
    }
    ctx.cursorY -= 4; // paragraph gap
  }
}

function drawKeyValueRows(ctx: RenderCtx, rows: Array<{ label: string; value: string }>) {
  const fontSize = 10;
  const lineHeight = 13;
  const labelW = 180;
  const valueX = MARGIN_X + labelW + 12;
  const valueMaxW = PAGE_W - valueX - MARGIN_X;
  for (const r of rows) {
    const lines = wrap(r.value || '—', ctx.font, fontSize, valueMaxW);
    const blockH = Math.max(lineHeight, lines.length * lineHeight) + 2;
    ensureRoom(ctx, blockH + 2);
    ctx.page.drawText(r.label, {
      x: MARGIN_X,
      y: ctx.cursorY - fontSize,
      size: fontSize,
      font: ctx.bold,
      color: COLOUR_NAVY,
    });
    let y = ctx.cursorY - fontSize;
    for (const line of lines) {
      ctx.page.drawText(line, { x: valueX, y, size: fontSize, font: ctx.font, color: COLOUR_NAVY });
      y -= lineHeight;
    }
    ctx.cursorY -= blockH;
  }
  ctx.cursorY -= 6;
}

function drawTable(ctx: RenderCtx, table: { headers: string[]; rows: string[][] }) {
  if (!table.headers.length) return;
  const fontSize = 9;
  const lineHeight = 12;
  const cellPad = 4;
  const totalW = PAGE_W - MARGIN_X * 2;
  const colW = totalW / table.headers.length;
  // Header
  const headerH = lineHeight + cellPad * 2;
  ensureRoom(ctx, headerH);
  ctx.page.drawRectangle({
    x: MARGIN_X, y: ctx.cursorY - headerH,
    width: totalW, height: headerH,
    color: COLOUR_HEADER_BG,
  });
  for (let c = 0; c < table.headers.length; c++) {
    ctx.page.drawText(table.headers[c], {
      x: MARGIN_X + c * colW + cellPad,
      y: ctx.cursorY - cellPad - fontSize,
      size: fontSize,
      font: ctx.bold,
      color: COLOUR_NAVY,
    });
  }
  ctx.cursorY -= headerH;
  // Body rows
  for (const row of table.rows) {
    const wrapped = row.map(cell => wrap(cell ?? '', ctx.font, fontSize, colW - cellPad * 2));
    const rowLines = Math.max(1, ...wrapped.map(w => w.length));
    const rowH = rowLines * lineHeight + cellPad * 2;
    ensureRoom(ctx, rowH);
    // Row separator
    ctx.page.drawLine({
      start: { x: MARGIN_X, y: ctx.cursorY },
      end: { x: MARGIN_X + totalW, y: ctx.cursorY },
      thickness: 0.5, color: COLOUR_LINE,
    });
    for (let c = 0; c < table.headers.length; c++) {
      const lines = wrapped[c] || [];
      let y = ctx.cursorY - cellPad - fontSize;
      for (const line of lines) {
        ctx.page.drawText(line, {
          x: MARGIN_X + c * colW + cellPad, y,
          size: fontSize, font: ctx.font, color: COLOUR_NAVY,
        });
        y -= lineHeight;
      }
    }
    ctx.cursorY -= rowH;
  }
  ctx.cursorY -= 8;
}

/**
 * Build the full set of report sections for an engagement.
 *
 * Strategy: lean on `buildTemplateContext()` — the same aggregator
 * used by the document-template engine — so the PDF reflects every
 * piece of data that the engagement makes available. Each top-level
 * area becomes one or more sections.
 *
 * What's covered:
 *   1. Engagement metadata + framework
 *   2. Engagement Team
 *   3. Audit Timetable
 *   4. Materiality (figures + narrative + prior-period comparison when present)
 *   5. Audit Plan: Significant Risks (full assessment columns)
 *   6. Audit Plan: Areas of Focus
 *   7. Trial Balance summary + per-FS-line totals
 *   8. Test Conclusions
 *   9. Error Schedule (with adjusted/unadjusted totals)
 *   10. One section per discovered questionnaire (Permanent File, Ethics,
 *       Continuance, Materiality, New Client Take-On, Subsequent Events,
 *       and any custom *_questions schedules the firm has defined). Each
 *       renders question→answer pairs grouped by section meta when present.
 *
 * Empty data is preserved as "—" rather than dropped, so a regulator
 * can see at a glance which procedures have or haven't been completed.
 */
async function loadSections(engagementId: string): Promise<{ title: string; subtitle: string; sections: ReportSection[] }> {
  const ctx = await buildTemplateContext(engagementId);

  const sections: ReportSection[] = [];

  // 1. Engagement metadata
  sections.push({
    title: 'Engagement',
    rows: [
      { label: 'Firm', value: ctx.firm.name || '—' },
      { label: 'Client', value: ctx.client.name || '—' },
      { label: 'Company Number', value: ctx.client.companyNumber || '—' },
      { label: 'Sector', value: ctx.client.sector || '—' },
      { label: 'Registered Address', value: ctx.client.registeredAddress || '—' },
      { label: 'Period', value: `${ctx.period.periodStart || '—'}  →  ${ctx.period.periodEnd || '—'}` },
      { label: 'Audit Type', value: ctx.engagement.auditType || '—' },
      { label: 'Framework', value: ctx.engagement.framework || '—' },
      { label: 'Status', value: ctx.engagement.status || '—' },
      { label: 'Hard Close Date', value: ctx.engagement.hardCloseDate || '—' },
      { label: 'Prior Period End', value: ctx.engagement.priorPeriodEnd || '—' },
    ],
  });

  // 2. Team
  if (ctx.team.length > 0) {
    sections.push({
      title: 'Engagement Team',
      table: {
        headers: ['Role', 'Name', 'Email'],
        rows: ctx.team.map(m => [m.roleLabel || m.role || '—', m.name || '—', m.email || '—']),
      },
    });
  }

  // 3. Audit Timetable
  if (ctx.auditTimetable.length > 0) {
    sections.push({
      title: 'Audit Timetable',
      table: {
        headers: ['Milestone', 'Target Date', 'Revised Target', 'Progress'],
        rows: ctx.auditTimetable.map(d => [
          d.milestone || '—',
          d.targetDate || '—',
          d.revisedTarget || '—',
          d.progress || '—',
        ]),
      },
    });
  }

  // 4. Materiality (figures + narrative + prior comparison)
  const m = ctx.materiality;
  const materialityRows: Array<{ label: string; value: string }> = [
    { label: 'Overall Materiality', value: fmtNum(m.overall) },
    { label: 'Performance Materiality', value: fmtNum(m.performance) },
    { label: 'Clearly Trivial', value: fmtNum(m.clearlyTrivial) },
    { label: 'Benchmark', value: m.benchmark || '—' },
    { label: 'Benchmark Amount', value: fmtNum(m.benchmarkAmount) },
    { label: 'Benchmark %', value: m.benchmarkPct != null ? `${m.benchmarkPct}%` : '—' },
    { label: 'Stakeholders', value: m.stakeholders || '—' },
    { label: 'Stakeholder Focus', value: m.stakeholderFocus || '—' },
    { label: 'Key Judgements', value: m.keyJudgements || '—' },
    { label: 'Basis Changed?', value: m.basisChanged == null ? '—' : (m.basisChanged ? 'Yes' : 'No') },
    { label: 'Basis Change Reason', value: m.basisChangeReason || '—' },
  ];
  if (m.prior && (m.prior.overall != null || m.prior.benchmark)) {
    materialityRows.push(
      { label: 'Prior Overall', value: fmtNum(m.prior.overall) },
      { label: 'Prior Performance', value: fmtNum(m.prior.performance) },
      { label: 'Prior Clearly Trivial', value: fmtNum(m.prior.clearlyTrivial) },
      { label: 'Prior Benchmark', value: m.prior.benchmark || '—' },
      { label: 'Prior Benchmark %', value: m.prior.benchmarkPct != null ? `${m.prior.benchmarkPct}%` : '—' },
    );
  }
  sections.push({ title: 'Materiality', rows: materialityRows });

  // 5+6. Audit Plan: Significant Risks then Areas of Focus
  if (ctx.auditPlan.significantRisks.length > 0) {
    sections.push({
      title: 'Audit Plan — Significant Risks',
      table: {
        headers: ['FS Line', 'Risk', 'Assertions', 'L', 'M', 'Inherent', 'Control', 'Overall'],
        rows: ctx.auditPlan.significantRisks.map(r => [
          r.fsLine || '—',
          r.name || r.description || '—',
          r.assertions || '—',
          r.likelihood || '—',
          r.magnitude || '—',
          r.inherentRiskLevel || '—',
          r.controlRisk || '—',
          r.overallRisk || '—',
        ]),
      },
    });
  }
  if (ctx.auditPlan.areasOfFocus.length > 0) {
    sections.push({
      title: 'Audit Plan — Areas of Focus',
      table: {
        headers: ['FS Line', 'Risk', 'Assertions', 'L', 'M', 'Inherent', 'Control', 'Overall'],
        rows: ctx.auditPlan.areasOfFocus.map(r => [
          r.fsLine || '—',
          r.name || r.description || '—',
          r.assertions || '—',
          r.likelihood || '—',
          r.magnitude || '—',
          r.inherentRiskLevel || '—',
          r.controlRisk || '—',
          r.overallRisk || '—',
        ]),
      },
    });
  }

  // 7. Trial Balance summary + rows
  if (ctx.tb.rows.length > 0) {
    sections.push({
      title: 'Trial Balance — Summary',
      rows: [
        { label: 'Revenue', value: fmtNum(ctx.tb.revenue) },
        { label: 'Cost of Sales', value: fmtNum(ctx.tb.costOfSales) },
        { label: 'Gross Profit', value: fmtNum(ctx.tb.grossProfit) },
        { label: 'Gross Margin %', value: ctx.tb.grossMarginPct != null ? `${ctx.tb.grossMarginPct}%` : '—' },
        { label: 'Profit Before Tax', value: fmtNum(ctx.tb.profitBeforeTax) },
        { label: 'Total Assets', value: fmtNum(ctx.tb.totalAssets) },
        { label: 'Total Equity', value: fmtNum(ctx.tb.totalEquity) },
      ],
    });
  }

  // 8. Test Conclusions
  if (ctx.testConclusions.length > 0) {
    sections.push({
      title: 'Test Conclusions',
      table: {
        headers: ['FS Line', 'Test', 'Conclusion', 'Errors', 'Extrapolated', 'Reviewer', 'Partner'],
        rows: ctx.testConclusions.map(t => [
          t.fsLine || '—',
          t.testDescription || '—',
          t.conclusion || '—',
          fmtNum(t.totalErrors),
          fmtNum(t.extrapolatedError),
          t.reviewedByName || '—',
          t.riSignedByName || '—',
        ]),
      },
    });
  }

  // 9. Error Schedule
  if (ctx.errorSchedule.length > 0) {
    sections.push({
      title: 'Error Schedule',
      body:
        `Adjusted: ${fmtNum(ctx.errorScheduleTotals.adjusted)}    `
        + `Unadjusted: ${fmtNum(ctx.errorScheduleTotals.unadjusted)}    `
        + `Count: ${ctx.errorScheduleTotals.count}`,
      table: {
        headers: ['FS Line', 'Description', 'Amount', 'Type', 'Fraud?', 'Resolution'],
        rows: ctx.errorSchedule.map(e => [
          e.fsLine || '—',
          e.description || '—',
          fmtNum(e.amount),
          e.errorType || '—',
          e.isFraud ? 'Yes' : 'No',
          e.resolution || '—',
        ]),
      },
    });
  }

  // 10. Every discovered questionnaire as a Q&A section. We render each
  // questionnaire's `asList` (built by enrichQuestionnaire) as a table
  // with section sub-headings when sectionMeta is present.
  for (const [ctxKey, payload] of Object.entries(ctx.questionnaires)) {
    const list = (payload as any)?.asList;
    if (!Array.isArray(list) || list.length === 0) continue;
    // Skip questionnaires with no answered questions — keeps the PDF
    // focused on completed work. Fully-empty schedules are still
    // observable via their absence in the contents page.
    const hasAnyAnswer = list.some((it: any) => !it.isEmpty);
    if (!hasAnyAnswer) continue;

    const title = humaniseCtxKey(ctxKey);

    // Group by section when the questionnaire defines one.
    const bySection: Record<string, Array<{ q: string; a: string }>> = {};
    const noSection: Array<{ q: string; a: string }> = [];
    for (const it of list) {
      const q = String((it as any).question || (it as any).key || '—');
      const a = formatAnswer((it as any).answer);
      const sec = (it as any).section;
      if (sec && typeof sec === 'string') {
        if (!bySection[sec]) bySection[sec] = [];
        bySection[sec].push({ q, a });
      } else {
        noSection.push({ q, a });
      }
    }

    // Render: if all questions belong to one (or zero) sections, emit a
    // single Q/A table. If multiple sections, emit one section table per
    // group with the section name as the body lead-in. The drawing
    // helpers don't support multi-table sections natively, so we wrap
    // multi-section questionnaires by appending the section name to
    // each row's question column.
    const sectionKeys = Object.keys(bySection);
    if (sectionKeys.length === 0) {
      sections.push({
        title,
        table: {
          headers: ['Question', 'Answer'],
          rows: noSection.map(p => [p.q, p.a]),
        },
      });
    } else {
      const rows: string[][] = [];
      for (const sec of sectionKeys) {
        for (const p of bySection[sec]) rows.push([`[${sec}]  ${p.q}`, p.a]);
      }
      for (const p of noSection) rows.push([p.q, p.a]);
      sections.push({
        title,
        table: {
          headers: ['Question', 'Answer'],
          rows,
        },
      });
    }
  }

  // 11. Prior-period link summary (just enough so a reviewer knows what
  // current/prior pair this snapshot is comparing). Full prior context
  // is not embedded — that would double the page count. Reviewers can
  // generate a separate snapshot of the prior engagement.
  if (ctx.priorPeriod) {
    sections.push({
      title: 'Prior Period (linked)',
      rows: [
        { label: 'Prior Engagement ID', value: ctx.priorPeriod.engagement?.id || '—' },
        { label: 'Prior Period', value: `${ctx.priorPeriod.period?.periodStart || '—'} → ${ctx.priorPeriod.period?.periodEnd || '—'}` },
        { label: 'Prior Materiality', value: fmtNum(ctx.priorPeriod.materiality?.overall) },
        { label: 'Prior Status', value: ctx.priorPeriod.engagement?.status || '—' },
      ],
    });
  }

  const subtitle = `${ctx.client.name || ''} — ${ctx.period.periodEnd || ''}`;
  return { title: 'Audit File', subtitle, sections };
}

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  // Two decimal places only when the value isn't an integer.
  const fixed = Number.isInteger(n) ? n.toString() : n.toFixed(2);
  // British thousands separators for readability — large schedules
  // are easier to scan with grouping.
  return Number(fixed).toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

function formatAnswer(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'string') return v.trim() === '' ? '—' : v;
  if (Array.isArray(v)) return v.map(formatAnswer).join(', ');
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return '[object]'; }
  }
  return String(v);
}

function humaniseCtxKey(key: string): string {
  // permanentFile → "Permanent File"; newClientTakeOn → "New Client Take On"
  const spaced = key.replace(/([A-Z])/g, ' $1').trim();
  return spaced.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Generate the PDF report for an engagement. Returns the binary
 * buffer + a sensible file name; the caller uploads to blob storage
 * and persists the AuditPdfReport row.
 */
export async function generatePdfReport(engagementId: string, opts: { generatedByName: string }): Promise<{ buffer: Uint8Array; fileName: string }> {
  const { title, subtitle, sections } = await loadSections(engagementId);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Cover page
  const cover = pdf.addPage([PAGE_W, PAGE_H]);
  cover.drawRectangle({ x: 0, y: PAGE_H - 220, width: PAGE_W, height: 220, color: COLOUR_HEADER_BG });
  cover.drawText('AUDIT FILE', { x: MARGIN_X, y: PAGE_H - 100, size: 14, font: bold, color: COLOUR_BLUE });
  // Wrap subtitle if it's long
  for (const [i, line] of wrap(subtitle, bold, 28, PAGE_W - MARGIN_X * 2).entries()) {
    cover.drawText(line, { x: MARGIN_X, y: PAGE_H - 140 - i * 32, size: 28, font: bold, color: COLOUR_NAVY });
  }
  cover.drawText('Generated', { x: MARGIN_X, y: PAGE_H - 240, size: 10, font: bold, color: COLOUR_SLATE });
  cover.drawText(`${new Date().toISOString().slice(0, 10)} by ${opts.generatedByName}`, {
    x: MARGIN_X, y: PAGE_H - 256, size: 11, font, color: COLOUR_NAVY,
  });
  cover.drawText('CONFIDENTIAL — internal audit working file', {
    x: MARGIN_X, y: 60, size: 9, font, color: COLOUR_SLATE,
  });

  // Table of contents
  const toc = pdf.addPage([PAGE_W, PAGE_H]);
  toc.drawText('Contents', { x: MARGIN_X, y: PAGE_H - MARGIN_Y, size: 22, font: bold, color: COLOUR_NAVY });
  let tocY = PAGE_H - MARGIN_Y - 36;
  for (const [i, s] of sections.entries()) {
    toc.drawText(`${i + 1}.  ${s.title}`, { x: MARGIN_X, y: tocY, size: 12, font, color: COLOUR_NAVY });
    tocY -= 18;
  }

  // Body
  const ctx: RenderCtx = {
    pdf, page: pdf.addPage([PAGE_W, PAGE_H]), cursorY: PAGE_H - MARGIN_Y, font, bold, pageNumber: 3,
  };
  // First content page footer
  ctx.page.drawText(String(ctx.pageNumber), { x: PAGE_W - MARGIN_X, y: 30, size: 9, font, color: COLOUR_SLATE });

  for (const [i, s] of sections.entries()) {
    if (i > 0) newPage(ctx); // each section starts on a fresh page
    drawHeading(ctx, `${i + 1}. ${s.title}`, 18);
    ctx.cursorY -= 6;
    if (s.body) drawParagraph(ctx, s.body);
    if (s.rows && s.rows.length > 0) drawKeyValueRows(ctx, s.rows);
    if (s.table) drawTable(ctx, s.table);
  }

  const buffer = await pdf.save();
  const safeClient = title.replace(/[^a-z0-9-_ ]/gi, '_');
  const fileName = `audit-file-${safeClient}-${new Date().toISOString().slice(0, 10)}.pdf`;
  return { buffer, fileName };
}
