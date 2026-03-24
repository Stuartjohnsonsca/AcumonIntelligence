import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getJsonTableSignOffs, handleJsonTableSignOff, handleJsonTableUnsignOff, saveJsonTableFieldMeta } from '@/lib/signoff-handler';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

export async function GET(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(req.url);
  if (url.searchParams.get('meta') === 'signoffs') {
    return getJsonTableSignOffs(prisma.auditMateriality, engagementId);
  }

  const materiality = await prisma.auditMateriality.findUnique({ where: { engagementId } });
  return NextResponse.json({ data: materiality?.data || {} });
}

export async function PUT(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();

  if (body.fieldMeta) {
    await saveJsonTableFieldMeta(prisma.auditMateriality, engagementId, body.fieldMeta);
  }

  await prisma.auditMateriality.upsert({
    where: { engagementId },
    create: { engagementId, data: body.data as object },
    update: { data: body.data as object },
  });
  return NextResponse.json({ success: true });
}

export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  if (body.action === 'signoff') {
    return handleJsonTableSignOff(prisma.auditMateriality, engagementId, {
      engagementId,
      userId: session.user.id!,
      userName: session.user.name || session.user.email || 'Unknown',
      role: body.role,
    });
  }
  if (body.action === 'unsignoff') {
    return handleJsonTableUnsignOff(prisma.auditMateriality, engagementId, session.user.id, body.role);
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
