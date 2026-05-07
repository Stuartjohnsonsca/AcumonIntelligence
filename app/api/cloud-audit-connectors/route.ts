import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  MY_WORKPAPERS_VENDOR_KEY,
  emptyMyWorkpapersConfig,
  type CloudConnectorConfig,
} from '@/lib/import-options/types';

/** Slugify a vendor label into a stable per-firm vendor key. */
function vendorKeyFromLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || `vendor_${Date.now()}`;
}

/** Ensure the firm has a built-in MyWorkPapers entry. Idempotent. */
async function ensureBuiltIns(firmId: string, userId: string) {
  const exists = await prisma.cloudAuditConnector.findUnique({
    where: { firmId_vendorKey: { firmId, vendorKey: MY_WORKPAPERS_VENDOR_KEY } },
  });
  if (exists) return;
  await prisma.cloudAuditConnector.create({
    data: {
      firmId,
      vendorKey: MY_WORKPAPERS_VENDOR_KEY,
      label: 'MyWorkPapers',
      // Empty stub — admins must complete the recipe before use. We
      // do not invent endpoint paths.
      config: emptyMyWorkpapersConfig() as unknown as object,
      isBuiltIn: true,
      isActive: true,
      createdById: userId,
    },
  });
}

// GET /api/cloud-audit-connectors — list connectors registered for the firm
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const firmId = session.user.firmId;
  if (!firmId) return NextResponse.json({ error: 'No firm' }, { status: 400 });

  await ensureBuiltIns(firmId, session.user.id);

  const rows = await prisma.cloudAuditConnector.findMany({
    where: { firmId, isActive: true },
    orderBy: [{ isBuiltIn: 'desc' }, { label: 'asc' }],
  });

  return NextResponse.json({
    connectors: rows.map(r => ({
      id: r.id,
      firmId: r.firmId,
      vendorKey: r.vendorKey,
      label: r.label,
      config: r.config as unknown as CloudConnectorConfig,
      isBuiltIn: r.isBuiltIn,
      isActive: r.isActive,
    })),
  });
}

// POST /api/cloud-audit-connectors — register a new connector recipe
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const firmId = session.user.firmId;
  if (!firmId) return NextResponse.json({ error: 'No firm' }, { status: 400 });

  const body = await req.json().catch(() => ({})) as {
    label?: string;
    vendorKey?: string;
    config?: CloudConnectorConfig;
  };
  const label = (body.label || '').trim();
  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });
  if (!body.config || !body.config.baseUrl) {
    return NextResponse.json({ error: 'config.baseUrl is required' }, { status: 400 });
  }

  // Determine vendor key — prefer caller-supplied (after slug-validation),
  // fall back to slugified label, ensure uniqueness within the firm.
  let vendorKey = (body.vendorKey || vendorKeyFromLabel(label)).trim();
  if (!/^[a-z0-9_]+$/.test(vendorKey)) vendorKey = vendorKeyFromLabel(label);

  let suffix = 0;
  let candidate = vendorKey;
  while (await prisma.cloudAuditConnector.findUnique({
    where: { firmId_vendorKey: { firmId, vendorKey: candidate } },
  })) {
    suffix += 1;
    candidate = `${vendorKey}_${suffix}`;
    if (suffix > 50) break; // safety
  }

  const created = await prisma.cloudAuditConnector.create({
    data: {
      firmId,
      vendorKey: candidate,
      label,
      config: body.config as unknown as object,
      isBuiltIn: false,
      isActive: true,
      createdById: session.user.id,
    },
  });

  return NextResponse.json({
    connector: {
      id: created.id,
      vendorKey: created.vendorKey,
      label: created.label,
      config: created.config as unknown as CloudConnectorConfig,
      isBuiltIn: created.isBuiltIn,
      isActive: created.isActive,
    },
  }, { status: 201 });
}
