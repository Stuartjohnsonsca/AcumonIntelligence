import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { testConnection } from '@/lib/dynamics-crm';

/**
 * GET - Get PowerApps settings (client secret masked)
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isFirmAdmin && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const firm = await prisma.firm.findUnique({
    where: { id: session.user.firmId },
    select: {
      powerAppsClientId: true,
      powerAppsClientSecret: true,
      powerAppsBaseUrl: true,
      powerAppsTenantId: true,
    },
  });

  if (!firm) return NextResponse.json({ error: 'Firm not found' }, { status: 404 });

  // Mask the client secret
  const maskedSecret = firm.powerAppsClientSecret
    ? firm.powerAppsClientSecret.substring(0, 5) + '****'
    : null;

  return NextResponse.json({
    clientId: firm.powerAppsClientId,
    clientSecret: maskedSecret,
    baseUrl: firm.powerAppsBaseUrl,
    tenantId: firm.powerAppsTenantId,
  });
}

/**
 * PUT - Update PowerApps settings
 */
export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isFirmAdmin && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const data: Record<string, any> = {};

  if (body.clientId !== undefined) data.powerAppsClientId = body.clientId || null;
  if (body.clientSecret !== undefined && !body.clientSecret?.includes('****')) {
    data.powerAppsClientSecret = body.clientSecret || null;
  }
  if (body.baseUrl !== undefined) data.powerAppsBaseUrl = body.baseUrl || null;
  if (body.tenantId !== undefined) data.powerAppsTenantId = body.tenantId || null;

  await prisma.firm.update({
    where: { id: session.user.firmId },
    data,
  });

  return NextResponse.json({ success: true });
}

/**
 * POST - Test PowerApps connection
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isFirmAdmin && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const firmId = session.user.firmId;
  // Try with the user's Microsoft token if available (OBO flow)
  const msToken = (session as any).msAccessToken || undefined;

  const result = await testConnection(firmId, msToken);
  return NextResponse.json(result);
}
