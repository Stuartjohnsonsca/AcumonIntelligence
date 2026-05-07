import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

const SESSION_TTL_MINUTES = 30;

// Short, human-pasteable session id. NOT a bearer; this is just a row
// pointer the assistant carries. OAuth provides the actual auth.
function newSessionId(): string {
  const ALPHABET = 'abcdefghjkmnpqrstvwxyz23456789';
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

// POST /api/engagements/[id]/import-options/handoff/start
// Body: { vendorLabel: string }
// Creates an ImportHandoffSession (status='pending', 30-minute TTL) and
// returns a short sessionId. The user's AI assistant — once authorised
// via OAuth on the Acumon MCP server — calls list_pending_sessions /
// get_session_context / submit_archive on the MCP, scoping operations
// by sessionId. Acumon-side polling on /handoff/status flips to the
// Review screen on submit.
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
    select: { firmId: true },
  });
  if (!engagement || engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({})) as { vendorLabel?: string };
  const vendorLabel = (body.vendorLabel || '').trim() || 'Cloud Audit Software';

  // Generate a unique short id (collision risk negligible at this length;
  // retry once if it happens).
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
    },
  });

  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  const mcpEndpoint = `${proto}://${host}/api/mcp`;
  const setupUrl = `${proto}://${host}/methodology-admin/cloud-audit-connectors/mcp-setup`;

  return NextResponse.json({
    sessionId,
    mcpEndpoint,
    setupUrl,
    expiresAt: expiresAt.toISOString(),
  });
}
