import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getBlobAsBase64, moveToProcessing, moveToProcessed, CONTAINERS } from '@/lib/azure-blob';
import { extractDocumentFromBase64, categoriseDescription, generateReferenceId } from '@/lib/gemini-extractor';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { jobId } = await req.json();
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  // Verify job belongs to this user's firm
  const job = await prisma.extractionJob.findUnique({
    where: { id: jobId },
    include: {
      files: true,
      client: { include: { firm: true } },
    },
  });

  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  // Update job status to processing
  await prisma.extractionJob.update({
    where: { id: jobId },
    data: { status: 'processing' },
  });

  // Load existing category learning for this client
  const existingCategories = await prisma.accountCategoryLearning.findMany({
    where: { clientId: job.clientId },
    select: { description: true, category: true },
  });

  const results: {
    fileId: string;
    fileName: string;
    status: 'extracted' | 'failed';
    referenceId?: string;
    error?: string;
  }[] = [];

  let recordIndex = 1;

  for (const file of job.files) {
    try {
      // Move to processing container
      await moveToProcessing(file.storagePath);

      await prisma.extractionFile.update({
        where: { id: file.id },
        data: { status: 'processing', containerName: CONTAINERS.PROCESSING },
      });

      // Download and extract
      const base64 = await getBlobAsBase64(file.storagePath, CONTAINERS.PROCESSING);
      const extracted = await extractDocumentFromBase64(base64, file.mimeType || 'application/pdf', file.originalName);

      // Determine account category with learning
      let accountCategory = extracted.accountCategory;
      if (!accountCategory && extracted.lineItems.length > 0) {
        const desc = extracted.lineItems[0].description;
        accountCategory = await categoriseDescription(desc, existingCategories);
      }

      const referenceId = generateReferenceId(recordIndex++);

      // Save extracted record
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
        },
      });

      // Save category learning
      if (accountCategory && extracted.lineItems.length > 0) {
        for (const item of extracted.lineItems.slice(0, 3)) {
          if (item.description) {
            await prisma.accountCategoryLearning.upsert({
              where: { clientId_description: { clientId: job.clientId, description: item.description.substring(0, 200) } },
              create: { clientId: job.clientId, description: item.description.substring(0, 200), category: accountCategory },
              update: { category: accountCategory },
            });
          }
        }
      }

      // Move to processed
      await moveToProcessed(file.storagePath);
      await prisma.extractionFile.update({
        where: { id: file.id },
        data: { status: 'extracted', containerName: CONTAINERS.PROCESSED },
      });

      results.push({ fileId: file.id, fileName: file.originalName, status: 'extracted', referenceId });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await prisma.extractionFile.update({
        where: { id: file.id },
        data: { status: 'failed', errorMessage },
      });
      results.push({ fileId: file.id, fileName: file.originalName, status: 'failed', error: errorMessage });
    }
  }

  const successCount = results.filter(r => r.status === 'extracted').length;

  await prisma.extractionJob.update({
    where: { id: jobId },
    data: {
      status: successCount > 0 ? 'complete' : 'failed',
      extractedAt: new Date(),
    },
  });

  return NextResponse.json({
    jobId,
    totalFiles: results.length,
    successCount,
    failedCount: results.length - successCount,
    results,
  });
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  const job = await prisma.extractionJob.findUnique({
    where: { id: jobId },
    include: {
      files: true,
      records: { orderBy: { referenceId: 'asc' } },
      client: { select: { clientName: true, software: true } },
      user: { select: { name: true, displayId: true } },
    },
  });

  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(job);
}
