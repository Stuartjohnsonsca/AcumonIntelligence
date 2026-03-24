import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { downloadBlob } from '@/lib/azure-blob';
import { extractBankStatementFromBase64 } from '@/lib/ai-extractor';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { sessionId } = await req.json();
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }

  const btbSession = await prisma.bankToTBSession.findUnique({
    where: { id: sessionId },
    include: {
      files: { where: { status: 'uploaded' } },
      period: true,
    },
  });

  if (!btbSession || btbSession.userId !== session.user.id) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  if (btbSession.files.length === 0) {
    return NextResponse.json({ error: 'No files to process' }, { status: 400 });
  }

  if (!process.env.TOGETHER_DOC_SUMMARY_KEY && !process.env.TOGETHER_API_KEY) {
    console.error('[BankToTB] No TOGETHER_API_KEY or TOGETHER_DOC_SUMMARY_KEY set');
    await prisma.bankToTBFile.updateMany({
      where: { sessionId, status: 'uploaded' },
      data: { status: 'failed', errorMessage: 'AI extraction service not configured (TOGETHER_API_KEY missing).' },
    });
    return NextResponse.json({ error: 'AI extraction service not configured.' }, { status: 500 });
  }

  const results: { fileId: string; status: string; transactionCount: number; error?: string }[] = [];
  const totalFiles = btbSession.files.length;

  for (let fi = 0; fi < btbSession.files.length; fi++) {
    const file = btbSession.files[fi];
    try {
      await prisma.bankToTBFile.update({
        where: { id: file.id },
        data: { status: 'processing' },
      });

      await prisma.backgroundTask.updateMany({
        where: { userId: session.user.id, type: 'bank-to-tb-parse', status: 'running' },
        data: { progress: { sessionId, fileCount: totalFiles, processed: fi, currentFile: file.originalName, stage: 'downloading' } },
      });

      // Download from Azure Blob
      console.log(`[BankToTB] Downloading ${file.originalName} (${file.storagePath})`);
      const buffer = await downloadBlob(file.storagePath, file.containerName);
      console.log(`[BankToTB] Downloaded ${buffer.length} bytes`);

      await prisma.backgroundTask.updateMany({
        where: { userId: session.user.id, type: 'bank-to-tb-parse', status: 'running' },
        data: { progress: { sessionId, fileCount: totalFiles, processed: fi, currentFile: file.originalName, stage: 'extracting' } },
      });

      // Use the SAME extraction function as Financial Data Extraction tool
      const base64Data = buffer.toString('base64');
      const mimeType = file.mimeType || 'application/pdf';
      const extracted = await extractBankStatementFromBase64(base64Data, mimeType, file.originalName);

      console.log(`[BankToTB] Extracted ${extracted.transactions.length} transactions from ${file.originalName} (model: ${extracted.usage.model})`);

      await prisma.backgroundTask.updateMany({
        where: { userId: session.user.id, type: 'bank-to-tb-parse', status: 'running' },
        data: { progress: { sessionId, fileCount: totalFiles, processed: fi, currentFile: file.originalName, stage: 'saving', transactionCount: extracted.transactions.length } },
      });

      // Save transactions to database
      for (let i = 0; i < extracted.transactions.length; i++) {
        const t = extracted.transactions[i];
        await prisma.bankTransaction.create({
          data: {
            sessionId,
            fileId: file.id,
            date: new Date(t.date || new Date().toISOString()),
            description: t.description,
            reference: t.reference || null,
            debit: t.debit,
            credit: t.credit,
            balance: t.balance || null,
            bankName: extracted.bankName,
            sortCode: extracted.sortCode,
            accountNumber: extracted.accountNumber,
            statementDate: extracted.statementDate,
            statementPage: extracted.statementPage,
            sortOrder: i,
          },
        });
      }

      await prisma.bankToTBFile.update({
        where: { id: file.id },
        data: { status: 'extracted', pageCount: extracted.statementPage },
      });

      results.push({ fileId: file.id, status: 'extracted', transactionCount: extracted.transactions.length });
      console.log(`[BankToTB] Done: ${file.originalName} → ${extracted.transactions.length} txns`);

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[BankToTB] FAILED ${file.originalName}:`, errMsg);
      await prisma.bankToTBFile.update({
        where: { id: file.id },
        data: { status: 'failed', errorMessage: errMsg },
      });
      results.push({ fileId: file.id, status: 'failed', transactionCount: 0, error: errMsg });
    }
  }

  await prisma.backgroundTask.updateMany({
    where: { userId: session.user.id, type: 'bank-to-tb-parse', status: 'running' },
    data: { status: 'completed', result: { results } },
  });

  return NextResponse.json({ success: true, results });
}
