import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const fsLines = await prisma.methodologyFsLine.findMany({
    where: { firmId: session.user.firmId },
    include: {
      industryMappings: { select: { industryId: true } },
      parent: { select: { id: true, name: true } },
    },
    orderBy: [{ isMandatory: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  });

  return NextResponse.json({ fsLines });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { name, lineType, fsCategory, sortOrder, isMandatory, parentFsLineId } = await req.json();
  if (!name || !lineType || !fsCategory) {
    return NextResponse.json({ error: 'name, lineType, and fsCategory are required' }, { status: 400 });
  }

  const fsLine = await prisma.methodologyFsLine.create({
    data: {
      firmId: session.user.firmId,
      name,
      lineType,
      fsCategory,
      sortOrder: sortOrder || 0,
      isMandatory: isMandatory || false,
      ...(parentFsLineId && { parentFsLineId }),
    },
    include: {
      industryMappings: { select: { industryId: true } },
      parent: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ fsLine });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id, name, lineType, fsCategory, sortOrder, isActive, isMandatory, parentFsLineId } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const fsLine = await prisma.methodologyFsLine.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(lineType !== undefined && { lineType }),
      ...(fsCategory !== undefined && { fsCategory }),
      ...(sortOrder !== undefined && { sortOrder }),
      ...(isActive !== undefined && { isActive }),
      ...(isMandatory !== undefined && { isMandatory }),
      ...(parentFsLineId !== undefined && { parentFsLineId: parentFsLineId || null }),
    },
    include: {
      industryMappings: { select: { industryId: true } },
      parent: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ fsLine });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // Check if mandatory
  const existing = await prisma.methodologyFsLine.findUnique({ where: { id } });
  if (existing?.isMandatory) {
    return NextResponse.json({ error: 'Cannot delete mandatory FS lines' }, { status: 400 });
  }

  await prisma.methodologyFsLine.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
