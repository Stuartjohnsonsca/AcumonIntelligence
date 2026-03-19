import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb } from 'pdf-lib';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Finding {
  id: string;
  area: string;
  finding: string;
  clauseReference: string;
  isSignificantRisk: boolean;
  userResponse: string | null;
  addToTesting: boolean;
  reviewed: boolean;
  fileId: string;
  fileName: string;
}

export interface FileInfo {
  id: string;
  originalName: string;
  fileSize: number;
  pageCount: number | null;
  createdAt: string;
  uploadedBy: string;
}

interface PdfParams {
  jobId: string;
  findings: Finding[];
  files: FileInfo[];
  clientName: string;
  firmName: string;
  userName: string;
  exportDate: Date;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN_LEFT = 50;
const MARGIN_RIGHT = 50;
const MARGIN_TOP = 70;
const MARGIN_BOTTOM = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const HEADER_Y = PAGE_HEIGHT - 30;
const FOOTER_Y = 25;

const COLOUR_GREY = rgb(0.45, 0.45, 0.45);
const COLOUR_LIGHT_GREY = rgb(0.75, 0.75, 0.75);
const COLOUR_BLACK = rgb(0, 0, 0);
const COLOUR_RISK_BG = rgb(1, 0.929, 0.835); // rgb(255,237,213)
const COLOUR_WHITE = rgb(1, 1, 1);
const COLOUR_TABLE_BORDER = rgb(0.7, 0.7, 0.7);
const COLOUR_TABLE_HEADER_BG = rgb(0.92, 0.92, 0.92);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split('\n');
  for (const para of paragraphs) {
    if (para.trim() === '') {
      lines.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let currentLine = '';
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const width = font.widthOfTextAtSize(testLine, fontSize);
      if (width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
  }
  return lines;
}

function truncateText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, fontSize) <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0 && font.widthOfTextAtSize(truncated + '...', fontSize) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '...';
}

// ---------------------------------------------------------------------------
// Page manager — tracks current page, Y position, page count
// ---------------------------------------------------------------------------

interface PageContext {
  doc: PDFDocument;
  pages: PDFPage[];
  currentPage: PDFPage;
  y: number;
  font: PDFFont;
  fontBold: PDFFont;
  clientName: string;
  firmName: string;
  /** Set to false for cover page */
  drawHeaderFooter: boolean;
}

function newPage(ctx: PageContext): PDFPage {
  const page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  ctx.pages.push(page);
  ctx.currentPage = page;
  ctx.y = PAGE_HEIGHT - MARGIN_TOP;
  if (ctx.drawHeaderFooter) {
    drawHeader(page, ctx.font, ctx.firmName, ctx.clientName);
    // Footer placeholder — page numbers filled in later
  }
  return page;
}

function ensureSpace(ctx: PageContext, needed: number): void {
  if (ctx.y - needed < MARGIN_BOTTOM + 20) {
    newPage(ctx);
  }
}

function drawHeader(page: PDFPage, font: PDFFont, firmName: string, clientName: string): void {
  page.drawText(firmName, { x: MARGIN_LEFT, y: HEADER_Y, size: 9, font, color: COLOUR_GREY });
  const clientW = font.widthOfTextAtSize(clientName, 9);
  page.drawText(clientName, { x: PAGE_WIDTH - MARGIN_RIGHT - clientW, y: HEADER_Y, size: 9, font, color: COLOUR_GREY });
  // Separator line
  page.drawLine({
    start: { x: MARGIN_LEFT, y: HEADER_Y - 8 },
    end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: HEADER_Y - 8 },
    thickness: 0.5,
    color: COLOUR_LIGHT_GREY,
  });
}

function drawAllFooters(pages: PDFPage[], font: PDFFont, startIndex: number): void {
  const total = pages.length;
  for (let i = startIndex; i < total; i++) {
    const page = pages[i];
    page.drawText('Acumon Intelligence', { x: MARGIN_LEFT, y: FOOTER_Y, size: 8, font, color: COLOUR_GREY });
    const pageNumText = `Page ${i - startIndex + 1} of ${total - startIndex}`;
    const numW = font.widthOfTextAtSize(pageNumText, 8);
    page.drawText(pageNumText, { x: PAGE_WIDTH - MARGIN_RIGHT - numW, y: FOOTER_Y, size: 8, font, color: COLOUR_GREY });
  }
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function drawSectionHeading(ctx: PageContext, title: string): void {
  ensureSpace(ctx, 40);
  ctx.currentPage.drawText(title, { x: MARGIN_LEFT, y: ctx.y, size: 16, font: ctx.fontBold, color: COLOUR_BLACK });
  ctx.y -= 28;
}

function drawParagraph(ctx: PageContext, text: string, fontSize: number = 10, indent: number = 0): void {
  const lines = wrapText(text, ctx.font, fontSize, CONTENT_WIDTH - indent);
  for (const line of lines) {
    ensureSpace(ctx, fontSize + 6);
    ctx.currentPage.drawText(line, { x: MARGIN_LEFT + indent, y: ctx.y, size: fontSize, font: ctx.font, color: COLOUR_BLACK });
    ctx.y -= fontSize + 4;
  }
  ctx.y -= 4;
}

function drawBoldParagraph(ctx: PageContext, text: string, fontSize: number = 10, indent: number = 0): void {
  const lines = wrapText(text, ctx.fontBold, fontSize, CONTENT_WIDTH - indent);
  for (const line of lines) {
    ensureSpace(ctx, fontSize + 6);
    ctx.currentPage.drawText(line, { x: MARGIN_LEFT + indent, y: ctx.y, size: fontSize, font: ctx.fontBold, color: COLOUR_BLACK });
    ctx.y -= fontSize + 4;
  }
  ctx.y -= 4;
}

// ---------------------------------------------------------------------------
// Table drawing
// ---------------------------------------------------------------------------

interface TableColumn {
  header: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

interface TableRow {
  cells: string[];
  highlight?: boolean;
}

function drawTable(ctx: PageContext, columns: TableColumn[], rows: TableRow[], fontSize: number = 8): void {
  const rowHeight = 18;
  const headerHeight = 20;
  const cellPadding = 4;

  // Draw header row
  ensureSpace(ctx, headerHeight + 4);
  let x = MARGIN_LEFT;
  // Header background
  ctx.currentPage.drawRectangle({
    x: MARGIN_LEFT,
    y: ctx.y - headerHeight + 4,
    width: columns.reduce((s, c) => s + c.width, 0),
    height: headerHeight,
    color: COLOUR_TABLE_HEADER_BG,
    borderColor: COLOUR_TABLE_BORDER,
    borderWidth: 0.5,
  });
  for (const col of columns) {
    const headerText = truncateText(col.header, ctx.fontBold, fontSize, col.width - cellPadding * 2);
    ctx.currentPage.drawText(headerText, {
      x: x + cellPadding,
      y: ctx.y - headerHeight + 8,
      size: fontSize,
      font: ctx.fontBold,
      color: COLOUR_BLACK,
    });
    x += col.width;
  }
  ctx.y -= headerHeight;

  // Draw data rows
  for (const row of rows) {
    // Calculate row height based on content
    let maxLines = 1;
    const cellLines: string[][] = [];
    for (let i = 0; i < columns.length; i++) {
      const cellText = row.cells[i] || '';
      const lines = wrapText(cellText, ctx.font, fontSize, columns[i].width - cellPadding * 2);
      cellLines.push(lines);
      if (lines.length > maxLines) maxLines = lines.length;
    }
    const actualRowHeight = Math.max(rowHeight, maxLines * (fontSize + 3) + 6);

    ensureSpace(ctx, actualRowHeight + 4);

    // Row background
    x = MARGIN_LEFT;
    const totalWidth = columns.reduce((s, c) => s + c.width, 0);
    if (row.highlight) {
      ctx.currentPage.drawRectangle({
        x: MARGIN_LEFT,
        y: ctx.y - actualRowHeight + 4,
        width: totalWidth,
        height: actualRowHeight,
        color: COLOUR_RISK_BG,
        borderColor: COLOUR_TABLE_BORDER,
        borderWidth: 0.5,
      });
    } else {
      ctx.currentPage.drawRectangle({
        x: MARGIN_LEFT,
        y: ctx.y - actualRowHeight + 4,
        width: totalWidth,
        height: actualRowHeight,
        color: COLOUR_WHITE,
        borderColor: COLOUR_TABLE_BORDER,
        borderWidth: 0.5,
      });
    }

    // Draw cell borders and text
    x = MARGIN_LEFT;
    for (let i = 0; i < columns.length; i++) {
      // Vertical cell border
      if (i > 0) {
        ctx.currentPage.drawLine({
          start: { x, y: ctx.y + 4 },
          end: { x, y: ctx.y - actualRowHeight + 4 },
          thickness: 0.5,
          color: COLOUR_TABLE_BORDER,
        });
      }
      // Cell text — draw each wrapped line
      const lines = cellLines[i];
      for (let li = 0; li < lines.length; li++) {
        const lineText = truncateText(lines[li], ctx.font, fontSize, columns[i].width - cellPadding * 2);
        ctx.currentPage.drawText(lineText, {
          x: x + cellPadding,
          y: ctx.y - 4 - li * (fontSize + 3),
          size: fontSize,
          font: ctx.font,
          color: COLOUR_BLACK,
        });
      }
      x += columns[i].width;
    }

    ctx.y -= actualRowHeight;
  }
  ctx.y -= 8;
}

// ---------------------------------------------------------------------------
// Content section renderers
// ---------------------------------------------------------------------------

function renderSummary(ctx: PageContext, findings: Finding[], files: FileInfo[], clientName: string): void {
  drawSectionHeading(ctx, 'Summary');

  const totalFindings = findings.length;
  const areas = new Set(findings.map((f) => f.area));
  const riskFindings = findings.filter((f) => f.isSignificantRisk);
  const riskCount = riskFindings.length;

  const summaryText = `This report presents the findings from an AI-assisted analysis of ${files.length} document(s) uploaded for ${clientName}. The analysis identified ${totalFindings} matters across ${areas.size} categories, of which ${riskCount} were flagged as significant risks.`;
  drawParagraph(ctx, summaryText);

  if (riskCount > 0) {
    ctx.y -= 4;
    drawBoldParagraph(ctx, 'Significant matters identified:', 10);
    for (const rf of riskFindings) {
      const summary = rf.finding.length > 120 ? rf.finding.substring(0, 120) + '...' : rf.finding;
      drawParagraph(ctx, `${rf.area} (${rf.clauseReference}): ${summary}`, 9, 10);
    }
  }
}

function renderKeyMatters(ctx: PageContext, findings: Finding[]): void {
  drawSectionHeading(ctx, 'Key Matters');

  const riskFindings = findings.filter((f) => f.isSignificantRisk);
  if (riskFindings.length === 0) {
    drawParagraph(ctx, 'No significant risks identified.');
    return;
  }

  for (const rf of riskFindings) {
    ensureSpace(ctx, 80);

    // Area + clause ref heading
    const heading = `${rf.area} \u2014 ${rf.clauseReference}`;
    ctx.currentPage.drawText(heading, {
      x: MARGIN_LEFT,
      y: ctx.y,
      size: 12,
      font: ctx.fontBold,
      color: COLOUR_BLACK,
    });
    ctx.y -= 18;

    // Finding text
    drawParagraph(ctx, rf.finding, 10);

    // Response box
    ensureSpace(ctx, 50);
    ctx.currentPage.drawText('Response:', {
      x: MARGIN_LEFT,
      y: ctx.y,
      size: 9,
      font: ctx.fontBold,
      color: COLOUR_GREY,
    });
    ctx.y -= 14;

    const boxHeight = rf.userResponse ? Math.max(30, wrapText(rf.userResponse, ctx.font, 9, CONTENT_WIDTH - 12).length * 13 + 10) : 30;
    ensureSpace(ctx, boxHeight + 25);

    ctx.currentPage.drawRectangle({
      x: MARGIN_LEFT,
      y: ctx.y - boxHeight,
      width: CONTENT_WIDTH,
      height: boxHeight,
      borderColor: COLOUR_TABLE_BORDER,
      borderWidth: 0.75,
      color: COLOUR_WHITE,
    });

    if (rf.userResponse) {
      const responseLines = wrapText(rf.userResponse, ctx.font, 9, CONTENT_WIDTH - 12);
      let ry = ctx.y - 10;
      for (const line of responseLines) {
        ctx.currentPage.drawText(line, { x: MARGIN_LEFT + 6, y: ry, size: 9, font: ctx.font, color: COLOUR_BLACK });
        ry -= 13;
      }
    }
    ctx.y -= boxHeight + 8;

    // Checkboxes
    ensureSpace(ctx, 18);
    // Use plain text for checkboxes since Helvetica doesn't have Unicode ballot glyphs
    const testingLabel = rf.addToTesting ? '[x] Add to testing' : '[ ] Add to testing';
    const reviewedLabel = rf.reviewed ? '[x] Reviewed' : '[ ] Reviewed';
    ctx.currentPage.drawText(testingLabel, { x: MARGIN_LEFT, y: ctx.y, size: 9, font: ctx.font, color: COLOUR_BLACK });
    ctx.currentPage.drawText(reviewedLabel, { x: MARGIN_LEFT + 160, y: ctx.y, size: 9, font: ctx.font, color: COLOUR_BLACK });
    ctx.y -= 24;
  }
}

function renderWorkPerformed(ctx: PageContext): void {
  drawSectionHeading(ctx, 'Work Performed');

  const text = 'The documents listed in Appendix A were submitted for AI-assisted analysis. Each document was processed using a large language model via the Acumon Intelligence platform. The AI engine performed a comprehensive clause-by-clause analysis covering: parties, dates, signatories, obligations, risks, deliverables, default and termination conditions, future obligations and rights, performance obligations, and onerous provisions. Additional material matters were identified using professional judgement. All findings include specific clause or section references from the source documents. Full findings are presented in Appendix B.';
  drawParagraph(ctx, text);
}

function renderCaveats(ctx: PageContext): void {
  drawSectionHeading(ctx, 'Caveats');

  const intro = 'This report has been generated using Artificial Intelligence and automated document analysis tools provided by Acumon Intelligence. While every effort has been made to ensure accuracy, users should be aware of the following limitations:';
  drawParagraph(ctx, intro);
  ctx.y -= 4;

  const caveats = [
    'AI-generated analysis may contain errors, omissions, or misinterpretations of document content.',
    'This report does not constitute legal, financial, or professional advice.',
    'Users are strongly advised to perform independent manual checks and not rely on this report in isolation.',
    'The analysis is based solely on the text content of the uploaded documents and does not consider external context, verbal agreements, or supplementary documentation.',
    'Acumon Intelligence accepts no liability for decisions made based on the contents of this report.',
    'This report should be used as a supporting tool within a broader audit or review process.',
  ];

  for (let i = 0; i < caveats.length; i++) {
    drawParagraph(ctx, `${i + 1}. ${caveats[i]}`, 10, 10);
  }
}

function renderConclusion(ctx: PageContext): void {
  drawSectionHeading(ctx, 'Conclusion');
  drawParagraph(ctx, 'End of Report');
}

function renderAppendixA(ctx: PageContext, files: FileInfo[]): void {
  drawSectionHeading(ctx, 'Appendix A \u2014 Document Metadata');

  const columns: TableColumn[] = [
    { header: '#', width: 25 },
    { header: 'Document Name', width: 160 },
    { header: 'Uploaded By', width: 80 },
    { header: 'Upload Date', width: 70 },
    { header: 'File Size', width: 55 },
    { header: 'Pages', width: 40 },
    { header: 'Acumon Ref', width: 65 },
  ];

  const rows: TableRow[] = files.map((f, i) => ({
    cells: [
      String(i + 1),
      f.originalName,
      f.uploadedBy,
      formatDate(new Date(f.createdAt)),
      formatFileSize(f.fileSize),
      f.pageCount != null ? String(f.pageCount) : '-',
      f.id.substring(0, 8),
    ],
  }));

  drawTable(ctx, columns, rows);
}

function renderAppendixB(ctx: PageContext, findings: Finding[], files: FileInfo[]): void {
  drawSectionHeading(ctx, 'Appendix B \u2014 Detailed Findings');

  // Group findings by file
  const fileMap = new Map<string, FileInfo>();
  for (const f of files) fileMap.set(f.id, f);

  const grouped = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = grouped.get(f.fileId) || [];
    list.push(f);
    grouped.set(f.fileId, list);
  }

  for (const file of files) {
    const fileFindings = grouped.get(file.id);
    if (!fileFindings || fileFindings.length === 0) continue;

    ensureSpace(ctx, 40);
    ctx.currentPage.drawText(file.originalName, {
      x: MARGIN_LEFT,
      y: ctx.y,
      size: 12,
      font: ctx.fontBold,
      color: COLOUR_BLACK,
    });
    ctx.y -= 20;

    const columns: TableColumn[] = [
      { header: 'Area', width: 90 },
      { header: 'Finding', width: 250 },
      { header: 'Clause Reference', width: 100 },
      { header: 'Risk', width: 55 },
    ];

    const rows: TableRow[] = fileFindings.map((f) => ({
      cells: [f.area, f.finding, f.clauseReference, f.isSignificantRisk ? 'Yes' : 'No'],
      highlight: f.isSignificantRisk,
    }));

    drawTable(ctx, columns, rows);
    ctx.y -= 8;
  }
}

// ---------------------------------------------------------------------------
// TOC renderer
// ---------------------------------------------------------------------------

function renderTOC(
  doc: PDFDocument,
  font: PDFFont,
  fontBold: PDFFont,
  sectionPages: Map<string, number>,
  firmName: string,
  clientName: string,
): PDFPage[] {
  const tocPages: PDFPage[] = [];
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  tocPages.push(page);
  drawHeader(page, font, firmName, clientName);

  let y = PAGE_HEIGHT - MARGIN_TOP;

  // Title
  page.drawText('Contents', { x: MARGIN_LEFT, y, size: 18, font: fontBold, color: COLOUR_BLACK });
  y -= 36;

  const sections = [
    'Summary',
    'Key Matters',
    'Work Performed',
    'Caveats',
    'Conclusion',
    'Appendix A',
    'Appendix B',
  ];

  for (const section of sections) {
    const pageNum = sectionPages.get(section) || 1;
    const label = section;
    const pageNumStr = String(pageNum);

    const labelWidth = font.widthOfTextAtSize(label, 11);
    const numWidth = font.widthOfTextAtSize(pageNumStr, 11);
    const dotsWidth = CONTENT_WIDTH - labelWidth - numWidth - 10;
    const dotChar = '.';
    const dotWidth = font.widthOfTextAtSize(dotChar, 11);
    const dotsCount = Math.max(0, Math.floor(dotsWidth / dotWidth));
    const dots = dotChar.repeat(dotsCount);

    page.drawText(label, { x: MARGIN_LEFT, y, size: 11, font, color: COLOUR_BLACK });
    page.drawText(dots, { x: MARGIN_LEFT + labelWidth + 4, y, size: 11, font, color: COLOUR_LIGHT_GREY });
    page.drawText(pageNumStr, { x: PAGE_WIDTH - MARGIN_RIGHT - numWidth, y, size: 11, font, color: COLOUR_BLACK });
    y -= 22;
  }

  return tocPages;
}

// ---------------------------------------------------------------------------
// Cover page
// ---------------------------------------------------------------------------

function renderCoverPage(doc: PDFDocument, font: PDFFont, fontBold: PDFFont, params: PdfParams): PDFPage {
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  const title = 'DOCUMENT SUMMARY REPORT';
  const titleWidth = fontBold.widthOfTextAtSize(title, 24);
  page.drawText(title, {
    x: (PAGE_WIDTH - titleWidth) / 2,
    y: PAGE_HEIGHT / 2 + 80,
    size: 24,
    font: fontBold,
    color: COLOUR_BLACK,
  });

  const clientWidth = font.widthOfTextAtSize(params.clientName, 18);
  page.drawText(params.clientName, {
    x: (PAGE_WIDTH - clientWidth) / 2,
    y: PAGE_HEIGHT / 2 + 40,
    size: 18,
    font,
    color: COLOUR_BLACK,
  });

  const prepText = `Prepared by: ${params.userName}`;
  const prepWidth = font.widthOfTextAtSize(prepText, 12);
  page.drawText(prepText, {
    x: (PAGE_WIDTH - prepWidth) / 2,
    y: PAGE_HEIGHT / 2 - 10,
    size: 12,
    font,
    color: COLOUR_BLACK,
  });

  const dateText = `Date: ${formatDate(params.exportDate)}`;
  const dateWidth = font.widthOfTextAtSize(dateText, 12);
  page.drawText(dateText, {
    x: (PAGE_WIDTH - dateWidth) / 2,
    y: PAGE_HEIGHT / 2 - 30,
    size: 12,
    font,
    color: COLOUR_BLACK,
  });

  const acumonText = 'Acumon Intelligence';
  const acumonWidth = font.widthOfTextAtSize(acumonText, 10);
  page.drawText(acumonText, {
    x: (PAGE_WIDTH - acumonWidth) / 2,
    y: 60,
    size: 10,
    font,
    color: COLOUR_GREY,
  });

  return page;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function generateDocSummaryPdf(params: PdfParams): Promise<Uint8Array> {
  // ------------------------------------------------------------------
  // Pass 1: render all content sections into a temporary document to
  //         figure out which page each section starts on.
  // ------------------------------------------------------------------
  const tmpDoc = await PDFDocument.create();
  const tmpFont = await tmpDoc.embedFont(StandardFonts.Helvetica);
  const tmpFontBold = await tmpDoc.embedFont(StandardFonts.HelveticaBold);

  const tmpCtx: PageContext = {
    doc: tmpDoc,
    pages: [],
    currentPage: null as unknown as PDFPage,
    y: 0,
    font: tmpFont,
    fontBold: tmpFontBold,
    clientName: params.clientName,
    firmName: params.firmName,
    drawHeaderFooter: true,
  };

  // Track section start pages (relative to content, i.e. page index in tmpCtx.pages)
  const sectionStartPage = new Map<string, number>();

  // Render each section, recording its start page
  newPage(tmpCtx);
  sectionStartPage.set('Summary', tmpCtx.pages.length);
  renderSummary(tmpCtx, params.findings, params.files, params.clientName);

  sectionStartPage.set('Key Matters', tmpCtx.pages.length);
  renderKeyMatters(tmpCtx, params.findings);

  sectionStartPage.set('Work Performed', tmpCtx.pages.length);
  renderWorkPerformed(tmpCtx);

  sectionStartPage.set('Caveats', tmpCtx.pages.length);
  renderCaveats(tmpCtx);

  sectionStartPage.set('Conclusion', tmpCtx.pages.length);
  renderConclusion(tmpCtx);

  sectionStartPage.set('Appendix A', tmpCtx.pages.length);
  renderAppendixA(tmpCtx, params.files);

  sectionStartPage.set('Appendix B', tmpCtx.pages.length);
  renderAppendixB(tmpCtx, params.findings, params.files);

  const contentPageCount = tmpCtx.pages.length;

  // Determine TOC page count — assume 1 page for the TOC (7 sections easily fits)
  const tocPageCount = 1;

  // Compute absolute page numbers for the TOC
  // Page layout: cover (page not numbered) | TOC | content pages
  // Numbered pages start from the TOC page as page 1
  const sectionAbsolutePages = new Map<string, number>();
  sectionStartPage.forEach((relPage, section) => {
    sectionAbsolutePages.set(section, tocPageCount + relPage);
  });

  // ------------------------------------------------------------------
  // Pass 2: build the final PDF
  // ------------------------------------------------------------------
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // 1. Cover page (no header/footer)
  renderCoverPage(doc, font, fontBold, params);

  // 2. TOC page(s)
  const tocPages = renderTOC(doc, font, fontBold, sectionAbsolutePages, params.firmName, params.clientName);

  // 3. Content pages
  const ctx: PageContext = {
    doc,
    pages: [],
    currentPage: null as unknown as PDFPage,
    y: 0,
    font,
    fontBold,
    clientName: params.clientName,
    firmName: params.firmName,
    drawHeaderFooter: true,
  };

  newPage(ctx);
  renderSummary(ctx, params.findings, params.files, params.clientName);
  renderKeyMatters(ctx, params.findings);
  renderWorkPerformed(ctx);
  renderCaveats(ctx);
  renderConclusion(ctx);
  renderAppendixA(ctx, params.files);
  renderAppendixB(ctx, params.findings, params.files);

  // Draw footers on all numbered pages (TOC + content)
  // Combine tocPages and content pages for footer numbering
  const allNumberedPages = [...tocPages, ...ctx.pages];
  drawAllFooters(allNumberedPages, font, 0);

  const pdfBytes = await doc.save();
  return pdfBytes;
}
