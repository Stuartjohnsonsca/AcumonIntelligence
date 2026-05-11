import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { uploadToContainer } from '@/lib/azure-blob';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import crypto from 'crypto';

/**
 * POST /api/engagements/:id/audit-points/upload-attachment
 *
 * Uploads a single file to Azure Blob and returns a descriptor the
 * caller can append to an AuditPoint's `attachments` JSON array.
 * Does NOT touch the AuditPoint record itself — the caller is
 * expected to send the descriptor back via PATCH ?action=update with
 * `attachments` so the full ownership of the array stays on the
 * client (it knows which point the upload belongs to and what other
 * attachments + links already exist).
 *
 * Body (multipart):
 *   file: File (required)
 *
 * Result: { attachment: { name, url, type, size, storagePath } } —
 * the URL is a signed-by-our-server route at
 * /api/engagements/:id/audit-points/upload-attachment?path=… (read
 * handler below) so attachment links survive blob-container
 * rotations.
 */

const CONTAINER_NAME = 'audit-documents';

export async function POST(req: NextRequest, ctx: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await ctx.params;

  const eng = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, clientId: true },
  });
  if (!eng) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && eng.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Audit-point attachments are used by Review Points (EQR-touchable),
  // so we allow EQR write access here. The route only puts a file in
  // blob storage — actually wiring it to a point goes through the
  // existing PATCH update which has its own EQR scope check.
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session, { allowEQR: true });
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Multipart form data required' }, { status: 400 });
  }
  const file = formData.get('file') as File | null;
  if (!file || typeof (file as any).arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  // Blob path mirrors the documents-upload layout but slots under an
  // 'audit-points' folder so a manual sweep can tell point attachments
  // apart from tab/documents uploads at a glance.
  const attachmentId = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const blobName = `${eng.clientId}/${engagementId}/audit-points/${attachmentId}_${safeName}`;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await uploadToContainer(CONTAINER_NAME, blobName, buffer, file.type || 'application/octet-stream');
  } catch (err: any) {
    return NextResponse.json({ error: `Blob upload failed: ${err?.message || 'unknown'}` }, { status: 500 });
  }

  // The descriptor matches the shape documented in
  // prisma/schema.prisma on AuditPoint.attachments — `{name, url,
  // type, size}` — plus `storagePath` so a future cleanup job can
  // reconcile orphaned blobs with the JSON pointers stored on the
  // point. The URL routes through the GET handler below so the link
  // works across blob-container rotations.
  return NextResponse.json({
    attachment: {
      name: file.name,
      url: `/api/engagements/${engagementId}/audit-points/upload-attachment?path=${encodeURIComponent(blobName)}`,
      type: file.type || 'application/octet-stream',
      size: file.size,
      storagePath: blobName,
    },
  });
}

/**
 * GET /api/engagements/:id/audit-points/upload-attachment?path=<blobName>
 *
 * Streams the blob back to the user with the original content-type.
 * Auth-gated to the engagement's firm so only the audit team can
 * pull attachments down (matches the rest of the engagement APIs).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return new NextResponse('Unauthorized', { status: 401 });
  const { engagementId } = await ctx.params;

  const eng = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, clientId: true },
  });
  if (!eng) return new NextResponse('Not found', { status: 404 });
  if (!session.user.isSuperAdmin && eng.firmId !== session.user.firmId) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const path = new URL(req.url).searchParams.get('path') || '';
  // Defence-in-depth: refuse paths that escape this engagement's
  // folder so a malicious caller can't read blobs from sibling
  // engagements by hand-crafting the URL.
  const expectedPrefix = `${eng.clientId}/${engagementId}/audit-points/`;
  if (!path.startsWith(expectedPrefix)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const { downloadBlob } = await import('@/lib/azure-blob');
  try {
    const buffer = await downloadBlob(path, CONTAINER_NAME);
    // Best-effort content-type from filename — keeps PDFs/images
    // rendering inline. Falls back to octet-stream when unknown.
    const ext = path.split('.').pop()?.toLowerCase() || '';
    const TYPE_BY_EXT: Record<string, string> = {
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      txt: 'text/plain; charset=utf-8',
      csv: 'text/csv; charset=utf-8',
      json: 'application/json',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    // Wrap as Uint8Array so the Next.js fetch Response BodyInit
    // accepts it cleanly — passing a Node Buffer directly trips the
    // newer Buffer<ArrayBufferLike> typing.
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': TYPE_BY_EXT[ext] || 'application/octet-stream',
        'Content-Disposition': 'inline',
      },
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
