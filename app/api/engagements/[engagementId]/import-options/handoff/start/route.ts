import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

const SESSION_TTL_MINUTES = 30;

function newSessionId(): string {
  const ALPHABET = 'abcdefghjkmnpqrstvwxyz23456789';
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

// POST /api/engagements/[id]/import-options/handoff/start
// Body: { vendorLabel: string }
//
// Creates a server-driven import session and notifies the orchestrator
// (Azure Container Apps service) to start a headless browser run for it.
// Modal polls /handoff/status for progress + prompts.
//
// Orchestrator URL is `ORCHESTRATOR_URL` (env). If not set, the session
// is created in 'pending' state but the orchestrator is not invoked —
// the modal will sit on stage 'created' until something picks it up.
// This is the deliberate behaviour during the rollout window before the
// orchestrator container is deployed.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, client: { select: { clientName: true } } },
  });
  if (!engagement || engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({})) as { vendorLabel?: string };
  const vendorLabel = (body.vendorLabel || '').trim() || 'Cloud Audit Software';

  let sessionId = newSessionId();
  for (let attempt = 0; attempt < 3; attempt++) {
    const exists = await prisma.importHandoffSession.findUnique({ where: { id: sessionId } });
    if (!exists) break;
    sessionId = newSessionId();
  }

  const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000);
  await prisma.importHandoffSession.create({
    data: {
      id: sessionId,
      engagementId,
      firmId: session.user.firmId,
      createdById: session.user.id,
      vendorLabel,
      status: 'pending',
      expiresAt,
      progressStage: 'created',
      progressMessage: 'Session created. Starting browser…',
      progressAt: new Date(),
    },
  });

  // Notify the orchestrator (fire-and-forget). If it's down or
  // misconfigured, the session stays in 'created' and the modal still
  // works — the user just doesn't see progress beyond stage 1. We log
  // but do not fail the user.
  const orchestratorUrl = process.env.ORCHESTRATOR_URL;
  const orchestratorSecret = process.env.ORCHESTRATOR_SECRET;
  console.log('[handoff/start]', {
    sessionId,
    orchestratorUrlSet: Boolean(orchestratorUrl),
    orchestratorUrlLen: orchestratorUrl?.length || 0,
    orchestratorSecretSet: Boolean(orchestratorSecret),
    orchestratorSecretLen: orchestratorSecret?.length || 0,
  });
  if (orchestratorUrl && orchestratorSecret) {
    // Await the response so we get visibility into success/failure;
    // 'created' status is already set on the DB row by this point so
    // even a slow orchestrator doesn't block the user-facing API.
    try {
      const orchRes = await fetch(`${orchestratorUrl.replace(/\/+$/, '')}/sessions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-orchestrator-secret': orchestratorSecret,
        },
        body: JSON.stringify({
          sessionId,
          engagementId,
          firmId: session.user.firmId,
          userId: session.user.id,
          vendorLabel,
          clientName: engagement.client?.clientName,
        }),
      });
      const orchText = await orchRes.text().catch(() => '');
      console.log(`[handoff/start] orchestrator notified — ${orchRes.status} ${orchText.slice(0, 200)}`);
    } catch (err) {
      console.warn('[handoff/start] orchestrator notify failed:', err instanceof Error ? err.message : String(err));
    }
  } else {
    console.warn('[handoff/start] orchestrator NOT notified — env vars missing');
  }

  return NextResponse.json({
    sessionId,
    expiresAt: expiresAt.toISOString(),
    orchestratorConfigured: Boolean(orchestratorUrl && orchestratorSecret),
  });
}
