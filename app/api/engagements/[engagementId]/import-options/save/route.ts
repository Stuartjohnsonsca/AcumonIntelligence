import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import type { ImportOptionsState, ImportSelection } from '@/lib/import-options/types';

// POST /api/engagements/[id]/import-options/save
// Persist the user's pop-up selections. Used both for "Cancel" (selections=[])
// and for the no-import-data path (selections may include copy_documents
// and/or ai_populate_current but no import_data → no source needed).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;
  const body = await req.json().catch(() => ({})) as {
    selections?: ImportSelection[];
    source?: ImportOptionsState['source'];
    status?: ImportOptionsState['status'];
  };

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, importOptions: true },
  });
  if (!engagement || engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  }

  const prev = (engagement.importOptions as ImportOptionsState | null) || null;
  const at = new Date().toISOString();
  const me = { userId: session.user.id, userName: session.user.name || session.user.email || null };

  const next: ImportOptionsState = {
    prompted: true,
    selections: body.selections || [],
    source: body.source,
    byUserId: me.userId,
    byUserName: me.userName,
    at,
    status: body.status || 'pending',
    extractionId: prev?.extractionId,
    history: [
      ...(prev?.history || []),
      {
        event: body.status === 'cancelled' ? 'cancelled' : 'prompted',
        at,
        by: me,
        note: body.selections?.join(',') || undefined,
      },
    ],
  };

  await prisma.auditEngagement.update({
    where: { id: engagementId },
    data: { importOptions: next as unknown as object },
  });

  return NextResponse.json({ importOptions: next });
}
