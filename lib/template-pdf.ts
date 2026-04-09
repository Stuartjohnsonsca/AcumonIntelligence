/**
 * HTML template → PDF renderer using pdf-lib.
 * Converts populated HTML template content to a professional A4 PDF.
 */
import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb, PageSizes } from 'pdf-lib';

interface PdfOptions {
  firmName?: string;
  documentTitle?: string;
}

const A4_WIDTH = PageSizes.A4[0];   // 595.28
const A4_HEIGHT = PageSizes.A4[1]; // 841.89
const MARGIN_LEFT = 50;
const MARGIN_RIGHT = 50;
const MARGIN_TOP = 60;
const MARGIN_BOTTOM = 60;
const CONTENT_WIDTH = A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const LINE_HEIGHT = 14;
const HEADING1_SIZE = 16;
const HEADING2_SIZE = 13;
const BODY_SIZE = 10;
const SMALL_SIZE = 8;

interface RenderState {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  boldFont: PDFFont;
  italicFont: PDFFont;
  y: number;
  pageNum: number;
  firmName: string;
  documentTitle: string;
}

function newPage(state: RenderState): PDFPage {
  const page = state.doc.addPage(PageSizes.A4);
  state.page = page;
  state.y = A4_HEIGHT - MARGIN_TOP;
  state.pageNum++;

  // Header
  page.drawText(state.firmName, { x: MARGIN_LEFT, y: A4_HEIGHT - 30, size: SMALL_SIZE, font: state.font, color: rgb(0.5, 0.5, 0.5) });
  page.drawText(state.documentTitle, { x: A4_WIDTH - MARGIN_RIGHT - state.font.widthOfTextAtSize(state.documentTitle, SMALL_SIZE), y: A4_HEIGHT - 30, size: SMALL_SIZE, font: state.font, color: rgb(0.5, 0.5, 0.5) });
  // Header line
  page.drawLine({ start: { x: MARGIN_LEFT, y: A4_HEIGHT - 38 }, end: { x: A4_WIDTH - MARGIN_RIGHT, y: A4_HEIGHT - 38 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });

  // Footer
  const footerText = `Page ${state.pageNum}`;
  page.drawText(footerText, { x: A4_WIDTH / 2 - state.font.widthOfTextAtSize(footerText, SMALL_SIZE) / 2, y: 30, size: SMALL_SIZE, font: state.font, color: rgb(0.6, 0.6, 0.6) });

  state.y = A4_HEIGHT - MARGIN_TOP - 10;
  return page;
}

function ensureSpace(state: RenderState, needed: number) {
  if (state.y - needed < MARGIN_BOTTOM) {
    newPage(state);
  }
}

/**
 * Wrap text to fit within maxWidth, returning array of lines.
 */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const width = font.widthOfTextAtSize(testLine, size);
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

function drawWrappedText(state: RenderState, text: string, font: PDFFont, size: number, color = rgb(0.1, 0.1, 0.1), indent = 0) {
  const lines = wrapText(text, font, size, CONTENT_WIDTH - indent);
  for (const line of lines) {
    ensureSpace(state, LINE_HEIGHT);
    state.page.drawText(line, { x: MARGIN_LEFT + indent, y: state.y, size, font, color });
    state.y -= LINE_HEIGHT;
  }
}

/**
 * Parse simple HTML to structured blocks for PDF rendering.
 */
interface Block {
  type: 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'br' | 'hr' | 'table_row';
  text: string;
  bold?: boolean;
  italic?: boolean;
  cells?: string[]; // for table rows
}

function parseHtmlToBlocks(html: string): Block[] {
  const blocks: Block[] = [];

  // Strip <style>, <script> tags
  let cleaned = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // Convert HTML entities
  cleaned = cleaned.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x2019;/g, "\u2019").replace(/&#x201C;/g, "\u201C").replace(/&#x201D;/g, "\u201D");

  // Process tags
  const tagRegex = /<(h[1-3]|p|li|br|hr|tr|div)[^>]*>([\s\S]*?)<\/\1>|<(br|hr)\s*\/?>/gi;
  let match;
  let lastIndex = 0;

  // Simple approach: split by block-level tags
  const segments = cleaned.split(/<\/?(h[1-6]|p|div|li|ul|ol|tr|table|thead|tbody|br|hr)[^>]*>/gi);

  for (const seg of segments) {
    const text = seg.replace(/<[^>]+>/g, '').trim(); // Strip inline tags
    if (!text) continue;

    // Detect if this was inside a heading (check preceding tag)
    const headingMatch = cleaned.match(new RegExp(`<(h[1-3])[^>]*>[^]*?${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'));
    const isBold = /<(b|strong)[^>]*>/i.test(seg) || (headingMatch && headingMatch[1]);

    if (headingMatch) {
      const level = headingMatch[1].toLowerCase();
      blocks.push({ type: level as 'h1' | 'h2' | 'h3', text });
    } else {
      blocks.push({ type: 'p', text, bold: isBold });
    }
  }

  // If no blocks extracted (plain text), split by newlines
  if (blocks.length === 0) {
    const lines = cleaned.replace(/<[^>]+>/g, '').split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      blocks.push({ type: 'p', text: line });
    }
  }

  return blocks;
}

/**
 * Generate a PDF from populated HTML template content.
 */
export async function generatePdfFromTemplate(
  htmlContent: string,
  options: PdfOptions = {}
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const italicFont = await doc.embedFont(StandardFonts.HelveticaOblique);

  const state: RenderState = {
    doc,
    page: null as any,
    font,
    boldFont,
    italicFont,
    y: 0,
    pageNum: 0,
    firmName: options.firmName || '',
    documentTitle: options.documentTitle || 'Document',
  };

  // First page
  newPage(state);

  // Title
  if (options.documentTitle) {
    state.y -= 10;
    drawWrappedText(state, options.documentTitle, boldFont, HEADING1_SIZE, rgb(0, 0.28, 0.55));
    state.y -= 10;
    // Title underline
    state.page.drawLine({
      start: { x: MARGIN_LEFT, y: state.y + 5 },
      end: { x: A4_WIDTH - MARGIN_RIGHT, y: state.y + 5 },
      thickness: 1,
      color: rgb(0, 0.28, 0.55),
    });
    state.y -= 15;
  }

  // Parse and render blocks
  const blocks = parseHtmlToBlocks(htmlContent);

  for (const block of blocks) {
    switch (block.type) {
      case 'h1':
        state.y -= 12;
        ensureSpace(state, 30);
        drawWrappedText(state, block.text, boldFont, HEADING1_SIZE, rgb(0, 0.28, 0.55));
        state.y -= 6;
        break;

      case 'h2':
        state.y -= 8;
        ensureSpace(state, 24);
        drawWrappedText(state, block.text, boldFont, HEADING2_SIZE, rgb(0.15, 0.15, 0.15));
        state.y -= 4;
        break;

      case 'h3':
        state.y -= 6;
        ensureSpace(state, 20);
        drawWrappedText(state, block.text, boldFont, BODY_SIZE + 1, rgb(0.2, 0.2, 0.2));
        state.y -= 3;
        break;

      case 'li':
        ensureSpace(state, LINE_HEIGHT);
        state.page.drawText('\u2022', { x: MARGIN_LEFT + 10, y: state.y, size: BODY_SIZE, font, color: rgb(0.3, 0.3, 0.3) });
        drawWrappedText(state, block.text, font, BODY_SIZE, rgb(0.1, 0.1, 0.1), 22);
        break;

      case 'hr':
        state.y -= 5;
        ensureSpace(state, 10);
        state.page.drawLine({
          start: { x: MARGIN_LEFT, y: state.y },
          end: { x: A4_WIDTH - MARGIN_RIGHT, y: state.y },
          thickness: 0.5,
          color: rgb(0.8, 0.8, 0.8),
        });
        state.y -= 5;
        break;

      case 'p':
      default:
        if (block.bold) {
          drawWrappedText(state, block.text, boldFont, BODY_SIZE);
        } else {
          drawWrappedText(state, block.text, font, BODY_SIZE);
        }
        state.y -= 4; // paragraph spacing
        break;
    }
  }

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}
