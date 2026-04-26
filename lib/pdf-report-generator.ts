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
 * Build the report sections. v1 covers Engagement metadata, Team,
 * Materiality, Audit Timetable, RMM, and Audit Plan (significant
 * risks + areas of focus). Future iterations will add Ethics,
 * Continuance, etc.
 */
async function loadSections(engagementId: string): Promise<{ title: string; subtitle: string; sections: ReportSection[] }> {
  const eng = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    include: {
      client: { select: { clientName: true } },
      period: { select: { startDate: true, endDate: true } },
      teamMembers: {
        include: { user: { select: { name: true, email: true } } },
        orderBy: [{ sortOrder: 'asc' }, { joinedAt: 'asc' }],
      },
      agreedDates: { orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!eng) throw new Error('Engagement not found');

  const sections: ReportSection[] = [];

  // 1. Engagement metadata
  sections.push({
    title: 'Engagement',
    rows: [
      { label: 'Client', value: eng.client?.clientName || '—' },
      { label: 'Period', value: eng.period ? `${eng.period.startDate?.toISOString().slice(0, 10) || '—'} – ${eng.period.endDate?.toISOString().slice(0, 10) || '—'}` : '—' },
      { label: 'Audit Type', value: eng.auditType || '—' },
      { label: 'Status', value: eng.status || '—' },
      { label: 'Group Audit', value: eng.isGroupAudit ? 'Yes' : 'No' },
      { label: 'Started', value: eng.startedAt ? eng.startedAt.toISOString().slice(0, 10) : 'Not started' },
    ],
  });

  // 2. Team
  sections.push({
    title: 'Engagement Team',
    table: {
      headers: ['Role', 'Name', 'Email'],
      rows: eng.teamMembers.map(m => [
        m.roleLabel || m.role || '—',
        m.user?.name || '—',
        m.user?.email || '—',
      ]),
    },
  });

  // 3. Audit Timetable
  sections.push({
    title: 'Audit Timetable',
    table: {
      headers: ['Milestone', 'Target Date', 'Revised Target', 'Progress'],
      rows: eng.agreedDates.map(d => [
        d.description || '—',
        d.targetDate ? d.targetDate.toISOString().slice(0, 10) : '—',
        d.revisedTarget ? d.revisedTarget.toISOString().slice(0, 10) : '—',
        d.progress || '—',
      ]),
    },
  });

  // 4. Materiality
  try {
    const mat = await (prisma as any).auditMateriality?.findUnique?.({ where: { engagementId } });
    if (mat?.data) {
      const d = mat.data as Record<string, unknown>;
      sections.push({
        title: 'Materiality',
        rows: [
          { label: 'Overall', value: d.overall != null ? String(d.overall) : '—' },
          { label: 'Performance', value: d.performance != null ? String(d.performance) : '—' },
          { label: 'Clearly Trivial', value: d.clearlyTrivial != null ? String(d.clearlyTrivial) : '—' },
          { label: 'Benchmark', value: (d.benchmark as string) || '—' },
          { label: 'Benchmark %', value: d.benchmarkPct != null ? String(d.benchmarkPct) : '—' },
          { label: 'Key Judgements', value: (d.keyJudgements as string) || '—' },
        ],
      });
    }
  } catch { /* tolerant */ }

  // 5. RMM rows — significant risks + areas of focus only.
  try {
    const flagged = await (prisma as any).auditRMMRow?.findMany?.({
      where: { engagementId, rowCategory: { in: ['significant_risk', 'area_of_focus'] } },
      orderBy: [{ rowCategory: 'asc' }, { sortOrder: 'asc' }],
    });
    if (flagged && flagged.length > 0) {
      sections.push({
        title: 'Risk Matrix — Significant Risks & Areas of Focus',
        table: {
          headers: ['Line Item', 'Nature / Risk', 'Likelihood', 'Magnitude', 'Overall', 'Category'],
          rows: flagged.map((r: any) => [
            String(r.lineItem || '—'),
            String(r.riskIdentified || '—'),
            String(r.likelihood || '—'),
            String(r.magnitude || '—'),
            String(r.overallRisk || '—'),
            r.rowCategory === 'significant_risk' ? 'Significant Risk' : 'Area of Focus',
          ]),
        },
      });
    }
  } catch { /* tolerant */ }

  return {
    title: 'Audit File',
    subtitle: `${eng.client?.clientName || ''} — ${eng.period?.endDate ? eng.period.endDate.toISOString().slice(0, 10) : ''}`,
    sections,
  };
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
