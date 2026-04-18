import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Filter by kind if the caller asks (e.g. the Documents manager
  // wants kind=document only; the Email manager wants kind=email).
  // Default — no filter — keeps existing callers unaffected.
  const url = new URL(req.url);
  const kindParam = url.searchParams.get('kind');

  const templates = await prisma.documentTemplate.findMany({
    where: {
      firmId: session.user.firmId,
      ...(kindParam ? { kind: kindParam } : {}),
    },
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
  const { name, description, category, auditType, subject, content, mergeFields, recipients, kind, skeletonId, sampleContext } = body;

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
      subject: subject?.trim() || null,
      content: content || '',
      mergeFields: mergeFields || [],
      recipients: recipients || [],
      kind: kind === 'document' ? 'document' : 'email',
      skeletonId: skeletonId || null,
      sampleContext: sampleContext ?? null,
      createdBy: session.user.id,
    },
  });

  return NextResponse.json(template, { status: 201 });
}
