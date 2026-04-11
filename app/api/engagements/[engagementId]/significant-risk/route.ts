import { NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

function keyFor(rmmRowId: string) {
  return `sigrisk_${rmmRowId}`;
}

// GET — load all significant risk assessment data for an engagement
export async function GET(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Load all sigrisk_* permanent file records for this engagement
  const records = await prisma.auditPermanentFile.findMany({
    where: {
      engagementId,
      sectionKey: { startsWith: 'sigrisk_' },
    },
  });

  const byRmmId: Record<string, { answers: any; signOffs: any }> = {};
  for (const rec of records) {
    const rmmId = rec.sectionKey.replace('sigrisk_', '');
    const data = (rec.data as any) || {};
    byRmmId[rmmId] = {
      answers: data.answers || {},
      signOffs: data.signOffs || {},
    };
  }

  return NextResponse.json({ records: byRmmId });
}

// POST — save answers or sign-off for a specific risk
export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  const body = await req.json();
  const { action, rmmRowId } = body;
  if (!rmmRowId) return NextResponse.json({ error: 'rmmRowId required' }, { status: 400 });

  const sectionKey = keyFor(rmmRowId);

  // Load existing record
  const existing = await prisma.auditPermanentFile.findUnique({
    where: { engagementId_sectionKey: { engagementId, sectionKey } },
  });
  const existingData = (existing?.data as any) || { answers: {}, signOffs: {} };

  if (action === 'save') {
    const { answers } = body;
    const nextData = {
      answers: { ...(existingData.answers || {}), ...(answers || {}) },
      signOffs: existingData.signOffs || {},
    };
    await prisma.auditPermanentFile.upsert({
      where: { engagementId_sectionKey: { engagementId, sectionKey } },
      create: { engagementId, sectionKey, data: nextData },
      update: { data: nextData },
    });
    return NextResponse.json({ success: true });
  }

  if (action === 'signoff' || action === 'unsignoff') {
    const { role } = body;
    if (!role) return NextResponse.json({ error: 'role required' }, { status: 400 });

    const signOffs = { ...(existingData.signOffs || {}) };
    if (action === 'unsignoff') {
      delete signOffs[role];
    } else {
      signOffs[role] = {
        userId: session.user.id,
        userName: session.user.name || session.user.email,
        timestamp: new Date().toISOString(),
      };
    }

    const nextData = {
      answers: existingData.answers || {},
      signOffs,
    };
    await prisma.auditPermanentFile.upsert({
      where: { engagementId_sectionKey: { engagementId, sectionKey } },
      create: { engagementId, sectionKey, data: nextData },
      update: { data: nextData },
    });

    return NextResponse.json({ signOffs });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
