import { QueueClient, QueueServiceClient } from '@azure/storage-queue';

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || '';

// Queue names
export const QUEUES = {
  DOC_SUMMARY_ANALYSIS: 'doc-summary-analysis',
  PDF_GENERATION: 'pdf-generation',
  BANK_STATEMENT_PARSE: 'bank-statement-parse',
} as const;

let queueServiceClient: QueueServiceClient | null = null;
const queueClients = new Map<string, QueueClient>();

function getQueueServiceClient(): QueueServiceClient {
  if (!queueServiceClient) {
    if (!connectionString) {
      throw new Error('AZURE_STORAGE_CONNECTION_STRING is not configured');
    }
    queueServiceClient = QueueServiceClient.fromConnectionString(connectionString);
  }
  return queueServiceClient;
}

async function getQueueClient(queueName: string): Promise<QueueClient> {
  if (!queueClients.has(queueName)) {
    const serviceClient = getQueueServiceClient();
    const client = serviceClient.getQueueClient(queueName);
    // Create queue if it doesn't exist
    await client.createIfNotExists();
    queueClients.set(queueName, client);
  }
  return queueClients.get(queueName)!;
}

// ─── Message types ───────────────────────────────────────────────────────────

export interface DocSummaryMessage {
  type: 'doc-summary-analysis';
  jobId: string;
  fileId: string;
  clientName: string;
  userId: string;
  clientId: string;
  accountingFramework?: string;
  /** The party whose perspective the analysis should be conducted from (defaults to clientName) */
  perspective?: string;
}

export interface PdfGenerationMessage {
  type: 'pdf-generation';
  taskId: string;
  jobId: string;
  format: 'single' | 'portfolio';
  fileId?: string; // for single-document reports
  userId: string;
}

export interface BankStatementParseMessage {
  type: 'bank-statement-parse';
  populationId: string;
  engagementId: string;
  clientId: string;
  userId: string;
  storagePath: string;
  containerName: string;
  fileName: string;
}

export type QueueMessage = DocSummaryMessage | PdfGenerationMessage | BankStatementParseMessage;

// ─── Send ────────────────────────────────────────────────────────────────────

export async function enqueueDocSummaryAnalysis(msg: Omit<DocSummaryMessage, 'type'>): Promise<void> {
  const client = await getQueueClient(QUEUES.DOC_SUMMARY_ANALYSIS);
  const payload: DocSummaryMessage = { type: 'doc-summary-analysis', ...msg };
  // Azure Queue requires base64-encoded messages
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
  await client.sendMessage(encoded);
  console.log(`[Queue] Enqueued doc-summary-analysis | jobId=${msg.jobId} fileId=${msg.fileId}`);
}

export async function enqueueBankStatementParse(msg: Omit<BankStatementParseMessage, 'type'>): Promise<void> {
  const client = await getQueueClient(QUEUES.BANK_STATEMENT_PARSE);
  const payload: BankStatementParseMessage = { type: 'bank-statement-parse', ...msg };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
  await client.sendMessage(encoded);
  console.log(`[Queue] Enqueued bank-statement-parse | populationId=${msg.populationId} file=${msg.fileName}`);
}

export async function enqueuePdfGeneration(msg: Omit<PdfGenerationMessage, 'type'>): Promise<void> {
  const client = await getQueueClient(QUEUES.PDF_GENERATION);
  const payload: PdfGenerationMessage = { type: 'pdf-generation', ...msg };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
  await client.sendMessage(encoded);
  console.log(`[Queue] Enqueued pdf-generation | taskId=${msg.taskId} jobId=${msg.jobId} format=${msg.format}`);
}

// ─── Receive (for worker) ────────────────────────────────────────────────────

export interface ReceivedMessage<T> {
  message: T;
  messageId: string;
  popReceipt: string;
  dequeueCount: number;
}

export async function receiveMessages<T extends QueueMessage>(
  queueName: string,
  maxMessages = 1,
  visibilityTimeoutSeconds = 300, // 5 min — if processing fails, message reappears
): Promise<ReceivedMessage<T>[]> {
  const client = await getQueueClient(queueName);
  const response = await client.receiveMessages({
    numberOfMessages: maxMessages,
    visibilityTimeout: visibilityTimeoutSeconds,
  });

  return response.receivedMessageItems.map(item => {
    const decoded = Buffer.from(item.messageText, 'base64').toString('utf-8');
    return {
      message: JSON.parse(decoded) as T,
      messageId: item.messageId,
      popReceipt: item.popReceipt,
      dequeueCount: item.dequeueCount,
    };
  });
}

export async function deleteMessage(queueName: string, messageId: string, popReceipt: string): Promise<void> {
  const client = await getQueueClient(queueName);
  await client.deleteMessage(messageId, popReceipt);
}

// ─── Dead letter (max retries exceeded) ──────────────────────────────────────

const MAX_DEQUEUE_COUNT = 3;

export function isDeadLetter(dequeueCount: number): boolean {
  return dequeueCount > MAX_DEQUEUE_COUNT;
}
