import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyClientAccess } from '@/lib/client-access';
import { generateSamplingPlanPdf } from '@/lib/sampling-pdf';
import { utils, write } from 'xlsx';

export const maxDuration = 30;

/**
 * POST /api/sampling/export
 * Export sampling results as PDF (Sampling Plan) or Excel (Sample Schedule).
 *
 * Body: { runId, format: 'pdf' | 'excel' }
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { runId, format } = await req.json();
  if (!runId || !format) {
    return NextResponse.json({ error: 'runId and format required' }, { status: 400 });
  }

  // Fetch run with engagement, audit data, items, population
  const run = await prisma.samplingRun.findUnique({
    where: { id: runId },
    include: {
      engagement: {
        include: {
          client: { select: { clientName: true } },
          period: { select: { startDate: true, endDate: true } },
          auditData: true,
        },
      },
      items: { orderBy: { createdAt: 'asc' } },
      population: { select: { recordCount: true, fileHash: true } },
    },
  });

  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  // Verify access
  const access = await verifyClientAccess(
    session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
    run.engagement.clientId,
  );
  if (!access.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const eng = run.engagement;
  const auditData = eng.auditData;
  const params = run.parameters as Record<string, unknown>;
  const resultSummary = run.resultSummary as Record<string, unknown>;
  const coverageSummary = run.coverageSummary as Record<string, unknown>;

  if (format === 'pdf') {
    const pdfBytes = await generateSamplingPlanPdf({
      clientName: eng.client.clientName,
      periodStart: eng.period.startDate.toISOString(),
      periodEnd: eng.period.endDate.toISOString(),
      auditArea: eng.auditArea || '—',
      testingType: eng.testingType || 'test_of_details',
      preparedBy: session.user.name || '—',
      preparedDate: new Date().toLocaleDateString('en-GB'),
      performanceMateriality: auditData?.performanceMateriality || 0,
      clearlyTrivial: auditData?.clearlyTrivial || 0,
      tolerableMisstatement: auditData?.tolerableMisstatement || 0,
      functionalCurrency: auditData?.functionalCurrency || 'GBP',
      dataType: auditData?.dataType || '—',
      testType: auditData?.testType || '—',
      confidenceLevel: (Number(params.confidence) || 0.95) * 100,
      method: run.method,
      stratification: run.stratification,
      algorithmName: String(resultSummary?.algorithm || run.method),
      planningRationale: String(resultSummary?.planningRationale || params.planningRationale || '—'),
      errorMetric: String(params.errorMetric || 'net_signed'),
      populationSize: Number(coverageSummary?.populationSize) || run.population.recordCount,
      populationTotal: Number(coverageSummary?.populationTotal) || 0,
      sampleSize: run.sampleSize || run.items.length,
      sampleTotal: Number(coverageSummary?.sampleTotal) || 0,
      coverage: Number(coverageSummary?.coveragePct) || 0,
      seed: run.seed || 0,
      populationHash: run.population.fileHash || '—',
      timestamp: run.createdAt.toISOString(),
      toolVersion: run.toolVersion,
      selectedItems: run.items.map(item => ({
        id: item.transactionId,
        bookValue: item.bookValue,
        reason: item.selectedReason || '—',
      })),
      strata: (resultSummary?.strata as { name: string; itemCount: number; sampleSize: number; totalValue: number; topDrivers: { feature: string }[] }[]) || undefined,
    });

    return new Response(Buffer.from(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Sampling_Plan_${eng.client.clientName.replace(/\s+/g, '_')}.pdf"`,
      },
    });
  }

  if (format === 'excel') {
    // Generate Excel workbook with sample schedule
    const wb = utils.book_new();

    // Sheet 1: Sample Schedule
    const scheduleData = run.items.map((item, idx) => ({
      '#': idx + 1,
      'Transaction ID': item.transactionId,
      'Book Value': item.bookValue,
      'Audited Value': '', // Blank for user to fill
      'Test Result': '', // Blank: No exception / Exception / Not testable
      'Exception Amount': '',
      'Exception Type': '',
      'WP Reference': '',
      'Selection Reason': item.selectedReason || '',
    }));

    const ws1 = utils.json_to_sheet(scheduleData);

    // Set column widths
    ws1['!cols'] = [
      { wch: 5 }, { wch: 20 }, { wch: 15 }, { wch: 15 },
      { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 30 },
    ];

    utils.book_append_sheet(wb, ws1, 'Sample Schedule');

    // Sheet 2: Summary
    const summaryData = [
      { Field: 'Client', Value: eng.client.clientName },
      { Field: 'Period', Value: `${eng.period.startDate.toISOString().slice(0, 10)} to ${eng.period.endDate.toISOString().slice(0, 10)}` },
      { Field: 'Audit Area', Value: eng.auditArea || '—' },
      { Field: 'Method', Value: run.method },
      { Field: 'Population Size', Value: Number(coverageSummary?.populationSize) || 0 },
      { Field: 'Sample Size', Value: run.sampleSize || run.items.length },
      { Field: 'Population Total', Value: Number(coverageSummary?.populationTotal) || 0 },
      { Field: 'Sample Total', Value: Number(coverageSummary?.sampleTotal) || 0 },
      { Field: 'Coverage %', Value: Number(coverageSummary?.coveragePct) || 0 },
      { Field: 'Confidence Level', Value: `${(Number(params.confidence) || 0.95) * 100}%` },
      { Field: 'Seed', Value: run.seed || 0 },
      { Field: 'Population Hash', Value: run.population.fileHash || '' },
      { Field: 'Timestamp', Value: run.createdAt.toISOString() },
    ];

    const ws2 = utils.json_to_sheet(summaryData);
    ws2['!cols'] = [{ wch: 20 }, { wch: 50 }];
    utils.book_append_sheet(wb, ws2, 'Summary');

    const excelBuffer = write(wb, { type: 'buffer', bookType: 'xlsx' });

    return new Response(excelBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Sample_Schedule_${eng.client.clientName.replace(/\s+/g, '_')}.xlsx"`,
      },
    });
  }

  return NextResponse.json({ error: 'Invalid format. Use pdf or excel.' }, { status: 400 });
}
