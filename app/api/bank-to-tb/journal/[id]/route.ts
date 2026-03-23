import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// PATCH - update a journal
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { id } = await params;
  const { description, lines } = await req.json();

  const journal = await prisma.journal.findUnique({
    where: { id },
    include: { session: true },
  });

  if (!journal || journal.session.userId !== session.user.id) {
    return NextResponse.json({ error: 'Journal not found' }, { status: 404 });
  }

  // Update journal
  await prisma.journal.update({
    where: { id },
    data: {
      description: description !== undefined ? description : journal.description,
    },
  });

  // Replace lines if provided
  if (lines) {
    await prisma.journalLine.deleteMany({ where: { journalId: id } });
    await prisma.journalLine.createMany({
      data: lines.map((line: { accountCode: string; accountName: string; description?: string; debit: number; credit: number }, i: number) => ({
        journalId: id,
        accountCode: line.accountCode,
        accountName: line.accountName,
        description: line.description || '',
        debit: line.debit || 0,
        credit: line.credit || 0,
        sortOrder: i,
      })),
    });
  }

  const updated = await prisma.journal.findUnique({
    where: { id },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  });

  return NextResponse.json({ journal: updated });
}

// DELETE - delete a draft journal
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { id } = await params;

  const journal = await prisma.journal.findUnique({
    where: { id },
    include: { session: true },
  });

  if (!journal || journal.session.userId !== session.user.id) {
    return NextResponse.json({ error: 'Journal not found' }, { status: 404 });
  }

  if (journal.status === 'posted') {
    return NextResponse.json({ error: 'Cannot delete a posted journal' }, { status: 400 });
  }

  await prisma.journal.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
