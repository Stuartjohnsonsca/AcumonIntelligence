import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { BlobServiceClient } from '@azure/storage-blob';
import { generateBoardReport } from '@/lib/assurance-review-ai';
import { calculateAssuranceCost, SUB_TOOL_NAMES } from '@/lib/assurance-ai';
import {
  processDocument,
  reviewChunkedDocument,
  processDocumentsParallel,
} from '@/lib/assurance-doc-processor';

function getBlobServiceClient(): BlobServiceClient {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) throw new Error('AZURE_STORAGE_CONNECTION_STRING not configured');
  return BlobServiceClient.fromConnectionString(connectionString);
}

async function downloadBlobAsBuffer(containerName: string, storagePath: string): Promise<Buffer> {
  const blobServiceClient = getBlobServiceClient();
  const containerClient = blobServiceClient.getContainerClient(containerName);
  const blobClient = containerClient.getBlockBlobClient(storagePath);
  const downloadResponse = await blobClient.download(0);
  const body = downloadResponse.readableStreamBody;
  if (!body) throw new Error('No blob content');

  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { engagementId } = await request.json();

    if (!engagementId) {
      return NextResponse.json({ error: 'engagementId is required' }, { status: 400 });
    }

    const engagement = await prisma.assuranceEngagement.findFirst({
      where: { id: engagementId, firmId: session.user.firmId },
      include: { documents: true, client: true },
    });

    if (!engagement) {
      return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
    }

    if (!engagement.termsOfReference) {
      return NextResponse.json({ error: 'Terms of Reference not yet generated' }, { status: 400 });
    }

    const tor = JSON.parse(engagement.termsOfReference);
    const torSummary = (tor.sections || []).map((s: { title: string; content: string }) => `${s.title}: ${s.content}`).join('\n\n');
    const subToolName = SUB_TOOL_NAMES[engagement.subTool] || engagement.subTool;
    const sector = engagement.sector || 'General';

    // Update status
    await prisma.assuranceEngagement.update({
      where: { id: engagementId },
      data: { status: 'review_in_progress' },
    });

    // Review documents with smart processing: OCR, chunking, parallel execution
    const reviewResults: Array<{
      category: string;
      score: number;
      findings: Array<{ area: string; finding: string; severity: 'high' | 'medium' | 'low' }>;
      gaps: string[];
      recommendations: string[];
    }> = [];
    const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    // Split documents into already-reviewed (cached) and pending
    const cachedDocs = engagement.documents.filter(d => d.aiReviewStatus === 'reviewed');
    const pendingDocs = engagement.documents.filter(d => d.aiReviewStatus !== 'reviewed');

    // Add cached results immediately
    for (const doc of cachedDocs) {
      const result = doc.aiReviewResult as Record<string, unknown> | null;
      reviewResults.push({
        category: doc.documentCategory,
        score: doc.aiScore || 50,
        findings: (result?.findings as Array<{ area: string; finding: string; severity: 'high' | 'medium' | 'low' }>) || [],
        gaps: (result?.gaps as string[]) || [],
        recommendations: (result?.recommendations as string[]) || [],
      });
    }

    // Mark all pending as 'reviewing'
    if (pendingDocs.length > 0) {
      await prisma.assuranceDocument.updateMany({
        where: { id: { in: pendingDocs.map(d => d.id) } },
        data: { aiReviewStatus: 'reviewing' },
      });
    }

    // Process pending documents with adaptive concurrency (up to 6 concurrent)
    // Each document: download → extract text (OCR if needed) → chunk → review chunks → merge
    await processDocumentsParallel(pendingDocs, async (doc) => {
      try {
        // 1. Download document from Azure Blob
        const buffer = await downloadBlobAsBuffer(doc.containerName, doc.storagePath);

        // 2. Process: extract text (PDF text / OCR / raw) and chunk if large
        const processed = await processDocument(doc.id, doc.originalName, buffer, doc.mimeType);

        console.log(`[Assurance:Review] "${doc.originalName}": ${processed.totalChars} chars, ${processed.chunks.length} chunks, method=${processed.extractionMethod}`);

        // 3. Review all chunks against ToR (parallel within document if multi-chunk)
        const reviewResult = await reviewChunkedDocument(
          processed,
          doc.documentCategory,
          torSummary,
          subToolName,
          sector,
        );

        // 4. Store review result
        await prisma.assuranceDocument.update({
          where: { id: doc.id },
          data: {
            aiReviewStatus: 'reviewed',
            aiReviewResult: JSON.parse(JSON.stringify({
              satisfiesRequirement: reviewResult.satisfiesRequirement,
              findings: reviewResult.findings,
              gaps: reviewResult.gaps,
              recommendations: reviewResult.recommendations,
              extractionMethod: processed.extractionMethod,
              totalChars: processed.totalChars,
              chunkCount: processed.chunks.length,
            })),
            aiScore: reviewResult.score,
          },
        });

        totalUsage.promptTokens += reviewResult.usage.promptTokens;
        totalUsage.completionTokens += reviewResult.usage.completionTokens;
        totalUsage.totalTokens += reviewResult.usage.totalTokens;

        reviewResults.push({
          category: doc.documentCategory,
          score: reviewResult.score,
          findings: reviewResult.findings,
          gaps: reviewResult.gaps,
          recommendations: reviewResult.recommendations,
        });
      } catch (err) {
        console.error(`[Assurance:Review] Failed to review ${doc.originalName}:`, err);
        await prisma.assuranceDocument.update({
          where: { id: doc.id },
          data: { aiReviewStatus: 'reviewed', aiScore: 0 },
        });
      }
    }, 6); // max 6 concurrent document reviews

    // Get benchmark data
    const benchmarkData = await prisma.assuranceScore.aggregate({
      where: {
        sector,
        subTool: engagement.subTool,
        NOT: { engagementId },
      },
      _avg: { score: true },
      _count: { score: true },
    });

    const benchmark = benchmarkData._count.score >= 3
      ? { averageScore: Math.round(benchmarkData._avg.score || 0), sampleSize: benchmarkData._count.score }
      : undefined;

    // Generate board report
    const reportResult = await generateBoardReport(
      subToolName,
      sector,
      engagement.client.clientName,
      torSummary,
      reviewResults,
      benchmark,
    );

    totalUsage.promptTokens += reportResult.usage.promptTokens;
    totalUsage.completionTokens += reportResult.usage.completionTokens;
    totalUsage.totalTokens += reportResult.usage.totalTokens;

    // Store report and score
    const overallScore = reportResult.overallScore;

    await prisma.assuranceEngagement.update({
      where: { id: engagementId },
      data: {
        reportContent: JSON.stringify({
          executiveSummary: reportResult.executiveSummary,
          recommendations: reportResult.recommendations,
          findings: reportResult.findings,
          nextSteps: reportResult.nextSteps,
          documentReviews: reviewResults,
          benchmark,
        }),
        reportGeneratedAt: new Date(),
        score: overallScore,
        status: 'complete',
      },
    });

    // Store score for benchmarking
    await prisma.assuranceScore.create({
      data: {
        engagementId,
        clientId: engagement.clientId,
        firmId: engagement.firmId,
        subTool: engagement.subTool,
        sector,
        score: overallScore,
        metadata: {
          documentScores: reviewResults.map(r => ({ category: r.category, score: r.score })),
          documentsReviewed: reviewResults.length,
        },
      },
    });

    // Track AI usage
    const cost = calculateAssuranceCost(totalUsage, reportResult.model);
    await prisma.aiUsage.create({
      data: {
        clientId: engagement.clientId,
        userId: session.user.id,
        action: 'Assurance Evidence Review & Report',
        model: reportResult.model,
        operation: 'review_and_report',
        promptTokens: totalUsage.promptTokens,
        completionTokens: totalUsage.completionTokens,
        totalTokens: totalUsage.totalTokens,
        estimatedCostUsd: cost,
      },
    });

    return NextResponse.json({
      executiveSummary: reportResult.executiveSummary,
      recommendations: reportResult.recommendations,
      findings: reportResult.findings,
      nextSteps: reportResult.nextSteps,
      overallScore,
      documentReviews: reviewResults,
      benchmark,
    });
  } catch (err) {
    console.error('[Assurance:ReviewEvidence] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
