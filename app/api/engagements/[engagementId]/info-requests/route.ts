import { NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

async function verifyEngagementAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!engagement) return null;
  if (engagement.firmId !== firmId && !isSuperAdmin) return null;
  return engagement;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> }
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { engagementId } = await params;
  const access = await verifyEngagementAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const requests = await prisma.auditInformationRequest.findMany({
    where: { engagementId },
    orderBy: { sortOrder: 'asc' },
  });

  return NextResponse.json({ requests });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> }
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { engagementId } = await params;
  const access = await verifyEngagementAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { requests } = body as { requests: { id?: string; description: string; isIncluded: boolean; sortOrder: number; action?: string | null }[] };

  // Action is a free-form override the auditor can set per-row on the
  // Opening tab. Coerce anything outside the known set to null so we
  // never accept arbitrary strings into the column.
  const VALID = new Set(['request_portal', 'message_client', 'third_party']);
  function safeAction(v: unknown): string | null {
    return typeof v === 'string' && VALID.has(v) ? v : null;
  }

  const existingIds = requests.filter(r => r.id).map(r => r.id!);
  await prisma.auditInformationRequest.deleteMany({
    where: { engagementId, id: { notIn: existingIds } },
  });

  for (const request of requests) {
    if (request.id) {
      await (prisma.auditInformationRequest as any).update({
        where: { id: request.id },
        data: {
          description: request.description,
          isIncluded: request.isIncluded,
          sortOrder: request.sortOrder,
          action: safeAction(request.action),
        },
      });
    } else {
      await (prisma.auditInformationRequest as any).create({
        data: {
          engagementId,
          description: request.description,
          isIncluded: request.isIncluded,
          sortOrder: request.sortOrder,
          action: safeAction(request.action),
        },
      });
    }
  }

  const updated = await prisma.auditInformationRequest.findMany({
    where: { engagementId },
    orderBy: { sortOrder: 'asc' },
  });

  return NextResponse.json({ requests: updated });
}
