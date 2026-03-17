import {
  BlobServiceClient,
  ContainerClient,
  BlobSASPermissions,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential,
  SASProtocol,
} from '@azure/storage-blob';

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

async function awaitCopyCompletion(
  destClient: ReturnType<ContainerClient['getBlockBlobClient']>,
  maxWaitMs = 30000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const props = await destClient.getProperties();
    const status = props.copyStatus;
    if (status === 'success') return;
    if (status === 'failed' || status === 'aborted') {
      throw new Error(`Blob copy ${status}: ${props.copyStatusDescription || 'unknown'}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Blob copy timed out');
}

export async function moveToProcessing(blobName: string): Promise<void> {
  const source = getContainerClient(CONTAINER_INBOX).getBlockBlobClient(blobName);
  const dest = getContainerClient(CONTAINER_PROCESSING).getBlockBlobClient(blobName);
  await dest.beginCopyFromURL(source.url);
  await awaitCopyCompletion(dest);
  await source.delete();
}

export async function moveToProcessed(blobName: string, fromProcessing = true): Promise<void> {
  const sourceContainer = fromProcessing ? CONTAINER_PROCESSING : CONTAINER_INBOX;
  const source = getContainerClient(sourceContainer).getBlockBlobClient(blobName);
  const dest = getContainerClient(CONTAINER_PROCESSED).getBlockBlobClient(blobName);
  await dest.beginCopyFromURL(source.url);
  await awaitCopyCompletion(dest);
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

export function generateSasUrl(
  blobName: string,
  containerName: string,
  expiryMinutes = 15,
): string {
  const match = connectionString.match(/AccountName=([^;]+)/);
  const keyMatch = connectionString.match(/AccountKey=([^;]+)/);
  if (!match || !keyMatch) throw new Error('Cannot parse Azure connection string for SAS generation');

  const accountName = match[1];
  const accountKey = keyMatch[1];
  const credential = new StorageSharedKeyCredential(accountName, accountKey);

  const startsOn = new Date();
  const expiresOn = new Date(startsOn.getTime() + expiryMinutes * 60 * 1000);

  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse('r'),
      startsOn,
      expiresOn,
      protocol: SASProtocol.Https,
    },
    credential,
  ).toString();

  return `https://${accountName}.blob.core.windows.net/${containerName}/${blobName}?${sasToken}`;
}
