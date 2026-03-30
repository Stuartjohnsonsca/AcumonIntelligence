import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * GET /api/firm/connectors
 * List enabled accounting connectors for the firm.
 * Stored in MethodologyTemplate with templateType='firm_connectors'.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const record = await prisma.methodologyTemplate.findFirst({
    where: { firmId: session.user.firmId, templateType: 'firm_connectors' },
  });
  const items = (record?.items as Record<string, unknown>) || {};
  const enabledConnectors = (items.enabledConnectors as string[]) || [];

  return NextResponse.json({ enabledConnectors });
}

/**
 * PUT /api/firm/connectors
 * Update the list of enabled accounting connectors.
 */
export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { enabledConnectors } = await req.json();
  if (!Array.isArray(enabledConnectors)) {
    return NextResponse.json({ error: 'enabledConnectors must be an array' }, { status: 400 });
  }

  await prisma.methodologyTemplate.upsert({
    where: {
      firmId_templateType_auditType: {
        firmId: session.user.firmId,
        templateType: 'firm_connectors',
        auditType: 'ALL',
      },
    },
    create: {
      firmId: session.user.firmId,
      templateType: 'firm_connectors',
      auditType: 'ALL',
      items: { enabledConnectors },
    },
    update: {
      items: { enabledConnectors },
    },
  });

  return NextResponse.json({ enabledConnectors });
}

/**
 * POST /api/firm/connectors
 * Test a specific connector to verify it's still connecting.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { system, clientId } = await req.json();

  // Look up connection records stored via /api/accounting/connect
  const connRecord = await prisma.methodologyTemplate.findFirst({
    where: { firmId: session.user.firmId, templateType: 'accounting_connection' },
  });
  const connections = (connRecord?.items as Record<string, unknown>) || {};

  if (clientId) {
    const clientConns = (connections[clientId] as Record<string, unknown>) || {};
    const conn = clientConns[system] as Record<string, unknown> | undefined;
    if (!conn) {
      return NextResponse.json({ connected: false, message: 'No connection found' });
    }
    return NextResponse.json({
      connected: conn.status === 'connected',
      system,
      connectedBy: conn.connectedBy,
      connectedAt: conn.connectedAt,
      message: conn.status === 'connected' ? 'Connection active' : 'Connection inactive',
    });
  }

  // General system check
  const hasConnection = Object.values(connections).some((cc: unknown) => {
    const clientConns = cc as Record<string, unknown>;
    return clientConns[system] !== undefined;
  });

  return NextResponse.json({
    connected: hasConnection,
    system,
    message: hasConnection ? 'System has active connections' : 'No connections configured',
  });
}
