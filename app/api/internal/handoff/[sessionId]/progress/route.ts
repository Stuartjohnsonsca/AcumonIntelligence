// POST /api/internal/handoff/[sessionId]/progress
// Body: { stage, message }
//
// Orchestrator updates the session's progress so the modal's progress
// bar stays in sync with what the headless browser is doing.
// Authenticated by the shared orchestrator secret.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyOrchestratorSecret } from '@/lib/import-options/internal-auth';

const VALID_STAGES = new Set([
  'created', 'discovered', 'context_loaded', 'uploading', 'extracting', 'submitted',
  'launching_browser', 'logging_in', 'navigating', 'downloading', 'awaiting_input',
]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  if (!verifyOrchestratorSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { sessionId } = await params;
  const body = await req.json().catch(() => ({})) as { stage?: string; message?: string };
  if (!body.stage || !VALID_STAGES.has(body.stage)) {
    return NextResponse.json({ error: 'Invalid stage' }, { status: 400 });
  }

  const handoff = await prisma.importHandoffSession.findUnique({ where: { id: sessionId } });
  if (!handoff) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (handoff.status !== 'pending') {
    return NextResponse.json({ error: `Session ${handoff.status}` }, { status: 409 });
  }

  await prisma.importHandoffSession.update({
    where: { id: sessionId },
    data: {
      progressStage: body.stage,
      progressMessage: body.message || null,
      progressAt: new Date(),
    },
  });
  return NextResponse.json({ ok: true });
}
