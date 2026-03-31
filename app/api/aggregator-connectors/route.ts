import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * GET /api/aggregator-connectors
 * List all aggregator connectors for the Super Admin's firm.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const firmId = session.user.firmId;

  // Auto-seed default connectors that use free/public APIs
  const existing = await prisma.methodologyTemplate.findMany({
    where: { firmId, templateType: 'aggregator_connector' },
  });
  const existingTypes = new Set(existing.map((r: any) => r.auditType));

  const DEFAULT_CONNECTORS = [
    {
      auditType: 'hm_land_registry',
      items: {
        label: 'HM Land Registry',
        config: { endpoint: 'https://landregistry.data.gov.uk/landregistry/query' },
        status: 'active',
        lastTestedAt: null,
        lastTestResult: 'Free public API — no credentials required',
      },
    },
    {
      auditType: 'fca_register',
      items: {
        label: 'FCA Register',
        config: { endpoint: 'https://register.fca.org.uk/services/V0.1' },
        status: 'active',
        lastTestedAt: null,
        lastTestResult: 'Free public API — no credentials required',
      },
    },
  ];

  for (const def of DEFAULT_CONNECTORS) {
    if (!existingTypes.has(def.auditType)) {
      try {
        await prisma.methodologyTemplate.create({
          data: { firmId, templateType: 'aggregator_connector', auditType: def.auditType, items: def.items },
        });
      } catch {
        // May already exist via unique constraint
      }
    }
  }

  const records = await prisma.methodologyTemplate.findMany({
    where: { firmId, templateType: 'aggregator_connector' },
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
 * Add a new aggregator connector (Super Admin only).
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

  const firmId = session.user.firmId;

  const record = await prisma.methodologyTemplate.create({
    data: {
      firmId,
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
