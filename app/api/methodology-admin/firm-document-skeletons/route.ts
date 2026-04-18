import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { uploadToContainer, generateBlobName } from '@/lib/azure-blob';
import { skeletonHasBodyPlaceholder } from '@/lib/template-render';

/**
 * Firm-branded Word document skeletons.
 *
 *   GET  /api/methodology-admin/firm-document-skeletons
 *     → { skeletons: FirmDocumentSkeleton[] } for the signed-in user's firm.
 *
 *   POST multipart: file (required, .docx), name, auditType?,
 *                    description?, isDefault?
 *     → Uploads the .docx to the `firm-skeletons` blob container under
 *       `${firmId}/${timestamp}_${filename}`, verifies it contains the
 *       `{@body}` placeholder, persists a FirmDocumentSkeleton row.
 *       Returns { skeleton } or { error, status } on rejection.
 *
 * Auth: superAdmin || methodologyAdmin.
 */

async function assertAdmin() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return { error: 'Unauthorized', status: 401 as const };
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) return { error: 'Forbidden', status: 403 as const };
  return { session };
}

export async function GET() {
  const gate = await assertAdmin();
  if ('error' in gate) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const firmId = gate.session.user.firmId;
  const skeletons = await prisma.firmDocumentSkeleton.findMany({
    where: { firmId, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
  return NextResponse.json({ skeletons });
}

export async function POST(req: NextRequest) {
  const gate = await assertAdmin();
  if ('error' in gate) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const session = gate.session;
  const firmId = session.user.firmId;

  const form = await req.formData();
  const file = form.get('file');
  const name = String(form.get('name') || '').trim();
  const description = String(form.get('description') || '').trim() || null;
  const auditType = String(form.get('auditType') || 'ALL').trim();
  const isDefault = form.get('isDefault') === 'true';

  if (!(file instanceof File)) return NextResponse.json({ error: 'File is required' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  if (!file.name.toLowerCase().endsWith('.docx')) {
    return NextResponse.json({ error: 'Only .docx skeletons are supported' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // Reject skeletons that don't contain the `{@body}` placeholder —
  // without it the render pipeline has nowhere to inject content and
  // the admin would get a silently-empty document.
  const hasBody = await skeletonHasBodyPlaceholder(buffer);
  if (!hasBody) {
    return NextResponse.json({
      error: 'Skeleton must contain a literal "{@body}" placeholder where the body content should be inserted. Add it to the Word document and re-upload.',
    }, { status: 422 });
  }

  // Store the blob under firmId/<unique>_<original>.docx so uploads
  // from different firms don't collide and removals are easy to audit.
  const blobName = `${firmId}/${generateBlobName('skeleton', file.name)}`;
  try {
    await uploadToContainer('firm-skeletons', blobName, buffer, file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  } catch (err: any) {
    return NextResponse.json({ error: `Blob upload failed: ${err?.message || err}` }, { status: 500 });
  }

  // If this upload is marked as the new default, demote any sibling
  // defaults (same firm + audit type) so there's always at most one.
  if (isDefault) {
    await prisma.firmDocumentSkeleton.updateMany({
      where: { firmId, auditType, isDefault: true },
      data: { isDefault: false },
    });
  }

  const skeleton = await prisma.firmDocumentSkeleton.create({
    data: {
      firmId,
      name,
      description,
      auditType,
      storagePath: blobName,
      containerName: 'firm-skeletons',
      originalFileName: file.name,
      mimeType: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileSize: buffer.length,
      isDefault,
      isActive: true,
      uploadedById: session.user.id,
      uploadedByName: session.user.name || session.user.email || null,
    },
  });
  return NextResponse.json({ skeleton }, { status: 201 });
}
