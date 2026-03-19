/**
 * AI document extraction pipeline.
 * Processes uploaded files through Together AI for data extraction.
 */

import { PrismaClient } from '@prisma/client';
import { getBlobAsBase64, moveToProcessing, moveToProcessed, CONTAINERS } from '../../lib/azure-blob';
import {
  extractDocumentFromBase64,
  categoriseDescription,
  calculateCostUsd,
  type AiTokenUsage,
} from '../../lib/ai-extractor';

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '3', 10);
const DELAY_BETWEEN_FILES_MS = 200;

export async function processExtractionBatch(
  prisma: PrismaClient,
  jobId: string,
  fileIds: string[],
  clientId: string,
): Promise<void> {
  const files = await prisma.extractionFile.findMany({
    where: { id: { in: fileIds } },
  });

  const [existingCategories, client, job] = await Promise.all([
    prisma.accountCategoryLearning.findMany({
      where: { clientId },
      select: { description: true, category: true },
    }),
    prisma.client.findUnique({
      where: { id: clientId },
      select: { clientName: true },
    }),
    prisma.extractionJob.findUnique({
      where: { id: jobId },
      select: { userId: true },
    }),
  ]);

  const clientName = client?.clientName;
  const userId = job?.userId || '';

  async function logAiUsage(usage: AiTokenUsage, operation: string, fileId?: string) {
    try {
      await prisma.aiUsage.create({
        data: {
          clientId,
          jobId,
          fileId,
          userId,
          action: 'Financial Data Extraction',
          model: usage.model,
          operation,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          estimatedCostUsd: calculateCostUsd(usage),
        },
      });
    } catch (err) {
      console.error('[AiUsage] Failed to log:', err);
    }
  }

  async function processFile(file: typeof files[0]): Promise<void> {
    const startTime = Date.now();
    const logCtx = `jobId=${jobId} | fileId=${file.id} | file=${file.originalName}`;

    try {
      console.log(`[Extract] Processing | ${logCtx} | size=${file.fileSize || 'unknown'} | mime=${file.mimeType}`);

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

      // Learn categories
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
              create: { clientId, description: item.description.substring(0, 200), category: accountCategory },
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

      await prisma.extractionJob.update({
        where: { id: jobId },
        data: { processedCount: { increment: 1 } },
      });

      const duration = Date.now() - startTime;
      console.log(`[Extract] Success | ${logCtx} | ${duration}ms | confidence=${extracted.confidence} | lines=${extracted.lineItems.length}`);
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Extract] Failed | ${logCtx} | ${duration}ms | ${errorMessage}`);

      await prisma.extractionFile.update({
        where: { id: file.id },
        data: { status: 'failed', errorMessage },
      });
      await prisma.extractionJob.update({
        where: { id: jobId },
        data: { failedCount: { increment: 1 } },
      });
    }
  }

  // Process files with limited concurrency
  console.log(`[Extract] Batch starting | jobId=${jobId} | files=${files.length} | concurrency=${MAX_CONCURRENT}`);

  const queue = [...files];
  const active: Promise<void>[] = [];

  while (queue.length > 0 || active.length > 0) {
    while (active.length < MAX_CONCURRENT && queue.length > 0) {
      const file = queue.shift()!;
      const promise = processFile(file).then(() => {
        active.splice(active.indexOf(promise), 1);
      });
      active.push(promise);
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_FILES_MS));
    }

    if (active.length > 0) {
      await Promise.race(active);
    }
  }

  console.log(`[Extract] Batch complete | jobId=${jobId}`);
}
