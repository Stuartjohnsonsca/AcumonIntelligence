/**
 * Sampling Plan PDF Report Generator
 *
 * Generates a regulator-ready PDF containing:
 * - Objective, assertions, population definition
 * - Parameters (materiality, confidence, error metric)
 * - Sampling approach and sample size rationale
 * - Coverage summary (population vs sample totals)
 * - Selected items list
 * - Audit trail (hash, seed, algorithm, timestamp)
 * - Prepared by / reviewed by sign-off blocks
 */

import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb } from 'pdf-lib';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SamplingReportData {
  // Engagement
  clientName: string;
  periodStart: string;
  periodEnd: string;
  auditArea: string;
  testingType: string;
  preparedBy: string;
  preparedDate: string;

  // Audit parameters
  performanceMateriality: number;
  clearlyTrivial: number;
  tolerableMisstatement: number;
  functionalCurrency: string;
  dataType: string;
  testType: string;
  confidenceLevel: number;

  // Sampling method
  method: string;
  stratification: string;
  algorithmName: string;
  planningRationale: string;
  errorMetric: string;

  // Results
  populationSize: number;
  populationTotal: number;
  sampleSize: number;
  sampleTotal: number;
  coverage: number;
  seed: number;

  // Audit trail
  populationHash: string;
  timestamp: string;
  toolVersion: string;

  // Selected items (first 100 for PDF)
  selectedItems: { id: string; bookValue: number; reason: string }[];

  // Mode B strata (optional)
  strata?: { name: string; itemCount: number; sampleSize: number; totalValue: number; topDrivers: { feature: string }[] }[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PAGE_WIDTH = 595.28;  // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const LINE_HEIGHT = 14;
const HEADER_COLOR = rgb(0.067, 0.333, 0.533); // Dark blue
const TEXT_COLOR = rgb(0.2, 0.2, 0.2);
const LIGHT_GRAY = rgb(0.92, 0.92, 0.92);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return dateStr; }
}

function methodLabel(method: string): string {
  const labels: Record<string, string> = {
    random: 'Simple Random Sampling (SRSWOR)',
    systematic: 'Systematic Interval Sampling',
    mus: 'Monetary Unit Sampling (MUS)',
    judgemental: 'Judgemental Sampling',
    composite: 'Composite Sampling',
    stratified: 'AI Risk Stratification',
  };
  return labels[method] || method;
}

// ─── PDF Generator ───────────────────────────────────────────────────────────

export async function generateSamplingPlanPdf(data: SamplingReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function newPage(): PDFPage {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    return page;
  }

  function drawText(text: string, x: number, size: number, f: PDFFont = font, color = TEXT_COLOR) {
    // Wrap long text
    const maxWidth = CONTENT_WIDTH - (x - MARGIN);
    const words = text.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(test, size) > maxWidth && line) {
        page.drawText(line, { x, y, size, font: f, color });
        y -= LINE_HEIGHT;
        line = word;
      } else {
        line = test;
      }
    }
    if (line) {
      page.drawText(line, { x, y, size, font: f, color });
      y -= LINE_HEIGHT;
    }
  }

  function drawHeading(text: string) {
    if (y < 80) newPage();
    y -= 8;
    page.drawRectangle({ x: MARGIN, y: y - 2, width: CONTENT_WIDTH, height: 20, color: HEADER_COLOR });
    page.drawText(text, { x: MARGIN + 8, y: y + 3, size: 11, font: fontBold, color: rgb(1, 1, 1) });
    y -= 26;
  }

  function drawField(label: string, value: string) {
    if (y < 40) newPage();
    page.drawText(label, { x: MARGIN, y, size: 8, font: fontBold, color: rgb(0.4, 0.4, 0.4) });
    page.drawText(value, { x: MARGIN + 160, y, size: 9, font, color: TEXT_COLOR });
    y -= LINE_HEIGHT;
  }

  function drawSeparator() {
    y -= 4;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.5, color: LIGHT_GRAY });
    y -= 8;
  }

  // ─── Title Page ────────────────────────────────────────────────────────

  y -= 40;
  page.drawText('SAMPLING PLAN', { x: MARGIN, y, size: 24, font: fontBold, color: HEADER_COLOR });
  y -= 30;
  page.drawText(data.clientName, { x: MARGIN, y, size: 16, font: fontBold, color: TEXT_COLOR });
  y -= 20;
  page.drawText(`${formatDate(data.periodStart)} — ${formatDate(data.periodEnd)}`, { x: MARGIN, y, size: 11, font, color: TEXT_COLOR });
  y -= 14;
  page.drawText(`Audit Area: ${data.auditArea || '—'}`, { x: MARGIN, y, size: 10, font, color: TEXT_COLOR });
  y -= 30;

  drawSeparator();
  drawField('Prepared by', data.preparedBy);
  drawField('Date', data.preparedDate);
  drawField('Tool version', data.toolVersion);
  drawField('Confidence level', `${data.confidenceLevel}%`);
  drawSeparator();

  // ─── 1. Objective & Parameters ─────────────────────────────────────────

  drawHeading('1. Audit Parameters');
  drawField('Performance Materiality', formatCurrency(data.performanceMateriality, data.functionalCurrency));
  drawField('Clearly Trivial', formatCurrency(data.clearlyTrivial, data.functionalCurrency));
  drawField('Tolerable Misstatement', formatCurrency(data.tolerableMisstatement, data.functionalCurrency));
  drawField('Functional Currency', data.functionalCurrency);
  drawField('Type of Data', data.dataType);
  drawField('Type of Test', data.testType.replace(/_/g, ' '));
  drawField('Testing Type', data.testingType || '—');

  // ─── 2. Sampling Approach ──────────────────────────────────────────────

  drawHeading('2. Sampling Approach');
  drawField('Sampling Method', methodLabel(data.method));
  drawField('Mode', data.stratification === 'stratified' ? 'B — AI Risk Stratification' : 'A — Traditional Sampling');
  drawField('Error Metric', data.errorMetric.replace(/_/g, ' '));
  drawField('Algorithm', data.algorithmName);
  drawField('PRNG Seed', String(data.seed));
  y -= 6;
  drawText('Sample Size Rationale:', MARGIN, 8, fontBold, rgb(0.4, 0.4, 0.4));
  drawText(data.planningRationale, MARGIN, 9);

  // ─── 3. Coverage Summary ───────────────────────────────────────────────

  drawHeading('3. Coverage Summary');
  drawField('Population Size', `${data.populationSize.toLocaleString()} items`);
  drawField('Population Total', formatCurrency(data.populationTotal, data.functionalCurrency));
  drawField('Sample Size', `${data.sampleSize.toLocaleString()} items`);
  drawField('Sample Total', formatCurrency(data.sampleTotal, data.functionalCurrency));
  drawField('Value Coverage', `${data.coverage.toFixed(2)}%`);

  // ─── 4. Mode B Strata (if applicable) ─────────────────────────────────

  if (data.strata && data.strata.length > 0) {
    drawHeading('4. Risk Stratification Summary');
    for (const s of data.strata) {
      drawField(s.name, `${s.itemCount} items (${s.sampleSize} sampled) — ${formatCurrency(s.totalValue, data.functionalCurrency)}`);
      if (s.topDrivers.length > 0) {
        drawText(`  Top drivers: ${s.topDrivers.map(d => d.feature).join(', ')}`, MARGIN + 10, 8, font, rgb(0.5, 0.5, 0.5));
      }
    }
  }

  // ─── 5. Selected Items ─────────────────────────────────────────────────

  newPage();
  const sectionNum = data.strata?.length ? '5' : '4';
  drawHeading(`${sectionNum}. Selected Sample Items`);

  // Table header
  const colX = [MARGIN, MARGIN + 60, MARGIN + 200, MARGIN + 340];
  const colW = [60, 140, 140, CONTENT_WIDTH - 340];
  page.drawRectangle({ x: MARGIN, y: y - 2, width: CONTENT_WIDTH, height: 16, color: LIGHT_GRAY });
  page.drawText('#', { x: colX[0] + 4, y: y + 2, size: 7, font: fontBold, color: TEXT_COLOR });
  page.drawText('Transaction ID', { x: colX[1] + 4, y: y + 2, size: 7, font: fontBold, color: TEXT_COLOR });
  page.drawText('Book Value', { x: colX[2] + 4, y: y + 2, size: 7, font: fontBold, color: TEXT_COLOR });
  page.drawText('Selection Reason', { x: colX[3] + 4, y: y + 2, size: 7, font: fontBold, color: TEXT_COLOR });
  y -= 18;

  const maxItems = Math.min(data.selectedItems.length, 100);
  for (let i = 0; i < maxItems; i++) {
    if (y < 40) {
      newPage();
      // Repeat header
      page.drawRectangle({ x: MARGIN, y: y - 2, width: CONTENT_WIDTH, height: 16, color: LIGHT_GRAY });
      page.drawText('#', { x: colX[0] + 4, y: y + 2, size: 7, font: fontBold, color: TEXT_COLOR });
      page.drawText('Transaction ID', { x: colX[1] + 4, y: y + 2, size: 7, font: fontBold, color: TEXT_COLOR });
      page.drawText('Book Value', { x: colX[2] + 4, y: y + 2, size: 7, font: fontBold, color: TEXT_COLOR });
      page.drawText('Selection Reason', { x: colX[3] + 4, y: y + 2, size: 7, font: fontBold, color: TEXT_COLOR });
      y -= 18;
    }

    const item = data.selectedItems[i];
    if (i % 2 === 0) {
      page.drawRectangle({ x: MARGIN, y: y - 2, width: CONTENT_WIDTH, height: 13, color: rgb(0.97, 0.97, 0.97) });
    }
    page.drawText(String(i + 1), { x: colX[0] + 4, y: y + 1, size: 7, font, color: TEXT_COLOR });
    page.drawText(item.id.slice(0, 25), { x: colX[1] + 4, y: y + 1, size: 7, font, color: TEXT_COLOR });
    page.drawText(formatCurrency(item.bookValue, data.functionalCurrency), { x: colX[2] + 4, y: y + 1, size: 7, font, color: TEXT_COLOR });
    page.drawText((item.reason || '—').slice(0, 35), { x: colX[3] + 4, y: y + 1, size: 7, font, color: rgb(0.5, 0.5, 0.5) });
    y -= 13;
  }

  if (data.selectedItems.length > 100) {
    y -= 8;
    drawText(`... and ${data.selectedItems.length - 100} more items (see Excel export for full list)`, MARGIN, 8, font, rgb(0.5, 0.5, 0.5));
  }

  // ─── Audit Trail ───────────────────────────────────────────────────────

  newPage();
  const trailNum = data.strata?.length ? '6' : '5';
  drawHeading(`${trailNum}. Audit Trail`);
  drawField('Population Hash (SHA-256)', data.populationHash.slice(0, 40) + '...');
  drawField('PRNG Algorithm', data.algorithmName);
  drawField('PRNG Seed', String(data.seed));
  drawField('Timestamp', data.timestamp);
  drawField('Tool Version', data.toolVersion);
  y -= 10;
  drawText('This sampling selection is fully reproducible. Given the same population data (verified by hash), seed, and algorithm, the identical sample will be selected.', MARGIN, 8, font, rgb(0.5, 0.5, 0.5));

  // ─── Sign-off ──────────────────────────────────────────────────────────

  y -= 30;
  if (y < 120) newPage();
  drawHeading('Sign-off');
  y -= 10;

  // Prepared by
  page.drawText('Prepared by:', { x: MARGIN, y, size: 9, font: fontBold, color: TEXT_COLOR });
  y -= 20;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + 200, y }, thickness: 0.5, color: TEXT_COLOR });
  page.drawText('Name', { x: MARGIN, y: y - 10, size: 7, font, color: rgb(0.5, 0.5, 0.5) });
  page.drawLine({ start: { x: MARGIN + 250, y }, end: { x: MARGIN + 400, y }, thickness: 0.5, color: TEXT_COLOR });
  page.drawText('Date', { x: MARGIN + 250, y: y - 10, size: 7, font, color: rgb(0.5, 0.5, 0.5) });

  y -= 30;

  // Reviewed by
  page.drawText('Reviewed by:', { x: MARGIN, y, size: 9, font: fontBold, color: TEXT_COLOR });
  y -= 20;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + 200, y }, thickness: 0.5, color: TEXT_COLOR });
  page.drawText('Name', { x: MARGIN, y: y - 10, size: 7, font, color: rgb(0.5, 0.5, 0.5) });
  page.drawLine({ start: { x: MARGIN + 250, y }, end: { x: MARGIN + 400, y }, thickness: 0.5, color: TEXT_COLOR });
  page.drawText('Date', { x: MARGIN + 250, y: y - 10, size: 7, font, color: rgb(0.5, 0.5, 0.5) });

  // ─── Footer on all pages ───────────────────────────────────────────────

  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    p.drawText(`${data.clientName} — Sampling Plan`, { x: MARGIN, y: 20, size: 7, font, color: rgb(0.6, 0.6, 0.6) });
    p.drawText(`Page ${i + 1} of ${pages.length}`, { x: PAGE_WIDTH - MARGIN - 60, y: 20, size: 7, font, color: rgb(0.6, 0.6, 0.6) });
    p.drawText('Generated by Acumon Intelligence', { x: PAGE_WIDTH / 2 - 50, y: 20, size: 7, font, color: rgb(0.6, 0.6, 0.6) });
  }

  return doc.save();
}
