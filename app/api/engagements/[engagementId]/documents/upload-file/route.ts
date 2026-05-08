import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { uploadToContainer } from '@/lib/azure-blob';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { classifyDocumentType } from '@/lib/document-type-classifier';
import crypto from 'crypto';

/**
 * POST /api/engagements/:id/documents/upload-file
 *
 * Multipart upload to the engagement-wide Documents repository — no
 * per-tab allocation. Used by the Tab footer's "Upload zip file to
 * Documents tab" branch when a user picks a .zip and wants to keep it
 * intact rather than expand its contents.
 *
 * Body (multipart):
 *   file: File (required)
 *   source?: string  — free-text origin label, defaults to 'Documents upload'
 *
 * Result: { document } — created AuditDocument with utilisedTab = null
 * so it shows up only on the Documents repository view.
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

  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Multipart form data required' }, { status: 400 });
  }
  const file = formData.get('file') as File | null;
  const source = String(formData.get('source') || 'Documents upload').trim() || 'Documents upload';
  // Optional caller-supplied document type (mirrors the per-tab route).
  const userDocumentType = String(formData.get('documentType') || '').trim() || null;
  if (!file || typeof (file as any).arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  // Mirror the per-tab blob layout but slot under a 'documents' folder
  // instead of a tab folder so a manual sweep through the container
  // can tell repo-uploads from tab-allocated uploads at a glance.
  const docId = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const blobName = `${eng.clientId}/${engagementId}/documents/${docId}_${safeName}`;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await uploadToContainer(CONTAINER_NAME, blobName, buffer, file.type || 'application/octet-stream');
  } catch (err: any) {
    return NextResponse.json({ error: `Blob upload failed: ${err?.message || 'unknown'}` }, { status: 500 });
  }

  // Same AI classifier fallback as the per-tab route. Repo uploads
  // also get the yellow-dashed UI affordance until the user confirms.
  let documentType: string | null = userDocumentType;
  let documentTypeAiSuggested = false;
  if (!userDocumentType) {
    const suggested = await classifyDocumentType({ fileName: file.name, mimeType: file.type });
    if (suggested) {
      documentType = suggested;
      documentTypeAiSuggested = true;
    }
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
      source,
      documentType,
      documentTypeAiSuggested,
      // utilisedTab intentionally null — repository-only.
      receivedByName: session.user.name || session.user.email || null,
      receivedAt: new Date(),
    },
  });

  return NextResponse.json({ document: doc });
}
