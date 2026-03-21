import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifySummaryJobAccess } from '@/lib/client-access';
import { downloadBlob } from '@/lib/azure-blob';
import { askDocumentQuestion, calculateDocSummaryCost, type QAConversationMessage } from '@/lib/doc-summary-ai';

export const maxDuration = 60;

/**
 * Document Q&A — answer questions grounded solely in document content.
 * Downloads the PDF, extracts text (chunked if large), and calls AI.
 * Persists both the question and answer in DocSummaryQA.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { jobId, fileId, question } = await req.json();
  if (!jobId || !fileId || !question?.trim()) {
    return NextResponse.json({ error: 'jobId, fileId, and question are required' }, { status: 400 });
  }

  const jobAccess = await verifySummaryJobAccess(
    session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
    jobId,
  );
  if (!jobAccess.allowed) {
    return NextResponse.json({ error: jobAccess.reason || 'Forbidden' }, { status: 403 });
  }

  try {
    // 1. Get file metadata
    const file = await prisma.docSummaryFile.findUnique({
      where: { id: fileId },
      select: { id: true, jobId: true, storagePath: true, containerName: true, originalName: true },
    });
    if (!file || file.jobId !== jobId) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // 2. Download PDF from Azure Blob
    const pdfBuffer = await downloadBlob(file.storagePath, file.containerName);

    // 3. Extract text from PDF
    const { extractText } = await import('unpdf');
    const pdfData = new Uint8Array(pdfBuffer);
    const pdfResult = await extractText(pdfData);
    const textPages = Array.isArray(pdfResult.text) ? pdfResult.text : [String(pdfResult.text || '')];
    const fullText = textPages.join('\n').trim();

    if (fullText.length < 20) {
      return NextResponse.json({
        answer: 'Unable to extract readable text from this document. It may be a scanned PDF that requires OCR processing.',
        messageId: null,
      });
    }

    // 4. Fetch existing conversation history for this file
    const existingMessages = await prisma.docSummaryQA.findMany({
      where: { fileId },
      orderBy: { turnOrder: 'asc' },
      select: { role: true, content: true },
    });
    const conversationHistory: QAConversationMessage[] = existingMessages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // 5. Determine next turn order
    const lastTurn = existingMessages.length > 0
      ? existingMessages.length
      : 0;

    // 6. Call AI with document text + question + history
    const result = await askDocumentQuestion(fullText, question.trim(), file.originalName, conversationHistory);

    // 7. Persist both messages
    const [userMsg, assistantMsg] = await prisma.$transaction([
      prisma.docSummaryQA.create({
        data: {
          jobId,
          fileId,
          role: 'user',
          content: question.trim(),
          turnOrder: lastTurn,
        },
      }),
      prisma.docSummaryQA.create({
        data: {
          jobId,
          fileId,
          role: 'assistant',
          content: result.answer,
          turnOrder: lastTurn + 1,
        },
      }),
    ]);

    // 8. Log AI usage
    const job = await prisma.docSummaryJob.findUnique({
      where: { id: jobId },
      select: { clientId: true },
    });

    const costUsd = calculateDocSummaryCost(result.usage, result.model);
    await prisma.aiUsage.create({
      data: {
        userId: session.user.id,
        clientId: job?.clientId || '',
        jobId,
        fileId,
        action: 'Document Summary',
        model: result.model,
        operation: 'document-qa',
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        estimatedCostUsd: costUsd,
      },
    });

    return NextResponse.json({
      answer: result.answer,
      messageId: assistantMsg.id,
      usage: result.usage,
    });
  } catch (error) {
    console.error('[DocSummary:QA] Error:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process question' },
      { status: 500 },
    );
  }
}
