import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

const GLOBAL_FIRM_ID = '__global__';

/**
 * GET /api/aggregator-connectors
 * List all centrally-managed aggregator connectors (Super Admin scope).
 * All firms can read these; only Super Admin can modify.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const records = await prisma.methodologyTemplate.findMany({
    where: { firmId: GLOBAL_FIRM_ID, templateType: 'aggregator_connector' },
    orderBy: { createdAt: 'asc' },
  });

  const connectors = records.map((r: any) => {
    const items = typeof r.items === 'object' && r.items !== null ? r.items as Record<string, unknown> : {};
    return {
      id: r.id,
      connectorType: r.auditType,
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
 * Add a new aggregator connector (Super Admin only, stored globally).
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden — Super Admin only' }, { status: 403 });
  }

  const { connectorType, label, config } = await req.json();
  if (!connectorType) {
    return NextResponse.json({ error: 'connectorType is required' }, { status: 400 });
  }

  const record = await prisma.methodologyTemplate.create({
    data: {
      firmId: GLOBAL_FIRM_ID,
      templateType: 'aggregator_connector',
      auditType: connectorType,
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
