import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { uploadToInbox } from '@/lib/azure-blob';

/**
 * POST /api/engagements/[engagementId]/tax-on-profits/upload
 *
 * Multipart upload — accepts one file at a time, stores it in the
 * client/engagement blob prefix, and creates an AuditDocument row
 * tagged "Tax computation". The panel's next step is to POST to
 * /tax-on-profits/extract with this documentId to run AI parsing.
 */
export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, clientId: true },
  });
  if (!engagement || (engagement.firmId !== session.user.firmId && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  }

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });
  const documentName = (formData.get('documentName') as string) || file.name;
  const documentType = (formData.get('documentType') as string) || 'Tax computation';

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const blobName = `documents/${engagement.clientId}/${engagementId}/${Date.now()}_taxcomp_${safeName}`;
  await uploadToInbox(blobName, buffer, file.type || 'application/octet-stream');

  const doc = await prisma.auditDocument.create({
    data: {
      engagementId,
      documentName,
      storagePath: blobName,
      uploadedDate: new Date(),
      uploadedById: session.user.id,
      fileSize: file.size,
      mimeType: file.type || null,
      receivedByName: session.user.name || session.user.email,
      receivedAt: new Date(),
      usageLocation: 'Tax on Profits',
      documentType,
      source: 'Team',
    },
  });

  return NextResponse.json({
    documentId: doc.id,
    documentName: doc.documentName,
    uploadedByName: session.user.name || session.user.email || 'Unknown',
  });
}
