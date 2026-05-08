// POST /api/engagements/[id]/import-options/handoff/answer
// Body: { sessionId, promptId, answer }
//
// Called by the modal when the user submits a credential entry, MFA
// code, confirmation choice etc. We store the answer on the session row;
// the orchestrator's long-poll on /api/internal/handoff/[id]/prompt-answer
// picks it up and continues. We also clear the pending prompt fields so
// any UI showing the prompt stops.
//
// IMPORTANT: credentials live in pending_prompt_answer (jsonb). The
// orchestrator MUST clear it the moment it reads. Acumon also wipes
// the field when the orchestrator reports submitted/failed, as a
// defence-in-depth measure.

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

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
    sessionId?: string;
    promptId?: string;
    answer?: unknown;
  };
  const { sessionId, promptId, answer } = body;
  if (!sessionId || !promptId) {
    return NextResponse.json({ error: 'sessionId and promptId required' }, { status: 400 });
  }

  const handoff = await prisma.importHandoffSession.findUnique({ where: { id: sessionId } });
  if (!handoff
    || handoff.engagementId !== engagementId
    || handoff.firmId !== session.user.firmId
    || handoff.createdById !== session.user.id) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (handoff.status !== 'pending') {
    return NextResponse.json({ error: `Session ${handoff.status}` }, { status: 409 });
  }
  if (handoff.pendingPromptId !== promptId) {
    // Stale answer (orchestrator already moved on, or replaced the prompt).
    return NextResponse.json({ error: 'Prompt no longer current' }, { status: 409 });
  }

  await prisma.importHandoffSession.update({
    where: { id: sessionId },
    data: {
      pendingPromptAnswer: answer as object,
      pendingPromptAnsweredAt: new Date(),
      // Clear the prompt fields so the modal stops showing the form;
      // the answer ride remains until the orchestrator picks it up.
      pendingPromptType: null,
      pendingPromptMessage: null,
      pendingPromptOptions: undefined,
    },
  });

  return NextResponse.json({ ok: true });
}
