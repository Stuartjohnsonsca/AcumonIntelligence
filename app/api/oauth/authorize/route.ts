// POST /api/oauth/authorize
// Called by the consent form on /oauth/authorize after the user clicks
// Approve / Cancel. Validates the params again (we don't trust the
// client even though we just rendered them), issues a one-shot auth code
// for Approve, and returns the redirect_uri the front-end should send
// the browser to (the OAuth client lives on that URI and picks up the
// code from its query string per RFC 6749 §4.1.2).

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { newRandomToken } from '@/lib/oauth/server';

const AUTH_CODE_TTL_SECONDS = 60;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'access_denied', error_description: 'Authentication required' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as {
    decision?: 'approve' | 'deny';
    clientId?: string;
    redirectUri?: string;
    state?: string;
    scope?: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
    resource?: string;
  };

  if (!body.clientId || !body.redirectUri) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'Missing required fields' }, { status: 400 });
  }

  const client = await prisma.oAuthClient.findUnique({ where: { clientId: body.clientId } });
  if (!client) {
    return NextResponse.json({ error: 'invalid_client', error_description: 'Unknown client_id' }, { status: 400 });
  }
  if (client.firmId && client.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'access_denied', error_description: 'Client restricted to a different firm' }, { status: 403 });
  }
  const redirectUris = Array.isArray(client.redirectUris) ? (client.redirectUris as string[]) : [];
  if (!redirectUris.includes(body.redirectUri)) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'redirect_uri not registered' }, { status: 400 });
  }
  if (!body.codeChallenge || body.codeChallengeMethod !== 'S256') {
    return NextResponse.json({ error: 'invalid_request', error_description: 'PKCE S256 required' }, { status: 400 });
  }

  // Build the redirect URL the front-end will navigate to.
  const redirect = new URL(body.redirectUri);
  if (body.state) redirect.searchParams.set('state', body.state);

  if (body.decision === 'deny') {
    redirect.searchParams.set('error', 'access_denied');
    redirect.searchParams.set('error_description', 'User denied access');
    return NextResponse.json({ redirect: redirect.toString() });
  }

  // Approve — issue a one-shot auth code.
  const code = newRandomToken();
  await prisma.oAuthAuthCode.create({
    data: {
      code,
      clientId: client.clientId,
      userId: session.user.id,
      firmId: session.user.firmId,
      redirectUri: body.redirectUri,
      codeChallenge: body.codeChallenge,
      codeChallengeMethod: body.codeChallengeMethod,
      scope: body.scope || 'mcp',
      resource: body.resource || null,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000),
    },
  });

  redirect.searchParams.set('code', code);
  return NextResponse.json({ redirect: redirect.toString() });
}
