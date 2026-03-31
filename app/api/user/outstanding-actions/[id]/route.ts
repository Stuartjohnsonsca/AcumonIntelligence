import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/user/outstanding-actions/[id]
 * Resolve (complete) a pending action.
 * Body: { selectedData: any } — the user's selection (e.g. chosen Land Registry result)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();

  const record = await prisma.methodologyTemplate.findFirst({
    where: { id, templateType: 'user_action' },
  });

  if (!record) return NextResponse.json({ error: 'Action not found' }, { status: 404 });

  const items = typeof record.items === 'object' && record.items !== null
    ? record.items as Record<string, unknown> : {};

  // Verify ownership
  if ((items.userId as string) !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await prisma.methodologyTemplate.update({
    where: { id },
    data: {
      items: {
        ...items,
        status: 'completed',
        resolvedAt: new Date().toISOString(),
        resolvedBy: session.user.id,
        selectedData: body.selectedData || null,
      },
    },
  });

  return NextResponse.json({ success: true });
}

/**
 * DELETE /api/user/outstanding-actions/[id]
 * Dismiss/cancel a pending action.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const record = await prisma.methodologyTemplate.findFirst({
    where: { id, templateType: 'user_action' },
  });

  if (!record) return NextResponse.json({ error: 'Action not found' }, { status: 404 });

  const items = typeof record.items === 'object' && record.items !== null
    ? record.items as Record<string, unknown> : {};

  if ((items.userId as string) !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await prisma.methodologyTemplate.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
