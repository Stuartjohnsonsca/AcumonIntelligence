import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { testConnection } from '@/lib/dynamics-crm';

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isFirmAdmin && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const firm = await prisma.firm.findUnique({
    where: { id: session.user.firmId },
    select: { powerAppsClientId: true, powerAppsClientSecret: true, powerAppsBaseUrl: true, powerAppsTenantId: true, powerAppsClientFilter: true },
  });

  if (!firm) return NextResponse.json({ error: 'Firm not found' }, { status: 404 });

  return NextResponse.json({
    clientId: firm.powerAppsClientId,
    clientSecret: firm.powerAppsClientSecret ? firm.powerAppsClientSecret.substring(0, 5) + '****' : null,
    baseUrl: firm.powerAppsBaseUrl,
    tenantId: firm.powerAppsTenantId,
    clientFilter: firm.powerAppsClientFilter,
  });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isFirmAdmin && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const data: Record<string, any> = {};

  if (body.clientId !== undefined) data.powerAppsClientId = body.clientId || null;
  // Only update secret if it doesn't contain the mask
  if (body.clientSecret !== undefined && !body.clientSecret?.includes('****')) {
    data.powerAppsClientSecret = body.clientSecret || null;
  }
  if (body.baseUrl !== undefined) data.powerAppsBaseUrl = body.baseUrl || null;
  if (body.tenantId !== undefined) data.powerAppsTenantId = body.tenantId || null;
  if (body.clientFilter !== undefined) data.powerAppsClientFilter = body.clientFilter || null;

  await prisma.firm.update({ where: { id: session.user.firmId }, data });
  return NextResponse.json({ success: true });
}

export async function POST() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isFirmAdmin && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const result = await testConnection(session.user.firmId);
  return NextResponse.json(result);
}
