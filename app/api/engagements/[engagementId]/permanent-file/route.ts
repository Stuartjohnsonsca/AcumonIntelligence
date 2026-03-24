import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

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

  const sections = await prisma.auditPermanentFile.findMany({ where: { engagementId }, orderBy: { sectionKey: 'asc' } });
  // Merge into single data object keyed by sectionKey
  const data: Record<string, unknown> = {};
  for (const s of sections) { data[s.sectionKey] = s.data; }
  return NextResponse.json({ data });
}

export async function PUT(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { data } = body as { data: Record<string, unknown> };

  // Upsert each section
  for (const [sectionKey, sectionData] of Object.entries(data)) {
    await prisma.auditPermanentFile.upsert({
      where: { engagementId_sectionKey: { engagementId, sectionKey } },
      create: { engagementId, sectionKey, data: sectionData as object },
      update: { data: sectionData as object },
    });
  }

  return NextResponse.json({ success: true });
}
