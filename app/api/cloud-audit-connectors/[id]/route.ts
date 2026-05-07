import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import type { CloudConnectorConfig } from '@/lib/import-options/types';

// PATCH /api/cloud-audit-connectors/[id] — update label / config / active flag
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const firmId = session.user.firmId;

  const existing = await prisma.cloudAuditConnector.findUnique({ where: { id } });
  if (!existing || existing.firmId !== firmId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({})) as {
    label?: string;
    config?: CloudConnectorConfig;
    isActive?: boolean;
  };

  const updated = await prisma.cloudAuditConnector.update({
    where: { id },
    data: {
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.config !== undefined ? { config: body.config as unknown as object } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    },
  });

  return NextResponse.json({ connector: updated });
}

// DELETE — soft-delete by setting isActive=false. Built-in connectors
// can be deactivated but not removed (so re-installing the firm doesn't
// resurrect them with stale config).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const firmId = session.user.firmId;

  const existing = await prisma.cloudAuditConnector.findUnique({ where: { id } });
  if (!existing || existing.firmId !== firmId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (existing.isBuiltIn) {
    await prisma.cloudAuditConnector.update({ where: { id }, data: { isActive: false } });
  } else {
    await prisma.cloudAuditConnector.delete({ where: { id } });
  }
  return NextResponse.json({ ok: true });
}
