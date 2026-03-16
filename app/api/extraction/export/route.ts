import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import ExcelJS from 'exceljs';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  const job = await prisma.extractionJob.findUnique({
    where: { id: jobId },
    include: {
      files: true,
      records: { orderBy: { referenceId: 'asc' } },
      client: { select: { clientName: true, software: true, contactName: true } },
      user: { select: { name: true, displayId: true } },
    },
  });

  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Acumon Intelligence';
  workbook.created = new Date();

  // ── Tab 1: Document Details ──────────────────────────────────────────────
  const detailsSheet = workbook.addWorksheet('Document Details');
  detailsSheet.columns = [
    { header: 'Ref ID', key: 'referenceId', width: 10 },
    { header: 'Document Ref', key: 'documentRef', width: 18 },
    { header: 'Date', key: 'documentDate', width: 14 },
    { header: 'Due Date', key: 'dueDate', width: 14 },
    { header: 'Seller Name', key: 'sellerName', width: 25 },
    { header: 'Seller Tax ID', key: 'sellerTaxId', width: 18 },
    { header: 'Seller Country', key: 'sellerCountry', width: 16 },
    { header: 'Purchaser Name', key: 'purchaserName', width: 25 },
    { header: 'Purchaser Tax ID', key: 'purchaserTaxId', width: 18 },
    { header: 'Purchaser Country', key: 'purchaserCountry', width: 16 },
    { header: 'Net Total', key: 'netTotal', width: 14 },
    { header: 'Duty Total', key: 'dutyTotal', width: 14 },
    { header: 'Tax Total', key: 'taxTotal', width: 14 },
    { header: 'Gross Total', key: 'grossTotal', width: 14 },
    { header: 'Account Category', key: 'accountCategory', width: 22 },
    { header: 'File Name', key: 'fileName', width: 30 },
  ];

  // Style header row
  const detailsHeader = detailsSheet.getRow(1);
  detailsHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  detailsHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  detailsHeader.alignment = { vertical: 'middle', horizontal: 'center' };

  for (const record of job.records) {
    const file = job.files.find(f => f.id === record.fileId);
    const row = detailsSheet.addRow({
      referenceId: record.referenceId,
      documentRef: record.documentRef,
      documentDate: record.documentDate,
      dueDate: record.dueDate,
      sellerName: record.sellerName,
      sellerTaxId: record.sellerTaxId,
      sellerCountry: record.sellerCountry,
      purchaserName: record.purchaserName,
      purchaserTaxId: record.purchaserTaxId,
      purchaserCountry: record.purchaserCountry,
      netTotal: record.netTotal,
      dutyTotal: record.dutyTotal,
      taxTotal: record.taxTotal,
      grossTotal: record.grossTotal,
      accountCategory: record.accountCategory,
      fileName: file?.originalName,
    });

    // Highlight matched rows green (all key fields present)
    if (record.grossTotal && record.documentDate && record.sellerName) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4EDDA' } };
    }
  }

  // ── Tab 2: Extraction Details ─────────────────────────────────────────────
  const extractSheet = workbook.addWorksheet('Extraction Details');

  // Metadata section
  const metaRows = [
    ['User Name', job.user.name],
    ['User ID', job.user.displayId],
    ['Date and Time', job.extractedAt?.toISOString() || new Date().toISOString()],
    ['Client Name', job.client.clientName],
    ['Accounting System', job.accountingSystem || job.client.software || 'N/A'],
    ['Accounting System Organisation', job.orgName || 'N/A'],
    [],
    ['Summary', ''],
    ['Total Files Processed', job.files.length],
    ['Successfully Extracted', job.files.filter(f => f.status === 'extracted').length],
    ['Failed', job.files.filter(f => f.status === 'failed').length],
    [],
    ['Extraction Summary', ''],
  ];

  for (const [key, value] of metaRows) {
    const row = extractSheet.addRow([key, value]);
    if (key) {
      row.getCell(1).font = { bold: true };
    }
  }

  // Written summary
  const successCount = job.files.filter(f => f.status === 'extracted').length;
  const summaryText = `This extraction was performed by ${job.user.name} on ${new Date(job.extractedAt || job.createdAt).toLocaleString('en-GB')} for client ${job.client.clientName}. A total of ${job.files.length} document(s) were submitted for processing. Of these, ${successCount} were successfully extracted using the Acumon Intelligence AI extraction engine (powered by Google Gemini). The extraction identified financial data including supplier details, document references, dates, and monetary totals from each document. All extracted data has been stored securely and is available for review and reconciliation. This process was conducted for the purpose of audit and assurance work and the results should be reviewed by a qualified professional before reliance.`;

  const summaryRow = extractSheet.addRow([summaryText]);
  summaryRow.getCell(1).alignment = { wrapText: true };
  extractSheet.getRow(extractSheet.rowCount).height = 120;
  extractSheet.getColumn(1).width = 100;
  extractSheet.getColumn(2).width = 40;

  extractSheet.addRow([]);
  extractSheet.addRow(['File Name', 'Original Name', 'Status', 'Source ZIP', 'File Size', 'Result']);
  const fileHeaderRow = extractSheet.getRow(extractSheet.rowCount);
  fileHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  fileHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };

  for (const file of job.files) {
    const row = extractSheet.addRow([
      file.storagePath,
      file.originalName,
      file.status,
      file.zipSourceName || '-',
      file.fileSize ? `${Math.round(file.fileSize / 1024)}KB` : '-',
      file.status === 'extracted' ? '✓' : '✗',
    ]);
    row.getCell(6).font = {
      color: { argb: file.status === 'extracted' ? 'FF006400' : 'FFCC0000' },
      bold: true,
    };
  }

  // ── Tab 3: Interpreted Summary Totals ─────────────────────────────────────
  const summarySheet = workbook.addWorksheet('Interpreted Summary Totals');

  // Category totals
  const categoryMap: Record<string, { count: number; net: number; tax: number; gross: number }> = {};
  for (const record of job.records) {
    const cat = record.accountCategory || 'Uncategorised';
    if (!categoryMap[cat]) categoryMap[cat] = { count: 0, net: 0, tax: 0, gross: 0 };
    categoryMap[cat].count += 1;
    categoryMap[cat].net += record.netTotal || 0;
    categoryMap[cat].tax += record.taxTotal || 0;
    categoryMap[cat].gross += record.grossTotal || 0;
  }

  summarySheet.addRow(['SUMMARY TOTALS BY ACCOUNT CATEGORY']);
  summarySheet.getRow(1).font = { bold: true, size: 14 };
  summarySheet.addRow([]);
  summarySheet.addRow(['Account Category', 'Documents', 'Net Total', 'Tax Total', 'Gross Total']);
  const summaryHeader = summarySheet.getRow(3);
  summaryHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  summaryHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };

  for (const [cat, totals] of Object.entries(categoryMap)) {
    summarySheet.addRow([cat, totals.count, totals.net.toFixed(2), totals.tax.toFixed(2), totals.gross.toFixed(2)]);
  }

  summarySheet.addRow([]);
  summarySheet.addRow(['DOCUMENT DETAIL BY CATEGORY']);
  summarySheet.getRow(summarySheet.rowCount).font = { bold: true, size: 12 };
  summarySheet.addRow([]);
  summarySheet.addRow(['Ref ID', 'Account Category', 'Description', 'Document Ref', 'Date', 'Seller', 'Net', 'Tax', 'Gross']);
  const detailHeader = summarySheet.getRow(summarySheet.rowCount);
  detailHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  detailHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };

  for (const record of job.records) {
    const lineItems = record.lineItems as { description?: string }[] || [];
    const desc = lineItems.length > 0 ? lineItems[0].description : '';
    summarySheet.addRow([
      record.referenceId,
      record.accountCategory || 'Uncategorised',
      desc,
      record.documentRef,
      record.documentDate,
      record.sellerName,
      record.netTotal,
      record.taxTotal,
      record.grossTotal,
    ]);
  }

  summarySheet.addRow([]);
  summarySheet.addRow(['Context Interpreted by Acumon Intelligence (an AI engine) and subject to the terms and conditions on www.acumonintelligence.com']);
  const disclaimerRow = summarySheet.getRow(summarySheet.rowCount);
  disclaimerRow.font = { italic: true, color: { argb: 'FF666666' } };

  [1, 2, 3, 4, 5].forEach(i => summarySheet.getColumn(i).width = 25);

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="extraction-${jobId.substring(0, 8)}.xlsx"`,
    },
  });
}
