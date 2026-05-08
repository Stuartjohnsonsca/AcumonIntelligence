// POST /api/internal/handoff/[sessionId]/fail
// Body: { message }
//
// Orchestrator reports an unrecoverable failure (vendor login refused,
// client not found, browser crashed, etc.). We flip status to 'failed',
// store the message for the modal to display, and wipe any pending
// credentials.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyOrchestratorSecret } from '@/lib/import-options/internal-auth';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  if (!verifyOrchestratorSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { sessionId } = await params;
  const body = await req.json().catch(() => ({})) as { message?: string };

  const handoff = await prisma.importHandoffSession.findUnique({ where: { id: sessionId } });
  if (!handoff) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (handoff.status !== 'pending') {
    return NextResponse.json({ ok: true, alreadyClosed: true });
  }

  await prisma.importHandoffSession.update({
    where: { id: sessionId },
    data: {
      status: 'failed',
      failureMessage: (body.message || 'Import failed').slice(0, 500),
      // Defence-in-depth: nuke any leftover credentials/MFA codes.
      pendingPromptAnswer: undefined,
      pendingPromptType: null,
      pendingPromptMessage: null,
      pendingPromptOptions: undefined,
      progressStage: 'awaiting_input',
      progressMessage: body.message || 'Import failed',
      progressAt: new Date(),
    },
  });
  return NextResponse.json({ ok: true });
}
