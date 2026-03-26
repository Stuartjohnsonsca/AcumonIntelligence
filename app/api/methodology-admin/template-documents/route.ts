import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const templates = await prisma.documentTemplate.findMany({
    where: { firmId: session.user.firmId },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });

  return NextResponse.json(templates);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.isSuperAdmin && !session?.user?.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { name, description, category, auditType, content, mergeFields } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const template = await prisma.documentTemplate.create({
    data: {
      firmId: session.user.firmId,
      name: name.trim(),
      description: description?.trim() || null,
      category: category || 'general',
      auditType: auditType || 'ALL',
      content: content || '',
      mergeFields: mergeFields || [],
      createdBy: session.user.id,
    },
  });

  return NextResponse.json(template, { status: 201 });
}
