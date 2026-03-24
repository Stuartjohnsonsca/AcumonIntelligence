import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getPermanentFileSignOffs, handlePermanentFileSignOff, handlePermanentFileUnsignOff, savePermanentFileFieldMeta } from '@/lib/signoff-handler';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

export async function GET(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(req.url);
  if (url.searchParams.get('meta') === 'signoffs') {
    return getPermanentFileSignOffs(engagementId, 'trial-balance');
  }

  const rows = await prisma.auditTBRow.findMany({ where: { engagementId }, orderBy: { sortOrder: 'asc' } });
  return NextResponse.json({ rows });
}

export async function PUT(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { rows } = body as { rows: { id?: string; accountCode: string; description: string; category?: string; currentYear?: number; priorYear?: number; fsNoteLevel?: string; fsLevel?: string; fsStatement?: string; groupName?: string; sortOrder: number }[] };

  const existingIds = rows.filter(r => r.id).map(r => r.id!);
  await prisma.auditTBRow.deleteMany({ where: { engagementId, id: { notIn: existingIds } } });

  for (const row of rows) {
    if (row.id) {
      await prisma.auditTBRow.update({
        where: { id: row.id },
        data: {
          accountCode: row.accountCode, description: row.description, category: row.category,
          currentYear: row.currentYear ?? null, priorYear: row.priorYear ?? null,
          fsNoteLevel: row.fsNoteLevel, fsLevel: row.fsLevel, fsStatement: row.fsStatement,
          groupName: row.groupName, sortOrder: row.sortOrder,
        },
      });
    } else {
      await prisma.auditTBRow.create({
        data: { engagementId, accountCode: row.accountCode, description: row.description, category: row.category,
          currentYear: row.currentYear ?? null, priorYear: row.priorYear ?? null,
          fsNoteLevel: row.fsNoteLevel, fsLevel: row.fsLevel, fsStatement: row.fsStatement,
          groupName: row.groupName, sortOrder: row.sortOrder },
      });
    }
  }

  const updated = await prisma.auditTBRow.findMany({ where: { engagementId }, orderBy: { sortOrder: 'asc' } });
  return NextResponse.json({ rows: updated });
}

export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  if (body.action === 'signoff') {
    return handlePermanentFileSignOff(engagementId, {
      engagementId,
      userId: session.user.id!,
      userName: session.user.name || session.user.email || 'Unknown',
      role: body.role,
    }, 'trial-balance');
  }
  if (body.action === 'unsignoff') {
    return handlePermanentFileUnsignOff(engagementId, session.user.id, body.role, 'trial-balance');
  }
  if (body.action === 'fieldMeta') {
    await savePermanentFileFieldMeta(engagementId, body.fieldMeta, 'trial-balance');
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
