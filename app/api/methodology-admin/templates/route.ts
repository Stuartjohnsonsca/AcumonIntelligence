import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const templateType = searchParams.get('type');
  const auditType = searchParams.get('auditType');

  const where: any = { firmId: session.user.firmId };
  if (templateType) where.templateType = templateType;
  if (auditType) where.auditType = auditType;

  const templates = await prisma.methodologyTemplate.findMany({ where });

  return NextResponse.json({ templates });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { templateType, auditType, items } = await req.json();
  const firmId = session.user.firmId;

  const template = await prisma.methodologyTemplate.upsert({
    where: {
      firmId_templateType_auditType: { firmId, templateType, auditType },
    },
    create: { firmId, templateType, auditType, items },
    update: { items },
  });

  return NextResponse.json({ template });
}
