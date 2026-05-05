import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { uploadToContainer } from '@/lib/azure-blob';
import crypto from 'crypto';

/**
 * Per-tab document attachments for an engagement.
 *
 *   GET  /api/engagements/:id/tab-documents?tab=ethics
 *     List documents allocated to a tab. The `utilisedTab` column on
 *     AuditDocument is the source of truth — this endpoint just filters
 *     on it. Tab keys mirror the schedule keys used elsewhere (ethics,
 *     materiality, rmm, par, …).
 *
 *   POST /api/engagements/:id/tab-documents
 *     Upload a file directly to the tab. Multipart body with `tab` and
 *     `file` fields. Persists to the `audit-documents` Azure container
 *     and creates an AuditDocument row tagged with utilisedTab=<tab>.
 */
const CONTAINER_NAME = 'audit-documents';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, clientId: true, periodId: true },
  });
  if (!e) return null;
  if (!isSuperAdmin && e.firmId !== firmId) return null;
  return e;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await ctx.params;
  const eng = await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!eng) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const tab = (searchParams.get('tab') || '').trim();
  if (!tab) return NextResponse.json({ error: 'tab is required' }, { status: 400 });

  const docs = await prisma.auditDocument.findMany({
    where: { engagementId, utilisedTab: tab },
    include: {
      uploadedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({
    documents: docs.map(d => ({
      id: d.id,
      documentName: d.documentName,
      fileSize: d.fileSize,
      mimeType: d.mimeType,
      uploadedAt: d.uploadedDate?.toISOString() || d.createdAt.toISOString(),
      uploadedByName: d.uploadedBy?.name || null,
      hasContent: Boolean(d.storagePath),
      // Inline view URL — returns a SAS redirect to the blob.
      viewUrl: d.storagePath
        ? `/api/engagements/${engagementId}/tab-documents/${d.id}/view`
        : null,
    })),
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await ctx.params;
  const eng = await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!eng) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Multipart form data required' }, { status: 400 });
  }
  const tab = String(formData.get('tab') || '').trim();
  const file = formData.get('file') as File | null;
  if (!tab) return NextResponse.json({ error: 'tab is required' }, { status: 400 });
  if (!file || typeof (file as any).arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  // Upload to blob storage. Store under
  // `<clientId>/<engagementId>/<tab>/<docId>_<filename>` so blob names
  // are unique even when two documents share a name.
  const docId = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const blobName = `${eng.clientId}/${engagementId}/${tab}/${docId}_${safeName}`;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await uploadToContainer(CONTAINER_NAME, blobName, buffer, file.type || 'application/octet-stream');
  } catch (err: any) {
    return NextResponse.json({ error: `Blob upload failed: ${err?.message || 'unknown'}` }, { status: 500 });
  }

  const doc = await prisma.auditDocument.create({
    data: {
      id: docId,
      engagementId,
      documentName: file.name,
      storagePath: blobName,
      containerName: CONTAINER_NAME,
      fileSize: file.size,
      mimeType: file.type || null,
      uploadedDate: new Date(),
      uploadedById: session.user.id,
      utilisedTab: tab,
      utilisedOn: new Date(),
      utilisedByName: session.user.name || session.user.email || null,
      receivedByName: session.user.name || session.user.email || null,
      receivedAt: new Date(),
    },
  });

  return NextResponse.json({
    document: {
      id: doc.id,
      documentName: doc.documentName,
      fileSize: doc.fileSize,
      mimeType: doc.mimeType,
      uploadedAt: doc.uploadedDate?.toISOString() || doc.createdAt.toISOString(),
      hasContent: true,
      viewUrl: `/api/engagements/${engagementId}/tab-documents/${doc.id}/view`,
    },
  });
}
