// POST /api/internal/handoff/[sessionId]/prompt
// Body: { type, message, options?, promptId }
//
// Orchestrator queues a prompt the user must answer before it can
// continue (credentials, MFA, "is this the right client?" etc.).
// The user's modal is polling /handoff/status and will render the
// prompt inline. The orchestrator follows up with /prompt-answer to
// long-poll for the user's answer.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyOrchestratorSecret } from '@/lib/import-options/internal-auth';

const VALID_PROMPT_TYPES = new Set(['credentials', 'mfa', 'confirm', 'select', 'text']);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  if (!verifyOrchestratorSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { sessionId } = await params;
  const body = await req.json().catch(() => ({})) as {
    promptId?: string;
    type?: string;
    message?: string;
    options?: unknown;
  };
  if (!body.promptId || !body.type || !VALID_PROMPT_TYPES.has(body.type)) {
    return NextResponse.json({ error: 'promptId and valid type required' }, { status: 400 });
  }

  const handoff = await prisma.importHandoffSession.findUnique({ where: { id: sessionId } });
  if (!handoff) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (handoff.status !== 'pending') {
    return NextResponse.json({ error: `Session ${handoff.status}` }, { status: 409 });
  }

  await prisma.importHandoffSession.update({
    where: { id: sessionId },
    data: {
      pendingPromptId: body.promptId,
      pendingPromptType: body.type,
      pendingPromptMessage: body.message || null,
      pendingPromptOptions: (body.options as object) ?? undefined,
      pendingPromptAt: new Date(),
      pendingPromptAnswer: undefined,
      pendingPromptAnsweredAt: null,
      progressStage: 'awaiting_input',
      progressMessage: body.message || 'Waiting for your input',
      progressAt: new Date(),
    },
  });
  return NextResponse.json({ ok: true });
}
