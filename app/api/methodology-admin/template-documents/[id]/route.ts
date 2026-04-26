import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const template = await prisma.documentTemplate.findFirst({
    where: { id, firmId: session.user.firmId },
  });

  if (!template) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(template);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.isSuperAdmin && !session?.user?.isMethodologyAdmin) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { name, description, category, auditType, subject, content, mergeFields, recipients, isActive, kind, skeletonId, sampleContext, sendPermission, sendSignOffSection } = body;

  const existing = await prisma.documentTemplate.findFirst({
    where: { id, firmId: session.user.firmId },
  });
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

  // Whitelist of allowed sendPermission values — anything else falls
  // back to 'None' (no gating) so a typo can't accidentally lock every
  // engagement out of the document.
  const VALID_PERMS = ['None', 'Preparer', 'Reviewer', 'RI'] as const;
  const cleanedPerm = typeof sendPermission === 'string' && (VALID_PERMS as readonly string[]).includes(sendPermission)
    ? sendPermission
    : undefined;

  // sendSignOffSection: a sectionKey suffix (e.g. 'rmm', 'materiality').
  // Empty string normalises to null = engagement-level. Restrict to a
  // simple alphanumeric/dash/underscore pattern so a typo can't try to
  // escape the sectionKey shape.
  let cleanedSection: string | null | undefined = undefined;
  if (sendSignOffSection !== undefined) {
    if (typeof sendSignOffSection !== 'string' || sendSignOffSection.trim() === '') {
      cleanedSection = null;
    } else if (/^[a-z][a-z0-9_-]*$/i.test(sendSignOffSection.trim())) {
      cleanedSection = sendSignOffSection.trim();
    } else {
      cleanedSection = undefined; // ignore garbage rather than 400
    }
  }

  const template = await prisma.documentTemplate.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description: description?.trim() || null }),
      ...(category !== undefined && { category }),
      ...(auditType !== undefined && { auditType }),
      ...(subject !== undefined && { subject: subject?.trim() || null }),
      ...(content !== undefined && { content, version: existing.version + 1 }),
      ...(mergeFields !== undefined && { mergeFields }),
      ...(recipients !== undefined && { recipients }),
      ...(isActive !== undefined && { isActive }),
      ...(kind !== undefined && { kind: kind === 'document' ? 'document' : 'email' }),
      ...(skeletonId !== undefined && { skeletonId: skeletonId || null }),
      ...(sampleContext !== undefined && { sampleContext }),
      ...(cleanedPerm !== undefined && { sendPermission: cleanedPerm }),
      ...(cleanedSection !== undefined && { sendSignOffSection: cleanedSection }),
    },
  });

  return Response.json(template);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.isSuperAdmin && !session?.user?.isMethodologyAdmin) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.documentTemplate.findFirst({
    where: { id, firmId: session.user.firmId },
  });
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

  await prisma.documentTemplate.delete({ where: { id } });
  return Response.json({ success: true });
}
