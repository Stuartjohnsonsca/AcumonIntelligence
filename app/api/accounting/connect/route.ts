import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/accounting/connect
 * Store accounting connector credentials for a client.
 * Uses MethodologyTemplate with templateType='accounting_connection'.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { clientId, system, credentials } = await req.json();
  if (!clientId || !system || !credentials) {
    return NextResponse.json({ error: 'clientId, system, and credentials are required' }, { status: 400 });
  }

  // Verify client belongs to this firm
  const client = await prisma.client.findFirst({
    where: { id: clientId, firmId: session.user.firmId },
  });
  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  try {
    // Load existing connections record
    const existing = await prisma.methodologyTemplate.findFirst({
      where: { firmId: session.user.firmId, templateType: 'accounting_connection', auditType: 'ALL' },
    });

    const connections = (existing?.items as Record<string, unknown>) || {};
    const clientConnections = (connections[clientId] as Record<string, unknown>) || {};
    clientConnections[system] = {
      credentials,
      connectedBy: session.user.name || session.user.email,
      connectedAt: new Date().toISOString(),
      status: 'connected',
    };
    connections[clientId] = clientConnections;

    await prisma.methodologyTemplate.upsert({
      where: {
        firmId_templateType_auditType: {
          firmId: session.user.firmId,
          templateType: 'accounting_connection',
          auditType: 'ALL',
        },
      },
      create: {
        firmId: session.user.firmId,
        templateType: 'accounting_connection',
        auditType: 'ALL',
        items: connections as any,
      },
      update: {
        items: connections as any,
      },
    });

    return NextResponse.json({
      success: true,
      system,
      connectedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Failed to store connection:', err);
    return NextResponse.json({ error: 'Failed to store connection' }, { status: 500 });
  }
}
