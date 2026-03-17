import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyJobAccess } from '@/lib/client-access';
import { downloadBlob, CONTAINERS } from '@/lib/azure-blob';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { PDFDocument, rgb } from 'pdf-lib';

interface FieldLocation {
  page: number;
  bbox: [number, number, number, number]; // [y_min, x_min, y_max, x_max] 0-1000
}

const FIELD_LABELS: Record<string, string> = {
  purchaserName: 'Purchaser Name',
  purchaserTaxId: 'Purchaser Tax ID',
  purchaserCountry: 'Purchaser Country',
  sellerName: 'Seller Name',
  sellerTaxId: 'Seller Tax ID',
  sellerCountry: 'Seller Country',
  documentRef: 'Document Ref',
  documentDate: 'Document Date',
  dueDate: 'Due Date',
  netTotal: 'Net Total',
  dutyTotal: 'Duty Total',
  taxTotal: 'Tax Total',
  grossTotal: 'Gross Total',
};

export const maxDuration = 120;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const jobAccess = await verifyJobAccess(session.user as { id: string; firmId: string; isSuperAdmin?: boolean }, jobId);
  if (!jobAccess.allowed) {
    return NextResponse.json({ error: jobAccess.reason || 'Forbidden' }, { status: 403 });
  }

  const job = await prisma.extractionJob.findUnique({
    where: { id: jobId },
    include: {
      files: true,
      records: { orderBy: { referenceId: 'asc' } },
      client: { select: { clientName: true, software: true } },
      user: { select: { name: true } },
    },
  });

  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  const zip = new JSZip();
  const docsFolder = zip.folder('documents')!;
  const annotatedFolder = zip.folder('annotated')!;
  const viewerFolder = zip.folder('viewer')!;

  const extractedFiles = job.files.filter(f => f.status === 'extracted');

  for (const file of extractedFiles) {
    const record = job.records.find(r => r.fileId === file.id);
    if (!record) continue;

    const containerName = file.containerName || CONTAINERS.PROCESSED;
    let fileBuffer: Buffer;
    try {
      fileBuffer = await downloadBlob(file.storagePath, containerName);
    } catch {
      continue;
    }

    docsFolder.file(file.originalName, fileBuffer);

    const fieldLocations = (record.fieldLocations || {}) as unknown as Record<string, FieldLocation>;
    const extractedValues: Record<string, unknown> = {
      purchaserName: record.purchaserName,
      purchaserTaxId: record.purchaserTaxId,
      purchaserCountry: record.purchaserCountry,
      sellerName: record.sellerName,
      sellerTaxId: record.sellerTaxId,
      sellerCountry: record.sellerCountry,
      documentRef: record.documentRef,
      documentDate: record.documentDate,
      dueDate: record.dueDate,
      netTotal: record.netTotal,
      dutyTotal: record.dutyTotal,
      taxTotal: record.taxTotal,
      grossTotal: record.grossTotal,
    };

    const isPdf = (file.mimeType || '').includes('pdf');
    if (isPdf) {
      try {
        const annotatedPdf = await annotatePdf(fileBuffer, fieldLocations, extractedValues);
        annotatedFolder.file(file.originalName, annotatedPdf);
      } catch {
        annotatedFolder.file(file.originalName, fileBuffer);
      }
    } else {
      annotatedFolder.file(file.originalName, fileBuffer);
    }

    const htmlContent = generateOfflineHtml(
      file.originalName,
      file.mimeType || 'application/octet-stream',
      fileBuffer,
      fieldLocations,
      extractedValues,
      record.referenceId,
    );
    const htmlName = file.originalName.replace(/\.[^.]+$/, '.html');
    viewerFolder.file(htmlName, htmlContent);
  }

  const excelBuffer = await generateExcelReport(job);
  zip.file('extraction_report.xlsx', excelBuffer);

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  return new Response(new Uint8Array(zipBuffer), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="extraction_${job.client.clientName.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}.zip"`,
    },
  });
}

async function annotatePdf(
  pdfBuffer: Buffer,
  fieldLocations: Record<string, FieldLocation>,
  extractedValues: Record<string, unknown>,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();

  for (const [fieldName, loc] of Object.entries(fieldLocations)) {
    const pageIdx = (loc.page || 1) - 1;
    if (pageIdx < 0 || pageIdx >= pages.length) continue;

    const page = pages[pageIdx];
    const { width, height } = page.getSize();

    const [yMin, xMin, yMax, xMax] = loc.bbox;
    const x = (xMin / 1000) * width;
    const y = height - (yMax / 1000) * height;
    const w = ((xMax - xMin) / 1000) * width;
    const h = ((yMax - yMin) / 1000) * height;

    const value = extractedValues[fieldName];
    const isFailed = value === null || value === undefined;
    const color = isFailed ? rgb(0.86, 0.15, 0.15) : rgb(0.15, 0.39, 0.92);

    page.drawRectangle({
      x, y, width: w, height: h,
      borderColor: color,
      borderWidth: 1.5,
      opacity: 0.3,
      color: isFailed ? rgb(0.86, 0.15, 0.15) : rgb(0.15, 0.39, 0.92),
    });
  }

  return pdfDoc.save();
}

function generateOfflineHtml(
  fileName: string,
  mimeType: string,
  fileBuffer: Buffer,
  fieldLocations: Record<string, FieldLocation>,
  extractedValues: Record<string, unknown>,
  referenceId: string,
): string {
  const base64 = fileBuffer.toString('base64');
  const isPdf = mimeType.includes('pdf');
  const dataUri = `data:${mimeType};base64,${base64}`;

  const fieldsJson = JSON.stringify(fieldLocations);
  const valuesJson = JSON.stringify(extractedValues);
  const labelsJson = JSON.stringify(FIELD_LABELS);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${referenceId} - ${fileName}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1e293b; color: #e2e8f0; display: flex; height: 100vh; }
  .sidebar { width: 280px; background: #0f172a; border-right: 1px solid #334155; overflow-y: auto; padding: 16px; flex-shrink: 0; }
  .sidebar h2 { font-size: 14px; color: #94a3b8; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  .sidebar h3 { font-size: 16px; color: #e2e8f0; margin-bottom: 4px; }
  .sidebar .ref { font-size: 12px; color: #64748b; margin-bottom: 16px; }
  .field-btn { display: block; width: 100%; text-align: left; padding: 8px 12px; border-radius: 6px; border: none; background: transparent; color: #e2e8f0; cursor: pointer; font-size: 12px; margin-bottom: 2px; }
  .field-btn:hover { background: #1e293b; }
  .field-btn.active { background: #1e3a5f; border: 1px solid #2563eb; }
  .field-btn.failed { color: #fca5a5; }
  .field-label { font-weight: 600; color: #94a3b8; }
  .field-value { margin-top: 2px; }
  .viewer { flex: 1; overflow: auto; display: flex; align-items: flex-start; justify-content: center; padding: 32px; position: relative; }
  .doc-container { position: relative; display: inline-block; }
  .doc-container img, .doc-container canvas { display: block; max-width: 100%; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); border-radius: 4px; }
  .overlay-box { position: absolute; border: 2px solid; border-radius: 2px; cursor: pointer; transition: all 0.15s; }
  .overlay-box.blue { border-color: #2563eb; background: rgba(37,99,235,0.2); }
  .overlay-box.yellow { border-color: #eab308; background: rgba(234,179,8,0.15); }
  .overlay-box.red { border-color: #dc2626; background: rgba(220,38,38,0.15); }
</style>
${isPdf ? `<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.min.mjs" type="module"><\/script>` : ''}
</head>
<body>
<div class="sidebar">
  <h2>Extracted Fields</h2>
  <h3>${fileName}</h3>
  <div class="ref">${referenceId}</div>
  <div id="field-list"></div>
</div>
<div class="viewer">
  <div class="doc-container" id="doc-container">
    ${isPdf ? '<canvas id="pdf-canvas"></canvas>' : `<img id="doc-img" src="${dataUri}" alt="Document">`}
    <div id="overlay-layer" style="position:absolute;inset:0;pointer-events:none;"></div>
  </div>
</div>
<script${isPdf ? ' type="module"' : ''}>
const fieldLocations = ${fieldsJson};
const extractedValues = ${valuesJson};
const fieldLabels = ${labelsJson};
let activeField = null;

function renderFields() {
  const list = document.getElementById('field-list');
  list.innerHTML = '';
  for (const [key, label] of Object.entries(fieldLabels)) {
    const val = extractedValues[key];
    const isFailed = val === null || val === undefined;
    const btn = document.createElement('button');
    btn.className = 'field-btn' + (activeField === key ? ' active' : '') + (isFailed ? ' failed' : '');
    btn.innerHTML = '<div class="field-label">' + label + '</div><div class="field-value">' + (isFailed ? 'Not extracted' : val) + '</div>';
    btn.onclick = () => { activeField = activeField === key ? null : key; renderFields(); renderOverlays(); };
    list.appendChild(btn);
  }
}

function renderOverlays() {
  const layer = document.getElementById('overlay-layer');
  layer.innerHTML = '';
  layer.style.pointerEvents = 'auto';
  for (const [key, loc] of Object.entries(fieldLocations)) {
    const [yMin, xMin, yMax, xMax] = loc.bbox;
    const val = extractedValues[key];
    const isFailed = val === null || val === undefined;
    const isActive = activeField === key;
    const box = document.createElement('div');
    box.className = 'overlay-box ' + (isActive ? 'blue' : isFailed ? 'red' : 'yellow');
    box.style.left = (xMin/10) + '%';
    box.style.top = (yMin/10) + '%';
    box.style.width = ((xMax-xMin)/10) + '%';
    box.style.height = ((yMax-yMin)/10) + '%';
    box.style.zIndex = isActive ? '10' : '5';
    box.title = (fieldLabels[key] || key) + ': ' + (val ?? 'N/A');
    box.onclick = () => { activeField = activeField === key ? null : key; renderFields(); renderOverlays(); };
    layer.appendChild(box);
  }
}

${isPdf ? `
async function renderPdf() {
  const pdfjsLib = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.min.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.mjs';
  const loadingTask = pdfjsLib.getDocument({data: Uint8Array.from(atob('${base64}'), c => c.charCodeAt(0))});
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({scale: 1.5});
  const canvas = document.getElementById('pdf-canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({canvasContext: canvas.getContext('2d'), viewport}).promise;
  renderOverlays();
}
renderPdf();
` : `
document.getElementById('doc-img').onload = () => renderOverlays();
`}

renderFields();
<\/script>
</body>
</html>`;
}

async function generateExcelReport(
  job: {
    client: { clientName: string; software: string | null };
    user: { name: string };
    extractedAt: Date | null;
    records: {
      referenceId: string;
      purchaserName: string | null;
      purchaserTaxId: string | null;
      purchaserCountry: string | null;
      sellerName: string | null;
      sellerTaxId: string | null;
      sellerCountry: string | null;
      documentRef: string | null;
      documentDate: string | null;
      dueDate: string | null;
      netTotal: number | null;
      dutyTotal: number | null;
      taxTotal: number | null;
      grossTotal: number | null;
      accountCategory: string | null;
      lineItems: unknown;
    }[];
  },
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  // Document Details sheet
  const detailsSheet = workbook.addWorksheet('Document Details');
  detailsSheet.columns = [
    { header: 'Ref', key: 'ref', width: 10 },
    { header: 'Document Ref', key: 'docRef', width: 18 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Due Date', key: 'dueDate', width: 14 },
    { header: 'Seller', key: 'seller', width: 25 },
    { header: 'Seller Tax ID', key: 'sellerTax', width: 18 },
    { header: 'Seller Country', key: 'sellerCountry', width: 14 },
    { header: 'Purchaser', key: 'purchaser', width: 25 },
    { header: 'Purchaser Tax ID', key: 'purchaserTax', width: 18 },
    { header: 'Purchaser Country', key: 'purchaserCountry', width: 14 },
    { header: 'Net', key: 'net', width: 14 },
    { header: 'Duty', key: 'duty', width: 14 },
    { header: 'Tax', key: 'tax', width: 14 },
    { header: 'Gross', key: 'gross', width: 14 },
    { header: 'Category', key: 'category', width: 20 },
  ];

  const headerRow = detailsSheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };

  for (const record of job.records) {
    detailsSheet.addRow({
      ref: record.referenceId,
      docRef: record.documentRef,
      date: record.documentDate,
      dueDate: record.dueDate,
      seller: record.sellerName,
      sellerTax: record.sellerTaxId,
      sellerCountry: record.sellerCountry,
      purchaser: record.purchaserName,
      purchaserTax: record.purchaserTaxId,
      purchaserCountry: record.purchaserCountry,
      net: record.netTotal,
      duty: record.dutyTotal,
      tax: record.taxTotal,
      gross: record.grossTotal,
      category: record.accountCategory,
    });
  }

  // Summary sheet
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 25 },
    { header: 'Value', key: 'value', width: 20 },
  ];
  const sumHeaderRow = summarySheet.getRow(1);
  sumHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sumHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };

  summarySheet.addRow({ metric: 'Client', value: job.client.clientName });
  summarySheet.addRow({ metric: 'Accounting System', value: job.client.software || 'N/A' });
  summarySheet.addRow({ metric: 'Extracted By', value: job.user.name });
  summarySheet.addRow({ metric: 'Extraction Date', value: job.extractedAt ? new Date(job.extractedAt).toISOString().slice(0, 10) : 'N/A' });
  summarySheet.addRow({ metric: 'Total Documents', value: job.records.length });

  const nets = job.records.map(r => r.netTotal).filter((v): v is number => v !== null);
  const taxes = job.records.map(r => r.taxTotal).filter((v): v is number => v !== null);
  const grosses = job.records.map(r => r.grossTotal).filter((v): v is number => v !== null);

  summarySheet.addRow({ metric: 'Total Net', value: nets.reduce((a, b) => a + b, 0) });
  summarySheet.addRow({ metric: 'Total Tax', value: taxes.reduce((a, b) => a + b, 0) });
  summarySheet.addRow({ metric: 'Total Gross', value: grosses.reduce((a, b) => a + b, 0) });

  // Line Items sheet
  const lineSheet = workbook.addWorksheet('Line Items');
  lineSheet.columns = [
    { header: 'Doc Ref', key: 'ref', width: 10 },
    { header: 'Line #', key: 'line', width: 8 },
    { header: 'Description', key: 'desc', width: 40 },
    { header: 'Quantity', key: 'qty', width: 10 },
    { header: 'Product ID', key: 'productId', width: 15 },
    { header: 'Net', key: 'net', width: 14 },
    { header: 'Tax', key: 'tax', width: 14 },
    { header: 'Duty', key: 'duty', width: 14 },
  ];
  const lineHeaderRow = lineSheet.getRow(1);
  lineHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  lineHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };

  for (const record of job.records) {
    const items = Array.isArray(record.lineItems) ? record.lineItems as { description?: string; quantity?: number; productId?: string; net?: number; tax?: number; duty?: number }[] : [];
    items.forEach((item, i) => {
      lineSheet.addRow({
        ref: record.referenceId,
        line: i + 1,
        desc: item.description || '',
        qty: item.quantity,
        productId: item.productId || '',
        net: item.net,
        tax: item.tax,
        duty: item.duty,
      });
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
