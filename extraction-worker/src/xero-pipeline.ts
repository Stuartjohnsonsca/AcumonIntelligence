/**
 * Xero attachment download pipeline — self-contained.
 * No imports from ../../lib/ (those use Next.js path aliases).
 */

import { PrismaClient } from '@prisma/client';
import { BlobServiceClient } from '@azure/storage-blob';
import { createHash } from 'crypto';
import OpenAI from 'openai';

// ─── Azure Blob helpers ─────────────────────────────────────────────────────

const blobService = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING!,
);
const INBOX = process.env.AZURE_STORAGE_CONTAINER_INBOX || 'upload-inbox';
const PROCESSING = process.env.AZURE_STORAGE_CONTAINER_PROCESSING || 'processing';
const PROCESSED = process.env.AZURE_STORAGE_CONTAINER_PROCESSED || 'processed';

async function uploadToBlob(containerName: string, blobName: string, buffer: Buffer, mimeType: string) {
  const container = blobService.getContainerClient(containerName);
  await container.createIfNotExists();
  const blob = container.getBlockBlobClient(blobName);
  await blob.upload(buffer, buffer.length, { blobHTTPHeaders: { blobContentType: mimeType } });
}

async function moveBlobBetweenContainers(blobName: string, from: string, to: string) {
  const srcContainer = blobService.getContainerClient(from);
  const dstContainer = blobService.getContainerClient(to);
  await dstContainer.createIfNotExists();
  const srcBlob = srcContainer.getBlockBlobClient(blobName);
  const dstBlob = dstContainer.getBlockBlobClient(blobName);
  const poller = await dstBlob.beginCopyFromURL(srcBlob.url);
  await poller.pollUntilDone();
  await srcBlob.delete();
}

async function getBlobBase64(blobName: string, containerName: string): Promise<string> {
  const container = blobService.getContainerClient(containerName);
  const blob = container.getBlockBlobClient(blobName);
  const downloaded = await blob.downloadToBuffer();
  return downloaded.toString('base64');
}

// ─── Xero API helpers ───────────────────────────────────────────────────────

async function getValidXeroToken(prisma: PrismaClient, clientId: string) {
  const conn = await prisma.accountingConnection.findUnique({
    where: { clientId_system: { clientId, system: 'xero' } },
  });
  if (!conn) throw new Error('No Xero connection found');

  // Decrypt token (using same logic as lib/xero.ts)
  const crypto = await import('crypto');
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error('TOKEN_ENCRYPTION_KEY not set');
  const keyBuf = Buffer.from(key, 'hex');

  function decrypt(encrypted: string): string {
    const [ivHex, encHex] = encrypted.split(':');
    const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuf, Buffer.from(ivHex, 'hex'));
    let dec = decipher.update(encHex, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  }

  const accessToken = decrypt(conn.accessToken);
  return { accessToken, tenantId: conn.tenantId };
}

async function xeroGet(accessToken: string, tenantId: string, url: string) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Xero-Tenant-Id': tenantId,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Xero API ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

async function xeroDownload(accessToken: string, tenantId: string, url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Xero-Tenant-Id': tenantId,
      Accept: 'application/octet-stream',
    },
  });
  if (!res.ok) throw new Error(`Xero download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ─── AI extraction ──────────────────────────────────────────────────────────

const aiClient = new OpenAI({
  apiKey: process.env.TOGETHER_API_KEY!,
  baseURL: 'https://api.together.xyz/v1',
});

const MODELS = [
  'Qwen/Qwen3-VL-8B-Instruct',
  'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
  'moonshotai/Kimi-K2.5',
  'google/gemma-3n-E4B-it',
  'Qwen/Qwen3.5-397B-A17B',
];

const SUPPORTED_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif']);

function isSupportedFile(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop() || '';
  return SUPPORTED_EXTENSIONS.has(ext);
}

function getMimeType(name: string): string {
  const ext = name.toLowerCase().split('.').pop() || '';
  const map: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
  return map[ext] || 'application/octet-stream';
}

async function extractPdfText(buffer: Buffer): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse');
    const result = await pdfParse(buffer, { max: 10 });
    const text = (result.text || '').trim();
    return text.length > 50 ? text : null;
  } catch {
    return null;
  }
}

const EXTRACTION_PROMPT = `You are a financial document extraction specialist. Extract all available financial data from this document.
Return ONLY valid JSON with this structure (use null for missing fields):
{
  "purchaserName": "string or null",
  "sellerName": "string or null",
  "documentRef": "string or null",
  "documentDate": "YYYY-MM-DD or null",
  "dueDate": "YYYY-MM-DD or null",
  "netTotal": number or null,
  "taxTotal": number or null,
  "grossTotal": number or null,
  "lineItems": [{ "description": "string", "quantity": null, "net": null, "tax": null }],
  "accountCategory": "best-guess category or null",
  "confidence": 0.0 to 1.0,
  "pageCount": number
}`;

async function extractDocument(base64: string, mimeType: string, fileName: string, clientName?: string) {
  // For PDFs, try text extraction first
  let contentParts: Array<{ type: string; [k: string]: unknown }>;
  let mode = 'image';

  if (mimeType === 'application/pdf') {
    const buffer = Buffer.from(base64, 'base64');
    const text = await extractPdfText(buffer);
    if (text) {
      mode = 'pdf-text';
      contentParts = [{ type: 'text', text: `File: ${fileName}\n\nExtracted PDF text:\n${text}\n\n${EXTRACTION_PROMPT}` }];
    } else {
      mode = 'pdf-raw';
      contentParts = [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
        { type: 'text', text: `File: ${fileName}\n\n${EXTRACTION_PROMPT}` },
      ];
    }
  } else {
    contentParts = [
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
      { type: 'text', text: `File: ${fileName}\n\n${EXTRACTION_PROMPT}` },
    ];
  }

  console.log(`[Extract] ${fileName} | mode=${mode}`);

  for (const model of MODELS) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await aiClient.chat.completions.create({
        model,
        messages: [{ role: 'user', content: contentParts as any }],
        max_tokens: 4096,
      });

      const text = result.choices[0]?.message?.content || '';
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
      const parsed = JSON.parse((jsonMatch ? jsonMatch[1] : text).trim());

      console.log(`[Extract] ${fileName} | model=${model} | confidence=${parsed.confidence}`);
      return {
        document: parsed,
        usage: {
          model,
          promptTokens: result.usage?.prompt_tokens || 0,
          completionTokens: result.usage?.completion_tokens || 0,
          totalTokens: result.usage?.total_tokens || 0,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Extract] ${fileName} | model=${model} failed: ${msg}`);
      if (!msg.includes('400') && !msg.includes('404') && !msg.includes('model')) throw err;
    }
  }
  throw new Error(`All models failed for ${fileName}`);
}

// ─── Main pipeline ──────────────────────────────────────────────────────────

interface TransactionRef {
  id: string;
  type: 'Invoice' | 'BankTransaction';
  hasAttachments: boolean;
}

const XERO_API = 'https://api.xero.com/api.xro/2.0';
const DELAY_MS = 600;

export async function processXeroAttachments(
  prisma: PrismaClient,
  task: { id: string; clientId: string | null; result: unknown },
): Promise<void> {
  const meta = task.result as { transactions?: TransactionRef[]; clientId?: string } | null;
  const clientId = task.clientId || meta?.clientId;
  const transactions = meta?.transactions || [];

  if (!clientId || transactions.length === 0) throw new Error('Missing clientId or transactions');

  // Add TOKEN_ENCRYPTION_KEY check
  if (!process.env.TOKEN_ENCRYPTION_KEY) throw new Error('TOKEN_ENCRYPTION_KEY env var required');

  const { accessToken, tenantId } = await getValidXeroToken(prisma, clientId);
  const withAttachments = transactions.filter(t => t.hasAttachments);

  console.log(`[Xero] Starting | clientId=${clientId} | txns=${withAttachments.length}`);

  const updateProgress = (progress: Record<string, unknown>) =>
    prisma.backgroundTask.update({ where: { id: task.id }, data: { progress: progress as never } });

  // Phase 1: List attachments
  await updateProgress({ phase: 'listing', current: 0, total: withAttachments.length });

  const filesToDownload: { txnId: string; endpoint: string; fileName: string }[] = [];
  for (let i = 0; i < withAttachments.length; i++) {
    const txn = withAttachments[i];
    const endpoint = txn.type === 'Invoice' ? 'Invoices' : 'BankTransactions';
    try {
      const data = await xeroGet(accessToken, tenantId, `${XERO_API}/${endpoint}/${txn.id}/Attachments`);
      for (const att of (data.Attachments || [])) {
        if (isSupportedFile(att.FileName)) {
          filesToDownload.push({ txnId: txn.id, endpoint, fileName: att.FileName });
        }
      }
    } catch (err) {
      console.warn(`[Xero] List failed ${txn.id}: ${err instanceof Error ? err.message : err}`);
    }
    if (i % 5 === 0) await updateProgress({ phase: 'listing', current: i + 1, total: withAttachments.length });
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  if (filesToDownload.length === 0) {
    console.log('[Xero] No files to download');
    return;
  }

  // Create job
  const job = await prisma.extractionJob.create({
    data: {
      clientId,
      userId: (await prisma.backgroundTask.findUnique({ where: { id: task.id }, select: { userId: true } }))?.userId || '',
      status: 'processing',
      totalFiles: filesToDownload.length,
      accountingSystem: 'xero',
      expiresAt: new Date(Date.now() + 121 * 24 * 60 * 60 * 1000),
    },
  });

  // Phase 2: Download, upload, extract
  await updateProgress({ phase: 'downloading', current: 0, total: filesToDownload.length, downloaded: 0 });
  const seenHashes = new Map<string, string>();
  let downloaded = 0;

  for (let i = 0; i < filesToDownload.length; i++) {
    const file = filesToDownload[i];
    const mimeType = getMimeType(file.fileName);

    try {
      const buffer = await xeroDownload(
        accessToken, tenantId,
        `${XERO_API}/${file.endpoint}/${file.txnId}/Attachments/${encodeURIComponent(file.fileName)}`,
      );

      const hash = createHash('sha256').update(buffer).digest('hex');
      if (seenHashes.has(hash)) {
        await prisma.extractionFile.create({
          data: { jobId: job.id, originalName: file.fileName, storagePath: '', containerName: '', mimeType, fileSize: buffer.length, status: 'multi-line', fileHash: hash, duplicateOfId: seenHashes.get(hash) },
        });
        continue;
      }

      const blobName = `${clientId}/${job.id}/${Date.now()}_${file.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await uploadToBlob(INBOX, blobName, buffer, mimeType);

      const fileRecord = await prisma.extractionFile.create({
        data: { jobId: job.id, originalName: file.fileName, storagePath: blobName, containerName: INBOX, mimeType, fileSize: buffer.length, status: 'uploaded', fileHash: hash },
      });
      seenHashes.set(hash, fileRecord.id);
      downloaded++;

      // Extract immediately
      try {
        await moveBlobBetweenContainers(blobName, INBOX, PROCESSING);
        await prisma.extractionFile.update({ where: { id: fileRecord.id }, data: { status: 'processing', containerName: PROCESSING } });

        const base64 = await getBlobBase64(blobName, PROCESSING);
        const clientName = (await prisma.client.findUnique({ where: { id: clientId }, select: { clientName: true } }))?.clientName;
        const { document: extracted, usage } = await extractDocument(base64, mimeType, file.fileName, clientName || undefined);

        await prisma.extractedRecord.create({
          data: {
            jobId: job.id, fileId: fileRecord.id,
            referenceId: file.fileName.replace(/\.[^.]+$/, ''),
            purchaserName: extracted.purchaserName ?? null,
            sellerName: extracted.sellerName ?? null,
            documentRef: extracted.documentRef ?? null,
            documentDate: extracted.documentDate ?? null,
            dueDate: extracted.dueDate ?? null,
            netTotal: extracted.netTotal ?? null,
            taxTotal: extracted.taxTotal ?? null,
            grossTotal: extracted.grossTotal ?? null,
            lineItems: Array.isArray(extracted.lineItems) ? extracted.lineItems : [],
            accountCategory: extracted.accountCategory ?? null,
            rawExtraction: extracted,
            fieldLocations: extracted.fieldLocations ?? {},
          },
        });

        await prisma.aiUsage.create({
          data: { clientId, jobId: job.id, fileId: fileRecord.id, userId: job.userId, action: 'Financial Data Extraction', model: usage.model, operation: 'extraction', promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens, estimatedCostUsd: 0 },
        });

        await moveBlobBetweenContainers(blobName, PROCESSING, PROCESSED);
        await prisma.extractionFile.update({ where: { id: fileRecord.id }, data: { status: 'extracted', containerName: PROCESSED, pageCount: extracted.pageCount || 1 } });
        await prisma.extractionJob.update({ where: { id: job.id }, data: { processedCount: { increment: 1 } } });
      } catch (extractErr) {
        const errMsg = extractErr instanceof Error ? extractErr.message : String(extractErr);
        console.error(`[Extract] Failed ${file.fileName}: ${errMsg}`);
        await prisma.extractionFile.update({ where: { id: fileRecord.id }, data: { status: 'failed', errorMessage: errMsg } });
        await prisma.extractionJob.update({ where: { id: job.id }, data: { failedCount: { increment: 1 } } });
      }
    } catch (dlErr) {
      console.error(`[Xero] Download failed ${file.fileName}: ${dlErr instanceof Error ? dlErr.message : dlErr}`);
    }

    await updateProgress({ phase: 'downloading', current: i + 1, total: filesToDownload.length, downloaded });
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  // Finalize
  const finalJob = await prisma.extractionJob.findUnique({ where: { id: job.id }, select: { processedCount: true, failedCount: true } });
  await prisma.extractionJob.update({
    where: { id: job.id },
    data: { status: (finalJob?.processedCount || 0) > 0 ? 'complete' : 'failed', extractedAt: new Date() },
  });

  const noDocsTxnIds = transactions.filter(t => !t.hasAttachments).map(t => t.id);
  await prisma.backgroundTask.update({
    where: { id: task.id },
    data: { result: { jobId: job.id, noDocsTxnIds, downloaded } as never },
  });

  console.log(`[Xero] Complete | jobId=${job.id} | downloaded=${downloaded}/${filesToDownload.length}`);
}
