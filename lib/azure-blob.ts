import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING!;
const CONTAINER_INBOX = process.env.AZURE_STORAGE_CONTAINER_INBOX || 'upload-inbox';
const CONTAINER_PROCESSING = process.env.AZURE_STORAGE_CONTAINER_PROCESSING || 'processing';
const CONTAINER_PROCESSED = process.env.AZURE_STORAGE_CONTAINER_PROCESSED || 'processed';

function getBlobServiceClient(): BlobServiceClient {
  return BlobServiceClient.fromConnectionString(connectionString);
}

function getContainerClient(containerName: string): ContainerClient {
  return getBlobServiceClient().getContainerClient(containerName);
}

export async function uploadToInbox(
  blobName: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const containerClient = getContainerClient(CONTAINER_INBOX);
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: mimeType },
  });
  return blobName;
}

export async function moveToProcessing(blobName: string): Promise<void> {
  const source = getContainerClient(CONTAINER_INBOX).getBlockBlobClient(blobName);
  const dest = getContainerClient(CONTAINER_PROCESSING).getBlockBlobClient(blobName);
  const sourceUrl = source.url;
  await dest.beginCopyFromURL(sourceUrl);
  await source.delete();
}

export async function moveToProcessed(blobName: string, fromProcessing = true): Promise<void> {
  const sourceContainer = fromProcessing ? CONTAINER_PROCESSING : CONTAINER_INBOX;
  const source = getContainerClient(sourceContainer).getBlockBlobClient(blobName);
  const dest = getContainerClient(CONTAINER_PROCESSED).getBlockBlobClient(blobName);
  await dest.beginCopyFromURL(source.url);
  await source.delete();
}

export async function downloadBlob(blobName: string, containerName: string): Promise<Buffer> {
  const containerClient = getContainerClient(containerName);
  const blobClient = containerClient.getBlobClient(blobName);
  const downloadResponse = await blobClient.download();
  const chunks: Buffer[] = [];
  for await (const chunk of downloadResponse.readableStreamBody as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function getBlobAsBase64(blobName: string, containerName: string): Promise<string> {
  const buffer = await downloadBlob(blobName, containerName);
  return buffer.toString('base64');
}

export function generateBlobName(jobId: string, fileName: string): string {
  const sanitised = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${jobId}/${Date.now()}_${sanitised}`;
}

export const CONTAINERS = {
  INBOX: CONTAINER_INBOX,
  PROCESSING: CONTAINER_PROCESSING,
  PROCESSED: CONTAINER_PROCESSED,
};
