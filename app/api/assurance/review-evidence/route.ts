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

    // Review each document
    const reviewResults = [];
    let totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    for (const doc of engagement.documents) {
      if (doc.aiReviewStatus === 'reviewed') {
        // Already reviewed - use cached result
        reviewResults.push({
          category: doc.documentCategory,
          score: doc.aiScore || 50,
          findings: (doc.aiReviewResult as Record<string, unknown>)?.findings as Array<{ area: string; finding: string; severity: 'high' | 'medium' | 'low' }> || [],
          gaps: (doc.aiReviewResult as Record<string, unknown>)?.gaps as string[] || [],
          recommendations: (doc.aiReviewResult as Record<string, unknown>)?.recommendations as string[] || [],
        });
        continue;
      }

      try {
        // Download and extract text
        await prisma.assuranceDocument.update({
          where: { id: doc.id },
          data: { aiReviewStatus: 'reviewing' },
        });

        let documentText: string;
        try {
          documentText = await downloadBlobAsText(doc.containerName, doc.storagePath);
        } catch {
          documentText = `[Unable to extract text from ${doc.originalName}. File type: ${doc.mimeType}]`;
        }

        // Find the relevant ToR section for this document category
        const relevantToR = torSummary; // Use full ToR for context

        const reviewResult = await reviewDocumentAgainstToR(
          documentText,
          doc.originalName,
          doc.documentCategory,
          relevantToR,
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
