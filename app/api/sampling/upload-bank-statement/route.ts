import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyClientAccess } from '@/lib/client-access';
import { uploadToInbox, CONTAINERS } from '@/lib/azure-blob';
import { apiAction } from '@/lib/logger';
import { createHash } from 'crypto';

export const maxDuration = 30;

/**
 * POST /api/sampling/upload-bank-statement
 * Upload a bank statement PDF for async parsing by the worker.
 * Returns a populationId that the client polls for results.
 *
 * FormData: file (PDF), engagementId
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const action = apiAction(req, session.user as { id: string; firmId?: string }, '/api/sampling/upload-bank-statement', 'sampling');

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const engagementId = formData.get('engagementId') as string;

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (!engagementId) return NextResponse.json({ error: 'engagementId required' }, { status: 400 });

    action.info('Uploading bank statement', { fileName: file.name, fileSize: file.size, engagementId });

    // Verify engagement exists and user has access
    const engagement = await prisma.samplingEngagement.findUnique({
      where: { id: engagementId },
      select: { clientId: true, periodId: true },
    });
    if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });

    const access = await verifyClientAccess(
      session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
      engagement.clientId,
    );
    if (!access.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Read file and compute hash
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileHash = createHash('sha256').update(buffer).digest('hex');

    // Upload to Azure Blob via the same proven function used by doc-summary
    const containerName = CONTAINERS.INBOX;
    const sanitisedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `sampling/${engagement.clientId}/${engagementId}/${fileHash.slice(0, 8)}_${sanitisedName}`;

    await uploadToInbox(storagePath, buffer, 'application/pdf');

    action.info('File uploaded to blob', { storagePath, fileHash: fileHash.slice(0, 16) });

    // Create SamplingPopulation record with status 'parsing'
    const population = await prisma.samplingPopulation.create({
      data: {
        engagementId,
        description: `Bank statement: ${file.name}`,
        originalFileName: file.name,
        storagePath,
        containerName,
        fileHash,
        recordCount: 0, // Will be updated by worker
        currency: 'GBP', // Will be updated from statement
      },
    });

    // Worker polls DB for populations needing parsing (parsedData = null, storagePath set)
    // No queue needed — avoids Turbopack/Vercel module loading issues with @azure/storage-queue

    await action.success('Bank statement queued for parsing', {
      populationId: population.id,
      fileName: file.name,
    });

    return NextResponse.json({
      populationId: population.id,
      status: 'parsing',
      message: 'Bank statement uploaded. Extracting transactions...',
    });
  } catch (error) {
    await action.error(error, { stage: 'upload_bank_statement' });
    return action.errorResponse(error);
  }
}
