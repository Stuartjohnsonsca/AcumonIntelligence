import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifySummaryJobAccess } from '@/lib/client-access';
import { downloadBlob } from '@/lib/azure-blob';
import { askDocumentQuestion, calculateDocSummaryCost, type QAConversationMessage } from '@/lib/doc-summary-ai';

export const maxDuration = 60;

/**
 * Document Q&A — answer questions grounded solely in document content.
 * Supports multiple files: downloads each PDF, extracts text, combines, calls AI.
 * Persists the question and answer in DocSummaryQA for each selected file.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const body = await req.json();
  const { jobId, question } = body;
  // Support both single fileId and array of fileIds
  const fileIds: string[] = body.fileIds
    ? (Array.isArray(body.fileIds) ? body.fileIds : [body.fileIds])
    : body.fileId ? [body.fileId] : [];

  if (!jobId || fileIds.length === 0 || !question?.trim()) {
    return NextResponse.json({ error: 'jobId, fileId(s), and question are required' }, { status: 400 });
  }

  const jobAccess = await verifySummaryJobAccess(
    session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
    jobId,
  );
  if (!jobAccess.allowed) {
    return NextResponse.json({ error: jobAccess.reason || 'Forbidden' }, { status: 403 });
  }

  try {
    // 1. Get file metadata for all selected files (including stored extracted text)
    const dbFiles = await prisma.docSummaryFile.findMany({
      where: { id: { in: fileIds } },
      select: { id: true, jobId: true, storagePath: true, containerName: true, originalName: true, extractedText: true, status: true },
    });

    if (dbFiles.length === 0) {
      return NextResponse.json({ error: 'No files found' }, { status: 404 });
    }

    // 2. Get text for each file — prefer stored extractedText, fall back to live extraction
    const { extractText } = await import('unpdf');
    const documentParts: string[] = [];
    const fileNames: string[] = [];
    const pendingFiles: string[] = [];

    for (const file of dbFiles) {
      // First: check if we have stored extracted text (covers both text PDFs and OCR results)
      if (file.extractedText && file.extractedText.length >= 20) {
        documentParts.push(`=== ${file.originalName} ===\n${file.extractedText}`);
        fileNames.push(file.originalName);
        continue;
      }

      // Second: try live extraction from the PDF
      try {
        const pdfBuffer = await downloadBlob(file.storagePath, file.containerName);
        const pdfData = new Uint8Array(pdfBuffer);
        const pdfResult = await extractText(pdfData);
        const textPages = Array.isArray(pdfResult.text) ? pdfResult.text : [String(pdfResult.text || '')];
        const text = textPages.join('\n').trim();

        if (text.length >= 20) {
          documentParts.push(`=== ${file.originalName} ===\n${text}`);
          fileNames.push(file.originalName);
          continue;
        }
      } catch { /* extraction failed — check if still processing */ }

      // Neither stored text nor live extraction worked
      if (file.status === 'uploaded' || file.status === 'processing') {
        pendingFiles.push(file.originalName);
      }
    }

    if (documentParts.length === 0) {
      // No readable text from any file
      const pendingAnswer = pendingFiles.length > 0
        ? `The selected document${pendingFiles.length > 1 ? 's are' : ' is'} still being processed by OCR. Please wait for the analysis to complete — your question will be answerable once processing finishes.`
        : 'Unable to extract readable text from the selected document(s). Please wait for the analysis to complete.';
      const primaryFileId = fileIds[0];
      const lastTurn = await prisma.docSummaryQA.count({ where: { fileId: primaryFileId } });
      const [, assistantMsg] = await prisma.$transaction([
        prisma.docSummaryQA.create({
          data: { jobId, fileId: primaryFileId, role: 'user', content: question.trim(), turnOrder: lastTurn },
        }),
        prisma.docSummaryQA.create({
          data: { jobId, fileId: primaryFileId, role: 'assistant', content: pendingAnswer, turnOrder: lastTurn + 1 },
        }),
      ]);
      return NextResponse.json({ answer: pendingAnswer, messageId: assistantMsg.id });
    }

    const combinedText = documentParts.join('\n\n');
    const combinedName = fileNames.length === 1 ? fileNames[0] : `${fileNames.length} documents (${fileNames.join(', ')})`;

    // 3. Fetch existing conversation history (from the first selected file)
    const primaryFileId = fileIds[0];
    const existingMessages = await prisma.docSummaryQA.findMany({
      where: { fileId: primaryFileId },
      orderBy: { turnOrder: 'asc' },
      select: { role: true, content: true },
    });
    const conversationHistory: QAConversationMessage[] = existingMessages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // 4. Determine next turn order
    const lastTurn = existingMessages.length;

    // 5. Call AI with combined document text + question + history
    const result = await askDocumentQuestion(combinedText, question.trim(), combinedName, conversationHistory);

    // 6. Persist both messages (to the primary file)
    const [, assistantMsg] = await prisma.$transaction([
      prisma.docSummaryQA.create({
        data: { jobId, fileId: primaryFileId, role: 'user', content: question.trim(), turnOrder: lastTurn },
      }),
      prisma.docSummaryQA.create({
        data: { jobId, fileId: primaryFileId, role: 'assistant', content: result.answer, turnOrder: lastTurn + 1 },
      }),
    ]);

    // 7. Log AI usage
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
        fileId: primaryFileId,
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
