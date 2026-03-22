import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING || '';
  const accountMatch = connStr.match(/AccountName=([^;]+)/);
  const accountName = accountMatch?.[1] || 'NOT SET';

  const results: Record<string, string> = {
    accountName,
    connStrLength: String(connStr.length),
    connStrPrefix: connStr.slice(0, 50) + '...',
  };

  // Test blob upload
  try {
    const { BlobServiceClient } = await import('@azure/storage-blob');
    const blobService = BlobServiceClient.fromConnectionString(connStr);

    // List containers
    const containers: string[] = [];
    for await (const c of blobService.listContainers()) {
      containers.push(c.name);
    }
    results.containers = containers.join(', ');

    // Test upload to upload-inbox
    const container = blobService.getContainerClient('upload-inbox');
    const testBlob = container.getBlockBlobClient('_debug_test.txt');
    await testBlob.uploadData(Buffer.from('test'), { blobHTTPHeaders: { blobContentType: 'text/plain' } });
    await testBlob.delete();
    results.uploadTest = 'OK';
  } catch (e) {
    results.blobError = e instanceof Error ? e.message : String(e);
  }

  // Test queue
  try {
    const { QueueServiceClient } = await import('@azure/storage-queue');
    const queueService = QueueServiceClient.fromConnectionString(connStr);
    const queues: string[] = [];
    for await (const q of queueService.listQueues()) {
      queues.push(q.name);
    }
    results.queues = queues.join(', ');
  } catch (e) {
    results.queueError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json(results);
}
