import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getBlobAsBase64, moveToProcessing, moveToProcessed, CONTAINERS } from '@/lib/azure-blob';
import { extractDocumentFromBase64, categoriseDescription, calculateCostUsd, type AiTokenUsage } from '@/lib/ai-extractor';

const MAX_CONCURRENT = parseInt(process.env.GEMINI_MAX_CONCURRENT || '3', 10);
const INITIAL_DELAY_MS = 200;
const MIN_DELAY_MS = 100;
const MAX_DELAY_MS = 15000;

let adaptiveDelayMs = INITIAL_DELAY_MS;

async function runWithAdaptiveConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      const delay = adaptiveDelayMs;
      if (delay > 0 && idx > 0) {
        await new Promise(r => setTimeout(r, delay));
      }
      try {
        results[idx] = { status: 'fulfilled', value: await tasks[idx]() };
        adaptiveDelayMs = Math.max(MIN_DELAY_MS, Math.round(adaptiveDelayMs * 0.85));
      } catch (reason) {
        results[idx] = { status: 'rejected', reason };
        const msg = reason instanceof Error ? reason.message : '';
        if (msg.includes('429') || msg.includes('quota') || msg.includes('rate')) {
          adaptiveDelayMs = Math.min(MAX_DELAY_MS, adaptiveDelayMs * 2);
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

interface BatchRequest {
  jobId: string;
  fileIds: string[];
  startIndex: number;
  clientId: string;
  internalSecret: string;
}

export async function POST(req: Request) {
  const body: BatchRequest = await req.json();
  const { jobId, fileIds, startIndex, clientId, internalSecret } = body;

  if (internalSecret !== process.env.NEXTAUTH_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [existingCategories, client] = await Promise.all([
    prisma.accountCategoryLearning.findMany({
      where: { clientId },
      select: { description: true, category: true },
    }),
    prisma.client.findUnique({
      where: { id: clientId },
      select: { clientName: true },
    }),
  ]);

  const clientName = client?.clientName;

  const files = await prisma.extractionFile.findMany({
    where: { id: { in: fileIds } },
  });

  const job = await prisma.extractionJob.findUnique({
    where: { id: jobId },
    select: { userId: true },
  });
  const userId = job?.userId || '';

  async function logAiUsage(usage: AiTokenUsage, operation: string, fileId?: string, action = 'Financial Data Extraction') {
    try {
      await prisma.aiUsage.create({
        data: {
          clientId,
          jobId,
          fileId,
          userId,
          action,
          model: usage.model,
          operation,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          estimatedCostUsd: calculateCostUsd(usage),
        },
      });
    } catch (err) {
      console.error('[AiUsage] Failed to log usage:', err);
    }
  }

  async function processFile(file: typeof files[0], refIndex: number) {
    try {
      await moveToProcessing(file.storagePath);
      await prisma.extractionFile.update({
        where: { id: file.id },
        data: { status: 'processing', containerName: CONTAINERS.PROCESSING },
      });

      const base64 = await getBlobAsBase64(file.storagePath, CONTAINERS.PROCESSING);
      const { document: extracted, usage: extractionUsage } = await extractDocumentFromBase64(
        base64,
        file.mimeType || 'application/pdf',
        file.originalName,
        clientName,
      );

      await logAiUsage(extractionUsage, 'extraction', file.id);

      let accountCategory = extracted.accountCategory;
      if (!accountCategory && extracted.lineItems.length > 0) {
        const desc = extracted.lineItems[0].description;
        const { category, usage: catUsage } = await categoriseDescription(desc, existingCategories);
        accountCategory = category;
        await logAiUsage(catUsage, 'categorisation', file.id);
      }

      const referenceId = file.originalName.replace(/\.[^.]+$/, '');

      await prisma.extractedRecord.create({
        data: {
          jobId,
          fileId: file.id,
          referenceId,
          purchaserName: extracted.purchaserName,
          purchaserTaxId: extracted.purchaserTaxId,
          purchaserCountry: extracted.purchaserCountry,
          sellerName: extracted.sellerName,
          sellerTaxId: extracted.sellerTaxId,
          sellerCountry: extracted.sellerCountry,
          documentRef: extracted.documentRef,
          documentDate: extracted.documentDate,
          dueDate: extracted.dueDate,
          netTotal: extracted.netTotal,
          dutyTotal: extracted.dutyTotal,
          taxTotal: extracted.taxTotal,
          grossTotal: extracted.grossTotal,
          lineItems: extracted.lineItems as object[],
          accountCategory,
          rawExtraction: extracted as object,
          fieldLocations: extracted.fieldLocations as object,
        },
      });

      await prisma.extractionFile.update({
        where: { id: file.id },
        data: { pageCount: extracted.pageCount || 1 },
      });

      if (accountCategory && extracted.lineItems.length > 0) {
        for (const item of extracted.lineItems.slice(0, 3)) {
          if (item.description) {
            await prisma.accountCategoryLearning.upsert({
              where: {
                clientId_description: {
                  clientId,
                  description: item.description.substring(0, 200),
                },
              },
              create: {
                clientId,
                description: item.description.substring(0, 200),
                category: accountCategory,
              },
              update: { category: accountCategory },
            });
          }
        }
      }

      await moveToProcessed(file.storagePath);
      await prisma.extractionFile.update({
        where: { id: file.id },
        data: { status: 'extracted', containerName: CONTAINERS.PROCESSED },
      });

      return { fileId: file.id, status: 'extracted' as const };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await prisma.extractionFile.update({
        where: { id: file.id },
        data: { status: 'failed', errorMessage },
      });
      return { fileId: file.id, status: 'failed' as const, error: errorMessage };
    }
  }

  const tasks = files.map((file, i) => () => processFile(file, startIndex + i));
  const results = await runWithAdaptiveConcurrency(tasks, MAX_CONCURRENT);

  let batchExtracted = 0;
  let batchFailed = 0;

  for (const r of results) {
    const val = r.status === 'fulfilled' ? r.value : { status: 'failed' as const };
    if (val.status === 'extracted') batchExtracted++;
    else batchFailed++;
  }

  await prisma.extractionJob.update({
    where: { id: jobId },
    data: {
      processedCount: { increment: batchExtracted },
      failedCount: { increment: batchFailed },
    },
  });

  const completionCheck = await prisma.extractionJob.findUnique({
    where: { id: jobId },
    select: { totalFiles: true, processedCount: true, failedCount: true },
  });

  if (completionCheck && (completionCheck.processedCount + completionCheck.failedCount) >= completionCheck.totalFiles) {
    await prisma.extractionJob.update({
      where: { id: jobId },
      data: {
        status: completionCheck.processedCount > 0 ? 'complete' : 'failed',
        extractedAt: new Date(),
      },
    });
  }

  return NextResponse.json({
    batchExtracted,
    batchFailed,
    results: results.map(r => r.status === 'fulfilled' ? r.value : { status: 'failed' }),
  });
}
