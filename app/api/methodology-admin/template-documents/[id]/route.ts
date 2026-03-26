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
  const { name, description, category, auditType, content, mergeFields, isActive } = body;

  const existing = await prisma.documentTemplate.findFirst({
    where: { id, firmId: session.user.firmId },
  });
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

  const template = await prisma.documentTemplate.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description: description?.trim() || null }),
      ...(category !== undefined && { category }),
      ...(auditType !== undefined && { auditType }),
      ...(content !== undefined && { content, version: existing.version + 1 }),
      ...(mergeFields !== undefined && { mergeFields }),
      ...(isActive !== undefined && { isActive }),
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
