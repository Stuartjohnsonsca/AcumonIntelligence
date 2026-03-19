import { PDFDocument, PDFPage, PDFFont, PDFImage, StandardFonts, rgb } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Finding {
  id: string;
  area: string;
  finding: string;
  clauseReference: string;
  isSignificantRisk: boolean;
  aiSignificantRisk: boolean;
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
  singleFileId?: string;
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
const COLOUR_RISK_BG = rgb(1, 0.929, 0.835); // light orange
const COLOUR_RISK_HIGH_BG = rgb(1, 0.85, 0.85); // light red — both flagged
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

/** Strip clause references like "(Clause 3.1)", "[s 4.2]", etc. from text */
function stripClauseRefs(text: string): string {
  return text
    .replace(/\s*\((?:Clause|Section|Art(?:icle)?|s\.?)\s*[\d.]+[^)]*\)/gi, '')
    .replace(/\s*\[(?:Clause|Section|Art(?:icle)?|s\.?)\s*[\d.]+[^\]]*\]/gi, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Logo loader
// ---------------------------------------------------------------------------

let _logoPngBytes: Buffer | null = null;

function loadLogoPngBytes(): Buffer {
  if (_logoPngBytes) return _logoPngBytes;
  // Try multiple possible paths for the logo
  const candidates = [
    path.join(process.cwd(), 'public', 'logo-dark.png'),
    path.resolve(__dirname, '..', 'public', 'logo-dark.png'),
  ];
  for (const p of candidates) {
    try {
      _logoPngBytes = fs.readFileSync(p);
      return _logoPngBytes;
    } catch {
      // try next
    }
  }
  throw new Error('Could not locate public/logo-dark.png');
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
  /** Whether this is the final (Pass 2) render — only create form fields in Pass 2 */
  isFinalPass: boolean;
}

function newPage(ctx: PageContext): PDFPage {
  const page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  ctx.pages.push(page);
  ctx.currentPage = page;
  ctx.y = PAGE_HEIGHT - MARGIN_TOP;
  if (ctx.drawHeaderFooter) {
    drawHeader(page, ctx.font, ctx.firmName, ctx.clientName);
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
  page.drawLine({
    start: { x: MARGIN_LEFT, y: HEADER_Y - 8 },
    end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: HEADER_Y - 8 },
    thickness: 0.5,
    color: COLOUR_LIGHT_GREY,
  });
}

function drawAllFooters(pages: PDFPage[], font: PDFFont, startIndex: number, logoImage: PDFImage): void {
  const total = pages.length;
  // Scale logo to ~15px height
  const logoDims = logoImage.scale(1);
  const logoTargetHeight = 15;
  const logoScale = logoTargetHeight / logoDims.height;
  const logoWidth = logoDims.width * logoScale;

  for (let i = startIndex; i < total; i++) {
    const page = pages[i];
    // Draw embedded logo in footer instead of text
    page.drawImage(logoImage, {
      x: MARGIN_LEFT,
      y: FOOTER_Y - 2,
      width: logoWidth,
      height: logoTargetHeight,
    });
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
  ctx.y -= 8;
}

function drawBoldParagraph(ctx: PageContext, text: string, fontSize: number = 10, indent: number = 0): void {
  const lines = wrapText(text, ctx.fontBold, fontSize, CONTENT_WIDTH - indent);
  for (const line of lines) {
    ensureSpace(ctx, fontSize + 6);
    ctx.currentPage.drawText(line, { x: MARGIN_LEFT + indent, y: ctx.y, size: fontSize, font: ctx.fontBold, color: COLOUR_BLACK });
    ctx.y -= fontSize + 4;
  }
  ctx.y -= 8;
}

/** Draw a bold label followed by regular text on the same/subsequent lines */
function drawLabelledParagraph(ctx: PageContext, label: string, text: string, fontSize: number = 10, indent: number = 0): void {
  const maxWidth = CONTENT_WIDTH - indent;
  // Measure the label
  const labelWidth = ctx.fontBold.widthOfTextAtSize(label + ' ', fontSize);

  // Draw label on first line
  ensureSpace(ctx, fontSize + 6);
  ctx.currentPage.drawText(label, { x: MARGIN_LEFT + indent, y: ctx.y, size: fontSize, font: ctx.fontBold, color: COLOUR_BLACK });

  // Wrap remaining text starting after the label on the first line
  const remainingFirstLine = maxWidth - labelWidth;
  const words = text.split(/\s+/);
  let firstLineText = '';
  let wordIdx = 0;

  for (; wordIdx < words.length; wordIdx++) {
    const test = firstLineText ? `${firstLineText} ${words[wordIdx]}` : words[wordIdx];
    if (ctx.font.widthOfTextAtSize(test, fontSize) > remainingFirstLine && firstLineText) break;
    firstLineText = test;
  }

  if (firstLineText) {
    ctx.currentPage.drawText(firstLineText, {
      x: MARGIN_LEFT + indent + labelWidth,
      y: ctx.y,
      size: fontSize,
      font: ctx.font,
      color: COLOUR_BLACK,
    });
  }
  ctx.y -= fontSize + 4;

  // Remaining words wrapped normally
  const remaining = words.slice(wordIdx).join(' ');
  if (remaining) {
    const lines = wrapText(remaining, ctx.font, fontSize, maxWidth);
    for (const line of lines) {
      ensureSpace(ctx, fontSize + 6);
      ctx.currentPage.drawText(line, { x: MARGIN_LEFT + indent, y: ctx.y, size: fontSize, font: ctx.font, color: COLOUR_BLACK });
      ctx.y -= fontSize + 4;
    }
  }
  ctx.y -= 8;
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
  bgColor?: ReturnType<typeof rgb>;
}

function drawTable(ctx: PageContext, columns: TableColumn[], rows: TableRow[], fontSize: number = 8): void {
  const rowHeight = 18;
  const headerHeight = 20;
  const cellPadding = 4;

  // Draw header row
  ensureSpace(ctx, headerHeight + 4);
  let x = MARGIN_LEFT;
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

    x = MARGIN_LEFT;
    const totalWidth = columns.reduce((s, c) => s + c.width, 0);
    const bgColor = row.bgColor || COLOUR_WHITE;
    ctx.currentPage.drawRectangle({
      x: MARGIN_LEFT,
      y: ctx.y - actualRowHeight + 4,
      width: totalWidth,
      height: actualRowHeight,
      color: bgColor,
      borderColor: COLOUR_TABLE_BORDER,
      borderWidth: 0.5,
    });

    x = MARGIN_LEFT;
    for (let i = 0; i < columns.length; i++) {
      if (i > 0) {
        ctx.currentPage.drawLine({
          start: { x, y: ctx.y + 4 },
          end: { x, y: ctx.y - actualRowHeight + 4 },
          thickness: 0.5,
          color: COLOUR_TABLE_BORDER,
        });
      }
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
  newPage(ctx);
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
      // Extract label (text before the colon) and make it bold, then the rest regular
      const colonIdx = rf.finding.indexOf(':');
      const cleanedFinding = stripClauseRefs(rf.finding);
      if (colonIdx > 0 && colonIdx < 80) {
        const label = cleanedFinding.substring(0, cleanedFinding.indexOf(':') >= 0 ? cleanedFinding.indexOf(':') + 1 : colonIdx + 1);
        const rest = cleanedFinding.substring(label.length).trim();
        drawLabelledParagraph(ctx, `${rf.area} \u2014 ${label}`, rest, 9, 10);
      } else {
        drawLabelledParagraph(ctx, `${rf.area}:`, cleanedFinding, 9, 10);
      }
    }
  }
}

function renderKeyMatters(ctx: PageContext, findings: Finding[]): void {
  newPage(ctx);
  drawSectionHeading(ctx, 'Key Matters');

  const riskFindings = findings.filter((f) => f.isSignificantRisk);
  if (riskFindings.length === 0) {
    drawParagraph(ctx, 'No significant risks identified.');
    return;
  }

  const form = ctx.isFinalPass ? ctx.doc.getForm() : null;

  for (const rf of riskFindings) {
    ensureSpace(ctx, 100);

    // Area name as bold heading
    ctx.currentPage.drawText(rf.area, {
      x: MARGIN_LEFT,
      y: ctx.y,
      size: 12,
      font: ctx.fontBold,
      color: COLOUR_BLACK,
    });
    ctx.y -= 16;

    // Clause references on next line in grey 9pt
    ctx.currentPage.drawText(rf.clauseReference, {
      x: MARGIN_LEFT,
      y: ctx.y,
      size: 9,
      font: ctx.font,
      color: COLOUR_GREY,
    });
    ctx.y -= 16;

    // Finding text
    drawParagraph(ctx, rf.finding, 10);

    // Response text field — editable, multiline, triple height
    ensureSpace(ctx, 110);
    ctx.currentPage.drawText('Response:', {
      x: MARGIN_LEFT,
      y: ctx.y,
      size: 9,
      font: ctx.fontBold,
      color: COLOUR_GREY,
    });
    ctx.y -= 14;

    const baseBoxHeight = 30;
    const boxHeight = baseBoxHeight * 3; // TRIPLE the current height

    // Always reserve space (both passes), only create field in Pass 2
    const boxY = ctx.y - boxHeight;

    if (form) {
      const textField = form.createTextField(`response_${rf.id}`);
      textField.addToPage(ctx.currentPage, {
        x: MARGIN_LEFT,
        y: boxY,
        width: CONTENT_WIDTH,
        height: boxHeight,
        borderColor: COLOUR_TABLE_BORDER,
        borderWidth: 0.75,
        backgroundColor: COLOUR_WHITE,
      });
      textField.enableMultiline();
      if (rf.userResponse) {
        textField.setText(rf.userResponse);
      }
    } else {
      // Pass 1: draw static rectangle to reserve space
      ctx.currentPage.drawRectangle({
        x: MARGIN_LEFT,
        y: boxY,
        width: CONTENT_WIDTH,
        height: boxHeight,
        borderColor: COLOUR_TABLE_BORDER,
        borderWidth: 0.75,
        color: COLOUR_WHITE,
      });
    }
    ctx.y = boxY - 8;

    // Add to Testing checkbox
    ensureSpace(ctx, 22);
    const checkboxY = ctx.y;

    if (form) {
      const testingCb = form.createCheckBox(`testing_${rf.id}`);
      testingCb.addToPage(ctx.currentPage, {
        x: MARGIN_LEFT,
        y: checkboxY - 10,
        width: 12,
        height: 12,
      });
      if (rf.addToTesting) testingCb.check();
    } else {
      ctx.currentPage.drawRectangle({
        x: MARGIN_LEFT,
        y: checkboxY - 10,
        width: 12,
        height: 12,
        borderColor: COLOUR_TABLE_BORDER,
        borderWidth: 0.5,
        color: COLOUR_WHITE,
      });
    }
    ctx.currentPage.drawText('Add to Testing', {
      x: MARGIN_LEFT + 16,
      y: checkboxY - 7,
      size: 9,
      font: ctx.font,
      color: COLOUR_BLACK,
    });

    // Reviewed checkbox + initials text field
    const reviewedX = MARGIN_LEFT + 140;

    if (form) {
      const reviewedCb = form.createCheckBox(`reviewed_${rf.id}`);
      reviewedCb.addToPage(ctx.currentPage, {
        x: reviewedX,
        y: checkboxY - 10,
        width: 12,
        height: 12,
      });
      if (rf.reviewed) reviewedCb.check();
    } else {
      ctx.currentPage.drawRectangle({
        x: reviewedX,
        y: checkboxY - 10,
        width: 12,
        height: 12,
        borderColor: COLOUR_TABLE_BORDER,
        borderWidth: 0.5,
        color: COLOUR_WHITE,
      });
    }
    ctx.currentPage.drawText('Reviewed', {
      x: reviewedX + 16,
      y: checkboxY - 7,
      size: 9,
      font: ctx.font,
      color: COLOUR_BLACK,
    });

    // Initials text field next to Reviewed
    const initialsX = reviewedX + 80;
    ctx.currentPage.drawText('Initials:', {
      x: initialsX,
      y: checkboxY - 7,
      size: 9,
      font: ctx.font,
      color: COLOUR_GREY,
    });

    if (form) {
      const initialsField = form.createTextField(`initials_${rf.id}`);
      initialsField.addToPage(ctx.currentPage, {
        x: initialsX + 42,
        y: checkboxY - 12,
        width: 60,
        height: 16,
        borderColor: COLOUR_TABLE_BORDER,
        borderWidth: 0.5,
        backgroundColor: COLOUR_WHITE,
      });
    } else {
      ctx.currentPage.drawRectangle({
        x: initialsX + 42,
        y: checkboxY - 12,
        width: 60,
        height: 16,
        borderColor: COLOUR_TABLE_BORDER,
        borderWidth: 0.5,
        color: COLOUR_WHITE,
      });
    }

    ctx.y = checkboxY - 30;
  }
}

function renderWorkPerformed(ctx: PageContext): void {
  newPage(ctx);
  drawSectionHeading(ctx, 'Work Performed');

  const paragraphs = [
    'The documents listed in Appendix A were submitted for AI-assisted analysis through the Acumon Intelligence platform. Each document underwent a rigorous multi-stage analytical process designed to identify key contractual provisions, obligations, risks, and matters of professional interest.',

    'Document Ingestion and Text Extraction: Each uploaded document was processed through an advanced document ingestion pipeline. The system performed optical character recognition (where applicable), structural parsing, and text extraction to produce a complete and accurate representation of the document content. Tables, schedules, annexures, and embedded references were captured and preserved for downstream analysis.',

    'Multi-Pass Clause Analysis: The extracted text was subjected to a multi-pass analytical framework. In the first pass, the AI engine identified and categorised individual clauses, provisions, and sections within each document. The second pass performed a detailed assessment of each identified clause against a comprehensive taxonomy covering: parties and counterparties, key dates and milestones, signatories, mutual and one-sided obligations, risk allocation provisions, deliverables and performance milestones, default and termination conditions, future obligations and contingent rights, performance obligations under applicable standards, and onerous or unusual provisions.',

    'Risk Assessment Against Professional Frameworks: Each finding was assessed for significance using a risk-based approach informed by relevant professional and accounting standards, including IFRS and IAS frameworks where applicable. The AI engine evaluated the potential impact of each clause on the reporting entity, considering factors such as financial exposure, compliance obligations, contingent liabilities, and disclosure requirements.',

    'Cross-Referencing and Obligation Mapping: The analysis included cross-referencing of obligations across related clauses and documents to identify interdependencies, conflicts, or gaps. Obligations were mapped to their corresponding clause references to enable efficient manual verification.',

    'Evidence-Based Approach: All findings presented in this report are linked to specific clause or section references within the source documents. This evidence-based approach ensures that each finding can be independently verified against the original document text. Full findings, including clause references and risk assessments, are presented in Appendix B.',

    'Additional material matters were identified using professional judgement applied by the AI analysis engine. The platform applied a conservative threshold for flagging matters of interest, favouring completeness over brevity to ensure that no potentially significant items were omitted from the review.',
  ];

  for (const p of paragraphs) {
    drawParagraph(ctx, p);
  }
}

function renderCaveats(ctx: PageContext, firmName: string, clientName: string): void {
  newPage(ctx);
  drawSectionHeading(ctx, 'Caveats');

  const scopeStatement = `This Report is provided to ${firmName} to assist with its work with ${clientName} only. It must not be disclosed to, or relied upon by, any other party without the prior written consent of Acumon Intelligence.`;
  drawParagraph(ctx, scopeStatement);
  ctx.y -= 4;

  const intro = 'This report has been generated using Artificial Intelligence and automated document analysis tools provided by Acumon Intelligence. While every effort has been made to ensure accuracy, users should be aware of the following limitations:';
  drawParagraph(ctx, intro);
  ctx.y -= 4;

  const caveats = [
    'AI-generated analysis may contain errors, omissions, or misinterpretations of document content. The outputs of this report are produced by a large language model and have not been independently verified by a human reviewer unless otherwise stated.',
    'This report does not constitute legal, financial, or professional advice. It is intended as a supporting analytical tool and should not be treated as a substitute for professional judgement.',
    'Users are strongly advised to perform independent manual checks and not rely on this report in isolation. Findings should be corroborated against the original source documents.',
    'The analysis is based solely on the text content of the uploaded documents and does not consider external context, verbal agreements, supplementary documentation, or information not contained within the analysed files.',
    'Acumon Intelligence accepts no liability for decisions made based on the contents of this report. Users assume full responsibility for any actions taken in reliance on the information presented herein.',
    'This report should be used as a supporting tool within a broader audit, review, or advisory process. It is not a replacement for a comprehensive professional engagement.',
    'The AI models used in this analysis are subject to inherent limitations, including potential biases in training data, difficulty interpreting ambiguous or poorly structured text, and an inability to apply contextual business knowledge beyond the document content provided.',
    'Clause references and section numbers cited in this report correspond to the structure of the original documents at the time of analysis. Subsequent amendments or revisions to the source documents may render these references inaccurate.',
  ];

  for (let i = 0; i < caveats.length; i++) {
    drawParagraph(ctx, `${i + 1}. ${caveats[i]}`, 10, 10);
  }
}

function renderConclusion(ctx: PageContext): void {
  newPage(ctx);
  drawSectionHeading(ctx, 'Conclusion');
  drawParagraph(ctx, 'End of Report');
}

function renderAppendixA(ctx: PageContext, files: FileInfo[]): void {
  newPage(ctx);
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
  newPage(ctx);
  drawSectionHeading(ctx, 'Appendix B \u2014 Detailed Findings');

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

    // 5 columns: Area | Finding | Clause Ref | AI Assessment | User Assessment
    const columns: TableColumn[] = [
      { header: 'Area', width: 75 },
      { header: 'Finding', width: 185 },
      { header: 'Clause Ref', width: 75 },
      { header: 'AI Assessment', width: 75 },
      { header: 'User Assessment', width: 85 },
    ];

    const rows: TableRow[] = fileFindings.map((f) => {
      const bothFlagged = f.aiSignificantRisk && f.isSignificantRisk;
      const eitherFlagged = f.aiSignificantRisk || f.isSignificantRisk;

      let bgColor = COLOUR_WHITE;
      if (bothFlagged) {
        bgColor = COLOUR_RISK_HIGH_BG; // light red
      } else if (eitherFlagged) {
        bgColor = COLOUR_RISK_BG; // light orange
      }

      return {
        cells: [
          f.area,
          f.finding,
          f.clauseReference,
          f.aiSignificantRisk ? 'Significant' : 'Normal',
          f.isSignificantRisk ? 'Significant' : 'Normal',
        ],
        bgColor,
      };
    });

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

function renderCoverPage(doc: PDFDocument, font: PDFFont, fontBold: PDFFont, params: PdfParams, logoImage: PDFImage): PDFPage {
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  // Logo in top-right corner
  const logoDims = logoImage.scale(1);
  const cornerLogoHeight = 30;
  const cornerLogoScale = cornerLogoHeight / logoDims.height;
  const cornerLogoWidth = logoDims.width * cornerLogoScale;
  page.drawImage(logoImage, {
    x: PAGE_WIDTH - MARGIN_RIGHT - cornerLogoWidth,
    y: PAGE_HEIGHT - MARGIN_TOP,
    width: cornerLogoWidth,
    height: cornerLogoHeight,
  });

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

  // "Powered By" in small grey text above the logo
  const poweredByText = 'Powered By';
  const poweredByWidth = font.widthOfTextAtSize(poweredByText, 8);
  page.drawText(poweredByText, {
    x: (PAGE_WIDTH - poweredByWidth) / 2,
    y: 82,
    size: 8,
    font,
    color: COLOUR_GREY,
  });

  // Centred logo at bottom of cover
  const coverLogoHeight = 20;
  const coverLogoScale = coverLogoHeight / logoDims.height;
  const coverLogoWidth = logoDims.width * coverLogoScale;
  page.drawImage(logoImage, {
    x: (PAGE_WIDTH - coverLogoWidth) / 2,
    y: 58,
    width: coverLogoWidth,
    height: coverLogoHeight,
  });

  return page;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function generateDocSummaryPdf(params: PdfParams): Promise<Uint8Array> {
  // If singleFileId is provided, filter findings and files
  let { findings, files } = params;
  if (params.singleFileId) {
    findings = findings.filter((f) => f.fileId === params.singleFileId);
    files = files.filter((f) => f.id === params.singleFileId);
  }

  // Load logo PNG bytes
  const logoPngBytes = loadLogoPngBytes();

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
    isFinalPass: false,
  };

  // Track section start pages
  const sectionStartPage = new Map<string, number>();

  sectionStartPage.set('Summary', tmpCtx.pages.length + 1);
  renderSummary(tmpCtx, findings, files, params.clientName);

  sectionStartPage.set('Key Matters', tmpCtx.pages.length + 1);
  renderKeyMatters(tmpCtx, findings);

  sectionStartPage.set('Work Performed', tmpCtx.pages.length + 1);
  renderWorkPerformed(tmpCtx);

  sectionStartPage.set('Caveats', tmpCtx.pages.length + 1);
  renderCaveats(tmpCtx, params.firmName, params.clientName);

  sectionStartPage.set('Conclusion', tmpCtx.pages.length + 1);
  renderConclusion(tmpCtx);

  sectionStartPage.set('Appendix A', tmpCtx.pages.length + 1);
  renderAppendixA(tmpCtx, files);

  sectionStartPage.set('Appendix B', tmpCtx.pages.length + 1);
  renderAppendixB(tmpCtx, findings, files);

  // Determine TOC page count — assume 1 page
  const tocPageCount = 1;

  // Compute absolute page numbers for the TOC
  const sectionAbsolutePages = new Map<string, number>();
  sectionStartPage.forEach((relPage, section) => {
    sectionAbsolutePages.set(section, tocPageCount + relPage);
  });

  // ------------------------------------------------------------------
  // Pass 2: build the final PDF with form fields
  // ------------------------------------------------------------------
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logoImage = await doc.embedPng(logoPngBytes);

  // 1. Cover page
  renderCoverPage(doc, font, fontBold, params, logoImage);

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
    isFinalPass: true,
  };

  renderSummary(ctx, findings, files, params.clientName);
  renderKeyMatters(ctx, findings);
  renderWorkPerformed(ctx);
  renderCaveats(ctx, params.firmName, params.clientName);
  renderConclusion(ctx);
  renderAppendixA(ctx, files);
  renderAppendixB(ctx, findings, files);

  // Draw footers on all numbered pages (TOC + content) with embedded logo
  const allNumberedPages = [...tocPages, ...ctx.pages];
  drawAllFooters(allNumberedPages, font, 0, logoImage);

  const pdfBytes = await doc.save();
  return pdfBytes;
}
