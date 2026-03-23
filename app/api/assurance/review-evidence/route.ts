import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { BlobServiceClient } from '@azure/storage-blob';
import { reviewDocumentAgainstToR, generateBoardReport } from '@/lib/assurance-review-ai';
import { calculateAssuranceCost, SUB_TOOL_NAMES } from '@/lib/assurance-ai';

function getBlobServiceClient(): BlobServiceClient {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) throw new Error('AZURE_STORAGE_CONNECTION_STRING not configured');
  return BlobServiceClient.fromConnectionString(connectionString);
}

async function downloadBlobAsText(containerName: string, storagePath: string): Promise<string> {
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
  return Buffer.concat(chunks).toString('utf-8');
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

    // Review documents in PARALLEL for speed (up to 4 concurrent)
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

    // Process pending documents in parallel (batches of 4 to avoid rate limits)
    const BATCH_SIZE = 4;
    for (let i = 0; i < pendingDocs.length; i += BATCH_SIZE) {
      const batch = pendingDocs.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.allSettled(
        batch.map(async (doc) => {
          let documentText: string;
          try {
            documentText = await downloadBlobAsText(doc.containerName, doc.storagePath);
          } catch {
            documentText = `[Unable to extract text from ${doc.originalName}. File type: ${doc.mimeType}]`;
          }

          const reviewResult = await reviewDocumentAgainstToR(
            documentText,
            doc.originalName,
            doc.documentCategory,
            torSummary,
            subToolName,
            sector,
          );

          // Store review result
          await prisma.assuranceDocument.update({
            where: { id: doc.id },
            data: {
              aiReviewStatus: 'reviewed',
              aiReviewResult: JSON.parse(JSON.stringify({
                satisfiesRequirement: reviewResult.satisfiesRequirement,
                findings: reviewResult.findings,
                gaps: reviewResult.gaps,
                recommendations: reviewResult.recommendations,
              })),
              aiScore: reviewResult.score,
            },
          });

          return { doc, reviewResult };
        }),
      );

      // Collect results from this batch
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          const { doc, reviewResult } = result.value;
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
        } else {
          // Failed document — log and mark as reviewed with score 0
          const failedDoc = batch[batchResults.indexOf(result)];
          console.error(`[Assurance:Review] Failed to review ${failedDoc.originalName}:`, result.reason);
          await prisma.assuranceDocument.update({
            where: { id: failedDoc.id },
            data: { aiReviewStatus: 'reviewed', aiScore: 0 },
          });
        }
      }
    }

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
