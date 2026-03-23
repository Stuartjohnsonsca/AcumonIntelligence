import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { uploadToInbox } from '@/lib/azure-blob';
import { parseTaxonomyFile, upsertTaxonomyToDb } from '@/lib/taxonomy-parser';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isFirmAdmin = session.user.isFirmAdmin || session.user.isSuperAdmin;
    if (!isFirmAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const firmId = (formData.get('firmId') as string) || session.user.firmId;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = [
      'text/csv', 'application/json', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    const ext = file.name.split('.').pop()?.toLowerCase();
    const isAllowed = allowedTypes.includes(file.type) || ['csv', 'json', 'xlsx'].includes(ext || '');

    if (!isAllowed) {
      return NextResponse.json({ error: 'File must be CSV, JSON, or XLSX' }, { status: 400 });
    }

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Parse the file
    const mimeType = file.type || (ext === 'csv' ? 'text/csv' : ext === 'json' ? 'application/json' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const accounts = await parseTaxonomyFile(buffer, mimeType);

    if (accounts.length === 0) {
      return NextResponse.json({ error: 'No valid accounts found in file' }, { status: 400 });
    }

    // Upload to Azure Blob for record-keeping
    const blobName = `${firmId}/taxonomy_${Date.now()}_${file.name}`;
    const containerName = 'taxonomy-files';

    try {
      await uploadToInbox(blobName, buffer, file.type || 'application/octet-stream');
    } catch {
      console.warn('[Taxonomy:Upload] Azure Blob upload failed — continuing with DB insert');
    }

    // Upsert accounts into database
    const result = await upsertTaxonomyToDb(firmId, accounts);

    // Update firm record
    await prisma.firm.update({
      where: { id: firmId },
      data: {
        taxonomySourceType: 'file',
        chartOfAccountsBlobPath: blobName,
        chartOfAccountsContainer: containerName,
        chartOfAccountsFileName: file.name,
        chartOfAccountsUpdatedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      fileName: file.name,
      ...result,
      totalAccounts: accounts.length,
    });
  } catch (err) {
    console.error('[Taxonomy:Upload]', err);
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Upload failed: ${msg}` }, { status: 500 });
  }
}
