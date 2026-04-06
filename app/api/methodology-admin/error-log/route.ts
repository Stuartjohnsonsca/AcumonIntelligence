import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * GET /api/methodology-admin/error-log
 * Returns errors for the firm with filtering and pagination.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.firmId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const severity = url.searchParams.get('severity') || undefined; // 'error' | 'warning' | 'critical'
  const resolved = url.searchParams.get('resolved'); // 'true' | 'false'
  const engagementId = url.searchParams.get('engagementId') || undefined;
  const tool = url.searchParams.get('tool') || undefined;
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(10, parseInt(url.searchParams.get('limit') || '50')));

  const where: any = {
    firmId: session.user.firmId,
  };
  if (severity) where.severity = severity;
  if (resolved === 'true') where.resolved = true;
  else if (resolved === 'false') where.resolved = false;
  if (engagementId) where.engagementId = engagementId;
  if (tool) where.tool = tool;

  const [errors, total] = await Promise.all([
    prisma.errorLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.errorLog.count({ where }),
  ]);

  return NextResponse.json({
    errors,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}

/**
 * PUT /api/methodology-admin/error-log
 * Mark error(s) as resolved.
 */
export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.firmId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, ids, resolved } = await req.json();
  const targetIds = ids || (id ? [id] : []);
  if (targetIds.length === 0) {
    return NextResponse.json({ error: 'id or ids required' }, { status: 400 });
  }

  await prisma.errorLog.updateMany({
    where: {
      id: { in: targetIds },
      firmId: session.user.firmId,
    },
    data: {
      resolved: resolved !== false,
      resolvedAt: resolved !== false ? new Date() : null,
      resolvedById: resolved !== false ? session.user.id : null,
    },
  });

  return NextResponse.json({ ok: true, count: targetIds.length });
}
