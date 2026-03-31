import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fireTrigger } from '@/lib/trigger-engine';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

// Sign-offs and field meta are stored in a special section key
const SIGNOFF_KEY = '__signoffs';
const FIELDMETA_KEY = '__fieldmeta';

export async function GET(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(req.url);
  const meta = url.searchParams.get('meta');

  const sections = await prisma.auditPermanentFile.findMany({ where: { engagementId }, orderBy: { sectionKey: 'asc' } });

  if (meta === 'signoffs') {
    const signOffSection = sections.find(s => s.sectionKey === SIGNOFF_KEY);
    const fieldMetaSection = sections.find(s => s.sectionKey === FIELDMETA_KEY);
    return NextResponse.json({
      signOffs: signOffSection?.data || {},
      fieldMeta: fieldMetaSection?.data || {},
    });
  }

  // Merge into single data object keyed by sectionKey (excluding meta keys)
  const data: Record<string, unknown> = {};
  for (const s of sections) {
    if (s.sectionKey !== SIGNOFF_KEY && s.sectionKey !== FIELDMETA_KEY) {
      data[s.sectionKey] = s.data;
    }
  }
  return NextResponse.json({ data });
}

export async function PUT(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { data, fieldMeta } = body as { data: Record<string, unknown>; fieldMeta?: Record<string, unknown> };

  // Save form data - flatten all values into a single section for simplicity
  if (data && typeof data === 'object') {
    await prisma.auditPermanentFile.upsert({
      where: { engagementId_sectionKey: { engagementId, sectionKey: 'all' } },
      create: { engagementId, sectionKey: 'all', data: data as object },
      update: { data: data as object },
    });
  }

  // Save field metadata (edit timestamps)
  if (fieldMeta && typeof fieldMeta === 'object') {
    await prisma.auditPermanentFile.upsert({
      where: { engagementId_sectionKey: { engagementId, sectionKey: FIELDMETA_KEY } },
      create: { engagementId, sectionKey: FIELDMETA_KEY, data: fieldMeta as object },
      update: { data: fieldMeta as object },
    });
  }

  return NextResponse.json({ success: true });
}

// POST for sign-off actions
export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { action, role } = body as { action: string; role: string };

  if (action === 'signoff' && ['operator', 'reviewer', 'partner'].includes(role)) {
    // Server-side enforcement: verify user holds the matching team role
    const roleMap: Record<string, string> = { operator: 'Junior', reviewer: 'Manager', partner: 'RI' };
    const requiredTeamRole = roleMap[role];
    const teamMember = await prisma.auditTeamMember.findFirst({
      where: { engagementId, userId: session.user.id, role: requiredTeamRole },
    });
    if (!teamMember) {
      return NextResponse.json({ error: `You must be assigned as ${role} to sign off` }, { status: 403 });
    }

    // Load existing sign-offs
    const existing = await prisma.auditPermanentFile.findUnique({
      where: { engagementId_sectionKey: { engagementId, sectionKey: SIGNOFF_KEY } },
    });

    const signOffs = (existing?.data || {}) as Record<string, unknown>;
    signOffs[role] = {
      userId: session.user.id,
      userName: session.user.name || session.user.email,
      timestamp: new Date().toISOString(),
    };

    await prisma.auditPermanentFile.upsert({
      where: { engagementId_sectionKey: { engagementId, sectionKey: SIGNOFF_KEY } },
      create: { engagementId, sectionKey: SIGNOFF_KEY, data: signOffs as object },
      update: { data: signOffs as object },
    });

    // Fire "On Section Sign Off" trigger
    const eng = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { clientId: true, auditType: true, firmId: true } });
    if (eng) {
      fireTrigger({
        triggerName: 'On Section Sign Off',
        engagementId,
        clientId: eng.clientId,
        auditType: eng.auditType,
        firmId: eng.firmId,
        userId: session.user.id,
        sectionName: 'Permanent File',
      }).catch(err => console.error('[Trigger] Sign Off failed:', err));
    }

    return NextResponse.json({ signOffs });
  }

  // Unsign-off: remove a sign-off for a role
  if (action === 'unsignoff' && ['operator', 'reviewer', 'partner'].includes(role)) {
    const existing = await prisma.auditPermanentFile.findUnique({
      where: { engagementId_sectionKey: { engagementId, sectionKey: SIGNOFF_KEY } },
    });
    if (existing) {
      const signOffs = (existing.data || {}) as Record<string, unknown>;
      // Only allow removing your own sign-off
      const current = signOffs[role] as { userId?: string } | undefined;
      if (current?.userId === session.user.id) {
        delete signOffs[role];
        await prisma.auditPermanentFile.update({
          where: { id: existing.id },
          data: { data: signOffs as object },
        });
      }
      return NextResponse.json({ signOffs });
    }
    return NextResponse.json({ signOffs: {} });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
