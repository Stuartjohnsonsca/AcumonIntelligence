import { NextRequest, NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { resumeExecution, resumePipelineExecution } from '@/lib/flow-engine';
import { uploadToInbox } from '@/lib/azure-blob';

// GET: List outstanding items for engagement
export async function GET(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get('status');

  const where: any = { engagementId };
  if (status && status !== 'all') where.status = status;

  const items = await prisma.outstandingItem.findMany({
    where,
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
  });

  return NextResponse.json({ items });
}

// PUT: Mark item complete (triggers flow / pipeline resumption if linked).
//
// Two body shapes accepted:
//   - JSON  { itemId, responseData }   — legacy, for review-style items
//   - FormData with fields:             — used by team-evidence panel
//       itemId        (string, required)
//       responseText  (string, optional) — comment from the team
//       file          (File,   repeatable) — attached evidence files
//
// On FormData uploads each file is written to the Azure inbox container and
// surfaces as { name, mimeType, size, storagePath } in responseData.documents,
// so the resumed pipeline step can bind to `$prev.documents` exactly the same
// way it would after a portal upload.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  const contentType = req.headers.get('content-type') || '';

  let itemId: string | null = null;
  let responseData: Record<string, any> | null = null;

  if (contentType.startsWith('multipart/form-data')) {
    const form = await req.formData();
    itemId = (form.get('itemId') as string) || null;
    if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });
    const responseText = (form.get('responseText') as string) || '';
    const verificationDate = (form.get('verificationDate') as string) || '';
    const files = form.getAll('file').filter((f): f is File => f instanceof File);

    const documents: Array<{ name: string; mimeType: string; size: number; storagePath: string }> = [];
    for (const file of files) {
      const safeName = (file.name || 'evidence').replace(/[^A-Za-z0-9._-]/g, '_');
      const blobName = `engagement-${engagementId}/outstanding-${itemId}/${Date.now()}-${safeName}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      const storagePath = await uploadToInbox(blobName, buffer, file.type || 'application/octet-stream');
      documents.push({
        name: file.name || safeName,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        storagePath,
      });
    }
    responseData = {
      completed: true,
      documents,
      response_text: responseText,
      verification_date: verificationDate,
      completed_by: session.user.name || session.user.email || 'Team member',
      completed_at: new Date().toISOString(),
    };
  } else {
    const body = await req.json();
    itemId = body.itemId || null;
    responseData = body.responseData || { completed: true };
  }

  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });

  const item = await prisma.outstandingItem.update({
    where: { id: itemId },
    data: { status: 'complete', completedAt: new Date(), responseData: (responseData || null) as any },
  });

  // Resume the linked execution. The original endpoint only knew about
  // legacy flow-mode executions; action_pipeline executions need the
  // pipeline-specific resume function or they sit paused forever.
  if (item.executionId) {
    try {
      const execution = await prisma.testExecution.findUnique({
        where: { id: item.executionId },
        select: { executionMode: true },
      });
      if (execution?.executionMode === 'action_pipeline') {
        await resumePipelineExecution(item.executionId, responseData || { completed: true });
      } else {
        await resumeExecution(item.executionId, responseData || { completed: true });
      }
    } catch (err: any) {
      console.error('Failed to resume execution:', err.message);
    }
  }

  return NextResponse.json({ item });
}
