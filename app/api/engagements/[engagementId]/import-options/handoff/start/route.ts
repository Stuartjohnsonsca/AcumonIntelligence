import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

const SESSION_TTL_MINUTES = 30;

// Generate a 256-bit base32 token. Used as the bearer for the MCP server.
function newToken(): string {
  const bytes = randomBytes(32);
  // Crockford-ish base32 — lowercase, no padding, no ambiguous chars.
  const ALPHABET = 'abcdefghjkmnpqrstvwxyz23456789';
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

// POST /api/engagements/[id]/import-options/handoff/start
// Body: { vendorLabel: string }
// Creates a one-time ImportHandoffSession. The returned `sessionToken` is
// the bearer credential the user pastes once into Claude Cowork's prompt
// for the Acumon MCP server (or wherever they have it registered).
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

  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000);

  await prisma.importHandoffSession.create({
    data: {
      id: token,
      engagementId,
      firmId: session.user.firmId,
      createdById: session.user.id,
      vendorLabel,
      status: 'pending',
      expiresAt,
    },
  });

  // Build the absolute MCP endpoint URL. Prefer the request's own host
  // (so dev/preview/prod all work) — Vercel sets x-forwarded-host.
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  const mcpEndpoint = `${proto}://${host}/api/mcp`;

  return NextResponse.json({
    sessionToken: token,
    mcpEndpoint,
    expiresAt: expiresAt.toISOString(),
    instructions: [
      `Open your AI assistant with the Acumon MCP server connected (URL above).`,
      `Tell it: "Run the Acumon import session. Token: ${token}".`,
      `It will read the engagement context and ask you to confirm the vendor tab is open.`,
      `When it submits the file, this screen will refresh automatically into the Review step.`,
    ].join('\n'),
  });
}
