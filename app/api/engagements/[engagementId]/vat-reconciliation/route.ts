import { NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: {
      firmId: true,
      clientId: true,
      client: { select: { clientName: true } },
    },
  });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

export async function GET(_req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;
  const eng = await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!eng) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const row = await prisma.auditVatReconciliation.findUnique({ where: { engagementId } });
  return NextResponse.json({
    data: row?.data || {},
    clientName: eng.client?.clientName || '',
  });
}

/**
 * Shallow-merge PUT.
 *
 * Same merge semantics as the permanent-file handler — callers update
 * their slice of the JSON without trampling keys they don't know
 * about. Pass `{ replace: true }` to overwrite the entire blob.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;
  const eng = await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!eng) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const guard = await assertEngagementWriteAccess(engagementId, session);
  if (guard instanceof NextResponse) return guard;

  const body = await req.json();
  const { data, replace } = body as { data?: Record<string, unknown>; replace?: boolean };
  if (!data || typeof data !== 'object') {
    return NextResponse.json({ error: 'Missing data' }, { status: 400 });
  }

  const existing = await prisma.auditVatReconciliation.findUnique({ where: { engagementId } });
  const existingData = (existing?.data && typeof existing.data === 'object' && !Array.isArray(existing.data))
    ? existing.data as Record<string, unknown>
    : {};
  const merged: Record<string, unknown> = replace ? data : { ...existingData, ...data };

  await prisma.auditVatReconciliation.upsert({
    where: { engagementId },
    create: { engagementId, data: merged as object },
    update: { data: merged as object },
  });

  return NextResponse.json({ success: true, data: merged });
}
