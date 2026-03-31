import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * GET /api/aggregator-connectors
 * List all aggregator connectors for the current firm.
 * Stored in MethodologyTemplate with templateType='aggregator_connector'.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const records = await prisma.methodologyTemplate.findMany({
    where: { firmId: session.user.firmId, templateType: 'aggregator_connector' },
    orderBy: { createdAt: 'asc' },
  });

  const connectors = records.map((r: any) => {
    const items = typeof r.items === 'object' && r.items !== null ? r.items as Record<string, unknown> : {};
    return {
      id: r.id,
      connectorType: r.auditType, // re-purpose auditType field for connector type
      label: (items.label as string) || r.auditType,
      config: (items.config as Record<string, string>) || {},
      status: (items.status as string) || 'inactive',
      lastTestedAt: (items.lastTestedAt as string) || null,
      lastTestResult: (items.lastTestResult as string) || null,
      createdAt: r.createdAt?.toISOString(),
      updatedAt: r.updatedAt?.toISOString(),
    };
  });

  return NextResponse.json({ connectors });
}

/**
 * POST /api/aggregator-connectors
 * Add a new aggregator connector.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isFirmAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { connectorType, label, config } = await req.json();
  if (!connectorType) {
    return NextResponse.json({ error: 'connectorType is required' }, { status: 400 });
  }

  const record = await prisma.methodologyTemplate.create({
    data: {
      firmId: session.user.firmId,
      templateType: 'aggregator_connector',
      auditType: connectorType, // store connector type here
      items: { label, config: config || {}, status: 'inactive', lastTestedAt: null, lastTestResult: null },
    },
  });

  return NextResponse.json({
    id: record.id,
    connectorType,
    label,
    config: config || {},
    status: 'inactive',
    lastTestedAt: null,
    lastTestResult: null,
    createdAt: record.createdAt?.toISOString(),
    updatedAt: record.updatedAt?.toISOString(),
  }, { status: 201 });
}
