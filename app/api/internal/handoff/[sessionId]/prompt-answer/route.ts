// GET /api/internal/handoff/[sessionId]/prompt-answer?promptId=X&waitMs=20000
//
// Orchestrator long-polls for the user's answer to a prompt. Returns:
//   { answered: false, status, expired? }     when still pending (after waitMs)
//   { answered: true, answer, answeredAt }    once the user submits
// Returns 200 in both cases so the orchestrator's HTTP client doesn't
// trip on retries. After returning the answer ONCE, we wipe it from
// the row — credentials in particular must not linger.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyOrchestratorSecret } from '@/lib/import-options/internal-auth';

const MAX_WAIT_MS = 25000; // Vercel function timeout safety margin

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  if (!verifyOrchestratorSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { sessionId } = await params;
  const url = new URL(req.url);
  const promptId = url.searchParams.get('promptId') || '';
  const waitMs = Math.min(parseInt(url.searchParams.get('waitMs') || '0', 10) || 0, MAX_WAIT_MS);
  if (!promptId) return NextResponse.json({ error: 'promptId required' }, { status: 400 });

  const deadline = Date.now() + waitMs;
  // Poll the row until either an answer arrives or the wait elapses.
  // Cheap; the row is tiny and indexed by id.
  for (;;) {
    const handoff = await prisma.importHandoffSession.findUnique({ where: { id: sessionId } });
    if (!handoff) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    if (handoff.status !== 'pending') {
      return NextResponse.json({ answered: false, status: handoff.status });
    }
    if (handoff.pendingPromptAnswer && handoff.pendingPromptAnsweredAt
        && handoff.pendingPromptId === promptId) {
      // Atomically read + clear. The clear protects credentials at
      // rest; we capture the value just before zeroing.
      const answer = handoff.pendingPromptAnswer;
      const answeredAt = handoff.pendingPromptAnsweredAt;
      await prisma.importHandoffSession.update({
        where: { id: sessionId },
        data: {
          pendingPromptAnswer: undefined,
          pendingPromptId: null,
        },
      });
      return NextResponse.json({ answered: true, answer, answeredAt: answeredAt.toISOString() });
    }
    if (Date.now() >= deadline) {
      return NextResponse.json({ answered: false, status: handoff.status });
    }
    await new Promise(r => setTimeout(r, 750));
  }
}
