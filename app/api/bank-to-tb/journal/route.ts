import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// GET - list journals for a session
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');
  const category = searchParams.get('category');
  const statusFilter = searchParams.get('status');

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }

  const where: Record<string, unknown> = { sessionId };
  if (category) where.category = category;
  if (statusFilter) where.status = statusFilter;

  const journals = await prisma.journal.findMany({
    where,
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ journals });
}

// POST - create a new journal
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { sessionId, category, description, lines } = await req.json();

  if (!sessionId || !category) {
    return NextResponse.json({ error: 'sessionId and category required' }, { status: 400 });
  }

  const btbSession = await prisma.bankToTBSession.findUnique({
    where: { id: sessionId },
  });

  if (!btbSession || btbSession.userId !== session.user.id) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Generate journal reference
  const existingCount = await prisma.journal.count({ where: { sessionId } });
  const journalRef = `JNL-${String(existingCount + 1).padStart(3, '0')}`;

  const journal = await prisma.journal.create({
    data: {
      sessionId,
      category,
      description: description || '',
      journalRef,
      status: 'draft',
      lines: {
        create: (lines || []).map((line: { accountCode: string; accountName: string; description?: string; debit: number; credit: number }, i: number) => ({
          accountCode: line.accountCode,
          accountName: line.accountName,
          description: line.description || '',
          debit: line.debit || 0,
          credit: line.credit || 0,
          sortOrder: i,
        })),
      },
    },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  });

  return NextResponse.json({ journal });
}
