/**
 * HTML template → PDF renderer using pdf-lib.
 *
 * Converts populated HTML template content to a professional A4 PDF with:
 *  • Full letterhead on every page (firm logo + optional group logo + admin-authored header text)
 *  • Admin-authored regulatory footer on every page, with page number
 *  • Page-1 recipient block (headline + UPPER client name + multi-line client address + date)
 *  • Headings, paragraphs, bullet lists, and multi-column tables with wrapping cells
 *
 * The table layout engine parses <table><thead><tbody><tr><th/td><colgroup> and
 * performs a two-pass layout (measure → draw) with row-level page breaks and
 * header row repetition.
 */
import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb, PageSizes } from 'pdf-lib';

export interface PdfOptions {
  /** Title shown in the small top-right text — falls back to template name. */
  documentTitle?: string;
  /** Optional fallback firm name (used only if no letterhead header text). */
  firmName?: string;

  // ─── Letterhead ──
  /** Raw bytes of the primary firm logo (PNG or JPEG). */
  firmLogoBytes?: Uint8Array;
  firmLogoMime?: string; // image/png | image/jpeg
  /** Optional second logo for parent/group branding. */
  groupLogoBytes?: Uint8Array;
  groupLogoMime?: string;
  /** Multi-line text authored by firm admin, drawn below/beside the logos on every page. */
  letterheadHeaderText?: string;
  /** Multi-line regulatory footer authored by firm admin, drawn on every page. */
  letterheadFooterText?: string;

  // ─── Page-1 recipient block ──
  recipientHeadline?: string; // e.g. "For the attention of the members"
  clientNameUpper?: string;
  clientAddress?: string;     // multi-line
  currentDate?: string;       // e.g. "24 March 2026"
}

const A4_WIDTH = PageSizes.A4[0];   // 595.28
const A4_HEIGHT = PageSizes.A4[1];  // 841.89
const MARGIN_LEFT = 50;
const MARGIN_RIGHT = 50;
const MARGIN_TOP = 150;     // space for letterhead header
const MARGIN_BOTTOM = 110;  // space for regulatory footer + page number
const CONTENT_WIDTH = A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

const LINE_HEIGHT = 14;
const HEADING1_SIZE = 16;
const HEADING2_SIZE = 13;
const HEADING3_SIZE = 11;
const BODY_SIZE = 10;
const SMALL_SIZE = 8;

interface EmbeddedLogo {
  image: any; // PDFImage from pdf-lib
  width: number;
  height: number;
}

interface RenderState {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  boldFont: PDFFont;
  italicFont: PDFFont;
  y: number;
  pageNum: number;
  options: PdfOptions;
  firmLogo: EmbeddedLogo | null;
  groupLogo: EmbeddedLogo | null;
}

// ─── Text wrapping helpers ─────────────────────────────────────────────────

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = (text || '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const width = safeWidth(font, testLine, size);
    if (width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [''];
}

/** pdf-lib throws on some non-ASCII characters with standard fonts — strip them. */
function sanitize(text: string): string {
  return (text || '')
    .replace(/\u00A0/g, ' ')       // non-breaking space → space
    .replace(/[\u2018\u2019]/g, "'") // curly single quotes
    .replace(/[\u201C\u201D]/g, '"') // curly double quotes
    .replace(/[\u2013\u2014]/g, '-') // en/em dash
    .replace(/\u2022/g, '•')         // keep bullet (it's in WinAnsi)
    .replace(/[^\x00-\xFF\u2022]/g, ''); // strip anything not WinAnsi-encodable except bullet
}

function safeWidth(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(sanitize(text), size);
  } catch {
    return text.length * size * 0.5;
  }
}

function drawSafeText(page: PDFPage, text: string, opts: { x: number; y: number; size: number; font: PDFFont; color?: any }) {
  const clean = sanitize(text);
  if (!clean) return;
  try {
    page.drawText(clean, { x: opts.x, y: opts.y, size: opts.size, font: opts.font, color: opts.color });
  } catch { /* non-fatal */ }
}

// ─── Page / letterhead drawing ──────────────────────────────────────────────

function drawLetterhead(state: RenderState) {
  const { page, options, firmLogo, groupLogo } = state;

  // Logos — top row
  const logoY = A4_HEIGHT - 30;
  const logoMaxH = 40;
  let logoCursorX = MARGIN_LEFT;

  if (firmLogo) {
    const scale = Math.min(1, logoMaxH / firmLogo.height);
    const w = firmLogo.width * scale;
    const h = firmLogo.height * scale;
    page.drawImage(firmLogo.image, { x: logoCursorX, y: logoY - h, width: w, height: h });
    logoCursorX += w + 15;
  }

  if (groupLogo) {
    const scale = Math.min(1, logoMaxH / groupLogo.height);
    const w = groupLogo.width * scale;
    const h = groupLogo.height * scale;
    page.drawImage(groupLogo.image, { x: logoCursorX, y: logoY - h, width: w, height: h });
  }

  // Header text — right-aligned next to logos, or below if no logos
  const headerText = options.letterheadHeaderText || options.firmName || '';
  if (headerText) {
    const lines = headerText.split(/\r?\n/);
    const rightX = A4_WIDTH - MARGIN_RIGHT;
    let lineY = logoY;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { lineY -= SMALL_SIZE + 2; continue; }
      const w = safeWidth(state.font, line, SMALL_SIZE);
      drawSafeText(page, line, {
        x: rightX - w,
        y: lineY,
        size: SMALL_SIZE,
        font: state.font,
        color: rgb(0.25, 0.25, 0.25),
      });
      lineY -= SMALL_SIZE + 2;
    }
  }

  // Separator rule under letterhead
  page.drawLine({
    start: { x: MARGIN_LEFT, y: A4_HEIGHT - MARGIN_TOP + 10 },
    end: { x: A4_WIDTH - MARGIN_RIGHT, y: A4_HEIGHT - MARGIN_TOP + 10 },
    thickness: 0.5,
    color: rgb(0.75, 0.75, 0.75),
  });

  // Footer — regulatory block + page number
  const footerText = options.letterheadFooterText || '';
  const footerY = MARGIN_BOTTOM - 30;
  if (footerText) {
    // Paragraphs (split on blank lines), each wrapped across full width
    const paragraphs = footerText.split(/\n{2,}/);
    let cursorY = MARGIN_BOTTOM - 20;
    for (const para of paragraphs) {
      const lines = wrapText(para.replace(/\n/g, ' '), state.font, SMALL_SIZE, CONTENT_WIDTH);
      for (const line of lines) {
        drawSafeText(page, line, {
          x: MARGIN_LEFT,
          y: cursorY,
          size: SMALL_SIZE,
          font: state.font,
          color: rgb(0.45, 0.45, 0.45),
        });
        cursorY -= SMALL_SIZE + 1;
        if (cursorY < 25) break;
      }
    }
  }

  // Page number (bottom-right)
  const pageLabel = `Page ${state.pageNum}`;
  const pw = safeWidth(state.font, pageLabel, SMALL_SIZE);
  drawSafeText(page, pageLabel, {
    x: A4_WIDTH - MARGIN_RIGHT - pw,
    y: 20,
    size: SMALL_SIZE,
    font: state.font,
    color: rgb(0.55, 0.55, 0.55),
  });
}

function newPage(state: RenderState): PDFPage {
  const page = state.doc.addPage(PageSizes.A4);
  state.page = page;
  state.pageNum++;
  drawLetterhead(state);
  state.y = A4_HEIGHT - MARGIN_TOP;
  return page;
}

function ensureSpace(state: RenderState, needed: number) {
  if (state.y - needed < MARGIN_BOTTOM) {
    newPage(state);
  }
}

function drawRecipientBlock(state: RenderState) {
  const { options } = state;
  const hasAny = options.recipientHeadline || options.clientNameUpper || options.clientAddress || options.currentDate;
  if (!hasAny) return;

  // Date on the right, recipient block on the left
  const startY = state.y;

  // Right: date
  if (options.currentDate) {
    const dw = safeWidth(state.font, options.currentDate, BODY_SIZE);
    drawSafeText(state.page, options.currentDate, {
      x: A4_WIDTH - MARGIN_RIGHT - dw,
      y: startY,
      size: BODY_SIZE,
      font: state.font,
      color: rgb(0.1, 0.1, 0.1),
    });
  }

  // Left: headline, client name UPPER, multi-line address
  let y = startY;
  if (options.recipientHeadline) {
    drawSafeText(state.page, options.recipientHeadline, {
      x: MARGIN_LEFT,
      y,
      size: BODY_SIZE,
      font: state.italicFont,
      color: rgb(0.25, 0.25, 0.25),
    });
    y -= LINE_HEIGHT;
  }
  if (options.clientNameUpper) {
    drawSafeText(state.page, options.clientNameUpper, {
      x: MARGIN_LEFT,
      y,
      size: BODY_SIZE + 1,
      font: state.boldFont,
      color: rgb(0.05, 0.05, 0.05),
    });
    y -= LINE_HEIGHT + 2;
  }
  if (options.clientAddress) {
    for (const line of options.clientAddress.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) { y -= LINE_HEIGHT; continue; }
      drawSafeText(state.page, trimmed, {
        x: MARGIN_LEFT,
        y,
        size: BODY_SIZE,
        font: state.font,
        color: rgb(0.15, 0.15, 0.15),
      });
      y -= LINE_HEIGHT;
    }
  }

  state.y = Math.min(y, startY - 4 * LINE_HEIGHT) - 10;
}

// ─── HTML parsing (heading/paragraph/list/hr/table) ────────────────────────

type InlineBlock =
  | { type: 'h1' | 'h2' | 'h3'; text: string }
  | { type: 'p'; text: string; bold?: boolean; italic?: boolean }
  | { type: 'li'; text: string }
  | { type: 'hr' }
  | { type: 'table'; rows: TableRow[]; columnWidths?: number[]; hasHeader: boolean };

interface TableRow {
  cells: TableCell[];
  isHeader: boolean;
}
interface TableCell {
  /** paragraph segments — each segment is one block of text (from <p> or <br>-separated chunk). */
  segments: string[];
  isHeader: boolean;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2019;/g, "'")
    .replace(/&#x201C;/g, '"')
    .replace(/&#x201D;/g, '"')
    .replace(/&pound;/g, '£')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripInlineTags(s: string): string {
  return decodeEntities(s.replace(/<\/?(b|strong|i|em|u|span)[^>]*>/gi, '').replace(/<[^>]+>/g, ''));
}

function parseCellSegments(innerHtml: string): string[] {
  // Split by <p>, <br>, <li> (treat <li> as a new paragraph prefixed with bullet)
  const normalized = innerHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/li\s*>/gi, '')
    .replace(/<\/?ul[^>]*>/gi, '')
    .replace(/<\/?ol[^>]*>/gi, '');
  const raw = stripInlineTags(normalized);
  return raw.split(/\n+/).map(s => s.trim()).filter(Boolean);
}

function parseTable(tableHtml: string): InlineBlock {
  // Extract <colgroup> widths (percentage)
  let columnWidths: number[] | undefined;
  const colgroupMatch = tableHtml.match(/<colgroup[^>]*>([\s\S]*?)<\/colgroup>/i);
  if (colgroupMatch) {
    const widths = Array.from(colgroupMatch[1].matchAll(/<col[^>]*width=["']?(\d+)%?["']?[^>]*>/gi)).map(m => parseInt(m[1], 10));
    if (widths.length > 0) columnWidths = widths;
  }

  const rows: TableRow[] = [];
  let hasHeader = false;

  // Grab all <tr>…</tr>, preserving thead/tbody context
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const inThead = /<thead[^>]*>([\s\S]*?)<\/thead>/i.exec(tableHtml);
  const theadInner = inThead ? inThead[1] : '';

  function parseRow(rowHtml: string, forceHeader: boolean): TableRow | null {
    const cells: TableCell[] = [];
    const cellRegex = /<(th|td)([^>]*)>([\s\S]*?)<\/\1>/gi;
    let m;
    while ((m = cellRegex.exec(rowHtml)) !== null) {
      const tag = m[1].toLowerCase();
      const inner = m[3];
      cells.push({
        segments: parseCellSegments(inner),
        isHeader: forceHeader || tag === 'th',
      });
    }
    if (cells.length === 0) return null;
    return { cells, isHeader: cells.every(c => c.isHeader) };
  }

  // Header rows first
  if (theadInner) {
    let m;
    while ((m = trRegex.exec(theadInner)) !== null) {
      const row = parseRow(m[1], true);
      if (row) { rows.push(row); hasHeader = true; }
    }
  }

  // Body rows — iterate all <tr> in the table that are NOT in <thead>
  const withoutThead = tableHtml.replace(/<thead[^>]*>[\s\S]*?<\/thead>/i, '');
  const bodyTrRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let bm;
  while ((bm = bodyTrRegex.exec(withoutThead)) !== null) {
    const row = parseRow(bm[1], false);
    if (row) {
      if (row.isHeader && rows.length === 0) {
        hasHeader = true;
        rows.push(row);
      } else {
        rows.push(row);
      }
    }
  }

  return { type: 'table', rows, columnWidths, hasHeader };
}

function parseHtmlToBlocks(html: string): InlineBlock[] {
  const blocks: InlineBlock[] = [];

  // Strip style/script
  let cleaned = (html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // Tokenize by block-level tags, treating tables as atomic units
  const tokens: Array<{ kind: 'table' | 'other'; html: string }> = [];
  let idx = 0;
  const tableRegex = /<table[^>]*>[\s\S]*?<\/table>/gi;
  let m;
  while ((m = tableRegex.exec(cleaned)) !== null) {
    if (m.index > idx) tokens.push({ kind: 'other', html: cleaned.slice(idx, m.index) });
    tokens.push({ kind: 'table', html: m[0] });
    idx = m.index + m[0].length;
  }
  if (idx < cleaned.length) tokens.push({ kind: 'other', html: cleaned.slice(idx) });

  for (const tok of tokens) {
    if (tok.kind === 'table') {
      blocks.push(parseTable(tok.html));
      continue;
    }

    // For "other" HTML, walk block tags
    const segments = tok.html.split(/(<\/?(?:h[1-3]|p|div|li|ul|ol|br|hr)[^>]*>)/gi);
    let currentTag = '';
    let buffer = '';

    const flush = () => {
      if (!buffer.trim()) { buffer = ''; return; }
      const text = stripInlineTags(buffer).trim();
      buffer = '';
      if (!text) return;
      const tag = currentTag.toLowerCase();
      if (tag === 'h1') blocks.push({ type: 'h1', text });
      else if (tag === 'h2') blocks.push({ type: 'h2', text });
      else if (tag === 'h3') blocks.push({ type: 'h3', text });
      else if (tag === 'li') blocks.push({ type: 'li', text });
      else {
        const bold = /<(b|strong)[^>]*>/i.test(buffer);
        const italic = /<(i|em)[^>]*>/i.test(buffer);
        blocks.push({ type: 'p', text, bold, italic });
      }
    };

    for (const seg of segments) {
      if (!seg) continue;
      const openMatch = seg.match(/^<(h[1-3]|p|div|li|ul|ol)[^>]*>$/i);
      const closeMatch = seg.match(/^<\/(h[1-3]|p|div|li|ul|ol)[^>]*>$/i);
      const brMatch = seg.match(/^<br\s*\/?>$/i);
      const hrMatch = seg.match(/^<hr\s*\/?>$/i);

      if (hrMatch) { flush(); blocks.push({ type: 'hr' }); continue; }
      if (brMatch) { flush(); continue; }

      if (openMatch) {
        flush();
        currentTag = openMatch[1];
        continue;
      }
      if (closeMatch) { flush(); currentTag = ''; continue; }

      buffer += seg;
    }
    flush();
  }

  return blocks;
}

// ─── Drawing ───────────────────────────────────────────────────────────────

function drawWrappedText(
  state: RenderState,
  text: string,
  font: PDFFont,
  size: number,
  color = rgb(0.1, 0.1, 0.1),
  indent = 0,
) {
  const lines = wrapText(text, font, size, CONTENT_WIDTH - indent);
  for (const line of lines) {
    ensureSpace(state, LINE_HEIGHT);
    drawSafeText(state.page, line, { x: MARGIN_LEFT + indent, y: state.y, size, font, color });
    state.y -= LINE_HEIGHT;
  }
}

// ─── Table drawing ─────────────────────────────────────────────────────────

const CELL_PADDING_X = 6;
const CELL_PADDING_Y = 5;
const TABLE_FONT_SIZE = BODY_SIZE - 1;
const TABLE_LINE_HEIGHT = TABLE_FONT_SIZE + 2;
const TABLE_HEADER_FILL = rgb(0.93, 0.93, 0.93);
const TABLE_BORDER = rgb(0.6, 0.6, 0.6);

function computeColumnWidths(block: Extract<InlineBlock, { type: 'table' }>): number[] {
  const colCount = Math.max(...block.rows.map(r => r.cells.length));
  if (colCount === 0) return [];
  const defaults = Array.from({ length: colCount }, () => CONTENT_WIDTH / colCount);
  if (!block.columnWidths || block.columnWidths.length !== colCount) return defaults;
  const total = block.columnWidths.reduce((a, b) => a + b, 0);
  if (total === 0) return defaults;
  const widths = block.columnWidths.map(w => (w / total) * CONTENT_WIDTH);
  // Minimum column width check
  if (widths.some(w => w < 50)) return defaults;
  return widths;
}

function measureRowHeight(row: TableRow, colWidths: number[], font: PDFFont, boldFont: PDFFont): number {
  let max = 0;
  row.cells.forEach((cell, i) => {
    const w = colWidths[i] - CELL_PADDING_X * 2;
    const f = cell.isHeader ? boldFont : font;
    let lineCount = 0;
    for (const seg of cell.segments) {
      lineCount += wrapText(seg, f, TABLE_FONT_SIZE, w).length;
    }
    if (cell.segments.length > 1) lineCount += cell.segments.length - 1; // inter-paragraph spacing
    const h = CELL_PADDING_Y * 2 + lineCount * TABLE_LINE_HEIGHT;
    if (h > max) max = h;
  });
  return Math.max(max, TABLE_LINE_HEIGHT + CELL_PADDING_Y * 2);
}

function drawTableRow(
  state: RenderState,
  row: TableRow,
  colWidths: number[],
  rowHeight: number,
) {
  const { page, font, boldFont } = state;
  const topY = state.y;

  let cursorX = MARGIN_LEFT;
  row.cells.forEach((cell, i) => {
    const w = colWidths[i];
    // Background fill for header rows
    if (cell.isHeader) {
      page.drawRectangle({
        x: cursorX,
        y: topY - rowHeight,
        width: w,
        height: rowHeight,
        color: TABLE_HEADER_FILL,
      });
    }
    // Border
    page.drawRectangle({
      x: cursorX,
      y: topY - rowHeight,
      width: w,
      height: rowHeight,
      borderColor: TABLE_BORDER,
      borderWidth: 0.5,
    });

    const f = cell.isHeader ? boldFont : font;
    const innerW = w - CELL_PADDING_X * 2;
    let textY = topY - CELL_PADDING_Y - TABLE_FONT_SIZE + 1;
    for (let s = 0; s < cell.segments.length; s++) {
      const seg = cell.segments[s];
      const lines = wrapText(seg, f, TABLE_FONT_SIZE, innerW);
      for (const line of lines) {
        drawSafeText(page, line, {
          x: cursorX + CELL_PADDING_X,
          y: textY,
          size: TABLE_FONT_SIZE,
          font: f,
          color: rgb(0.1, 0.1, 0.1),
        });
        textY -= TABLE_LINE_HEIGHT;
      }
      if (s < cell.segments.length - 1) textY -= TABLE_LINE_HEIGHT * 0.4;
    }
    cursorX += w;
  });

  state.y = topY - rowHeight;
}

function drawTable(state: RenderState, block: Extract<InlineBlock, { type: 'table' }>) {
  const colWidths = computeColumnWidths(block);
  if (colWidths.length === 0 || block.rows.length === 0) return;

  state.y -= 10; // spacing before table

  const headerRows = block.rows.filter(r => r.isHeader);
  const dataRows = block.rows.filter(r => !r.isHeader);
  const allRows: TableRow[] = block.hasHeader && headerRows.length > 0
    ? [...headerRows, ...dataRows]
    : block.rows;

  let pendingHeader = block.hasHeader ? headerRows : [];
  const firstPage = true;
  let drewOnThisPage = false;

  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    const isHeaderRow = row.isHeader;
    const rowHeight = measureRowHeight(row, colWidths, state.font, state.boldFont);

    // If this is a header row, we'll draw it; but if we're at the start of the first page, it's part of allRows
    // Handle page break for data rows
    if (!isHeaderRow && state.y - rowHeight < MARGIN_BOTTOM) {
      newPage(state);
      drewOnThisPage = false;
      // Repeat header rows on new page
      for (const hr of pendingHeader) {
        const hh = measureRowHeight(hr, colWidths, state.font, state.boldFont);
        if (state.y - hh < MARGIN_BOTTOM) break;
        drawTableRow(state, hr, colWidths, hh);
        drewOnThisPage = true;
      }
    }

    // Edge case: very tall row won't fit even on a fresh page — still draw and let it overflow
    if (!isHeaderRow && state.y - rowHeight < MARGIN_BOTTOM && drewOnThisPage) {
      newPage(state);
      for (const hr of pendingHeader) {
        const hh = measureRowHeight(hr, colWidths, state.font, state.boldFont);
        drawTableRow(state, hr, colWidths, hh);
      }
    }

    drawTableRow(state, row, colWidths, rowHeight);
    drewOnThisPage = true;

    if (isHeaderRow) {
      // Track for re-drawing on page breaks
      if (!pendingHeader.includes(row)) pendingHeader.push(row);
    }
  }

  state.y -= 10; // spacing after table
}

// ─── Logo embedding ────────────────────────────────────────────────────────

async function embedLogo(doc: PDFDocument, bytes: Uint8Array | undefined, mime: string | undefined): Promise<EmbeddedLogo | null> {
  if (!bytes || bytes.length === 0) return null;
  try {
    const isPng = (mime || '').toLowerCase().includes('png') ||
      (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47);
    const image = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    return { image, width: image.width, height: image.height };
  } catch {
    return null;
  }
}

// ─── Main entry point ──────────────────────────────────────────────────────

export async function generatePdfFromTemplate(
  htmlContent: string,
  options: PdfOptions = {},
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const italicFont = await doc.embedFont(StandardFonts.HelveticaOblique);

  const firmLogo = await embedLogo(doc, options.firmLogoBytes, options.firmLogoMime);
  const groupLogo = await embedLogo(doc, options.groupLogoBytes, options.groupLogoMime);

  const state: RenderState = {
    doc,
    page: null as any,
    font,
    boldFont,
    italicFont,
    y: 0,
    pageNum: 0,
    options,
    firmLogo,
    groupLogo,
  };

  // First page — letterhead drawn in newPage()
  newPage(state);

  // Page-1 recipient block
  drawRecipientBlock(state);

  // Document title (optional)
  if (options.documentTitle) {
    state.y -= 6;
    drawWrappedText(state, options.documentTitle, boldFont, HEADING1_SIZE, rgb(0, 0.28, 0.55));
    state.page.drawLine({
      start: { x: MARGIN_LEFT, y: state.y + 8 },
      end: { x: A4_WIDTH - MARGIN_RIGHT, y: state.y + 8 },
      thickness: 1,
      color: rgb(0, 0.28, 0.55),
    });
    state.y -= 10;
  }

  // Body
  const blocks = parseHtmlToBlocks(htmlContent);
  for (const block of blocks) {
    switch (block.type) {
      case 'h1':
        state.y -= 10;
        ensureSpace(state, 28);
        drawWrappedText(state, block.text, boldFont, HEADING1_SIZE, rgb(0, 0.28, 0.55));
        state.y -= 4;
        break;
      case 'h2':
        state.y -= 8;
        ensureSpace(state, 22);
        drawWrappedText(state, block.text, boldFont, HEADING2_SIZE, rgb(0.15, 0.15, 0.15));
        state.y -= 3;
        break;
      case 'h3':
        state.y -= 6;
        ensureSpace(state, 18);
        drawWrappedText(state, block.text, boldFont, HEADING3_SIZE, rgb(0.2, 0.2, 0.2));
        state.y -= 2;
        break;
      case 'li':
        ensureSpace(state, LINE_HEIGHT);
        drawSafeText(state.page, '•', { x: MARGIN_LEFT + 8, y: state.y, size: BODY_SIZE, font, color: rgb(0.3, 0.3, 0.3) });
        drawWrappedText(state, block.text, font, BODY_SIZE, rgb(0.1, 0.1, 0.1), 20);
        break;
      case 'hr':
        state.y -= 4;
        ensureSpace(state, 8);
        state.page.drawLine({
          start: { x: MARGIN_LEFT, y: state.y },
          end: { x: A4_WIDTH - MARGIN_RIGHT, y: state.y },
          thickness: 0.5,
          color: rgb(0.8, 0.8, 0.8),
        });
        state.y -= 6;
        break;
      case 'p':
        if (block.bold) drawWrappedText(state, block.text, boldFont, BODY_SIZE);
        else if (block.italic) drawWrappedText(state, block.text, italicFont, BODY_SIZE);
        else drawWrappedText(state, block.text, font, BODY_SIZE);
        state.y -= 4;
        break;
      case 'table':
        drawTable(state, block);
        break;
    }
  }

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}
