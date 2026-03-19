import { NextResponse, after } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifySummaryJobAccess } from '@/lib/client-access';
import { downloadBlob } from '@/lib/azure-blob';
import { analyseDocumentForAudit, calculateDocSummaryCost } from '@/lib/doc-summary-ai';

export const maxDuration = 300;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { jobId } = await req.json();
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  const jobAccess = await verifySummaryJobAccess(
    session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
    jobId,
  );
  if (!jobAccess.allowed) {
    return NextResponse.json({ error: jobAccess.reason || 'Forbidden' }, { status: 403 });
  }

  const job = await prisma.docSummaryJob.findUnique({
    where: { id: jobId },
    include: {
      files: true,
      client: { select: { clientName: true } },
    },
  });

  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  const filesToProcess = job.files.filter(f => f.status === 'uploaded');
  if (filesToProcess.length === 0) {
    return NextResponse.json({ error: 'No files to analyse' }, { status: 400 });
  }

  // Set job to processing — keep total files count from upload, only reset processing counters
  const totalAllFiles = await prisma.docSummaryFile.count({ where: { jobId } });
  await prisma.docSummaryJob.update({
    where: { id: jobId },
    data: {
      status: 'processing',
      totalFiles: totalAllFiles,
    },
  });

  const clientName = job.client.clientName;
  const userId = session.user.id;
  const clientId = job.clientId;

  // Dispatch async processing via after()
  after(async () => {
    for (const file of filesToProcess) {
      try {
        // 1. Update file status to processing
        await prisma.docSummaryFile.update({
          where: { id: file.id },
          data: { status: 'processing' },
        });

        // 2. Download from Azure Blob
        const pdfBuffer = await downloadBlob(file.storagePath, file.containerName);

        // 3. Extract text using unpdf (Vercel-compatible, no native deps)
        const { extractText, getMeta } = await import('unpdf');
        const pdfData = new Uint8Array(pdfBuffer);
        const pdfResult = await extractText(pdfData);
        // unpdf returns { text: string[] } — one entry per page
        const textPages = Array.isArray(pdfResult.text) ? pdfResult.text : [String(pdfResult.text || '')];
        const text = textPages.join('\n').trim();
        let pageCount = textPages.length || 1;
        try {
          const meta = await getMeta(pdfData);
          pageCount = (meta.info as Record<string, unknown>)?.Pages as number || pageCount;
        } catch { /* non-fatal */ }

        let analysisResult;

        if (text.length < 50) {
          // Scanned/image PDF — send raw PDF as base64 to vision model
          console.log(`[DocSummary:Analyse] Text too short (${text.length} chars), using vision mode | file=${file.originalName}`);
          const base64Pdf = Buffer.from(pdfBuffer).toString('base64');
          const { analyseDocumentFromImage } = await import('@/lib/doc-summary-ai');
          analysisResult = await analyseDocumentFromImage(base64Pdf, file.originalName, clientName, file.mimeType || 'application/pdf');
        } else {
          // 4. Call AI analysis with extracted text
          analysisResult = await analyseDocumentForAudit(text, file.originalName, clientName);
        }

        // 5. Save findings
        for (let i = 0; i < analysisResult.findings.length; i++) {
          const finding = analysisResult.findings[i];
          await prisma.docSummaryFinding.create({
            data: {
              jobId,
              fileId: file.id,
              area: finding.area,
              finding: finding.finding,
              clauseReference: finding.clauseReference,
              isSignificantRisk: finding.isSignificantRisk,
              sortOrder: i,
            },
          });
        }

        // 6. Log AI usage
        const costUsd = calculateDocSummaryCost(analysisResult.usage, analysisResult.model);
        await prisma.aiUsage.create({
          data: {
            clientId,
            jobId,
            fileId: file.id,
            userId,
            action: 'Document Summary',
            model: analysisResult.model,
            operation: 'document-analysis',
            promptTokens: analysisResult.usage.promptTokens,
            completionTokens: analysisResult.usage.completionTokens,
            totalTokens: analysisResult.usage.totalTokens,
            estimatedCostUsd: costUsd,
          },
        });

        // 7. Update file status
        await prisma.docSummaryFile.update({
          where: { id: file.id },
          data: { status: 'analysed', pageCount },
        });

        // 8. Increment processed count
        await prisma.docSummaryJob.update({
          where: { id: jobId },
          data: { processedCount: { increment: 1 } },
        });

        console.log(
          `[DocSummary:Analyse] File complete | jobId=${jobId} | file=${file.originalName} | ` +
          `findings=${analysisResult.findings.length} | model=${analysisResult.model}`,
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[DocSummary:Analyse] File failed | jobId=${jobId} | file=${file.originalName} | error=${errMsg}`);

        await prisma.docSummaryFile.update({
          where: { id: file.id },
          data: { status: 'failed', errorMessage: errMsg },
        });

        await prisma.docSummaryJob.update({
          where: { id: jobId },
          data: { failedCount: { increment: 1 } },
        });
      }
    }

    // After all files: set job to complete
    await prisma.docSummaryJob.update({
      where: { id: jobId },
      data: { status: 'complete' },
    });

    console.log(`[DocSummary:Analyse] Job complete | jobId=${jobId}`);
  });

  return NextResponse.json({
    jobId,
    status: 'processing',
    totalFiles: filesToProcess.length,
  });
}
