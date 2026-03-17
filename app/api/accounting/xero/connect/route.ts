import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { buildAuthorizeUrl, generatePKCE } from '@/lib/xero';
import { verifyClientAccess } from '@/lib/client-access';
import crypto from 'crypto';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 });
  }

  const access = await verifyClientAccess(session.user as { id: string; firmId: string; isSuperAdmin?: boolean }, clientId);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason || 'Forbidden' }, { status: 403 });
  }

  const xeroClientId = process.env.XERO_CLIENT_ID;
  if (!xeroClientId) {
    return NextResponse.json({ error: 'Xero integration not configured' }, { status: 503 });
  }

  const redirectUri = process.env.XERO_REDIRECT_URI
    || `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/accounting/xero/callback`;

  const state = JSON.stringify({
    clientId,
    nonce: crypto.randomBytes(16).toString('hex'),
  });
  const stateEncoded = Buffer.from(state).toString('base64url');

  const { codeVerifier, codeChallenge } = generatePKCE();
  const url = buildAuthorizeUrl(xeroClientId, redirectUri, stateEncoded, codeChallenge);

  const response = NextResponse.redirect(url);

  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 600,
    path: '/',
  };

  response.cookies.set('xero_oauth_state', stateEncoded, cookieOpts);
  response.cookies.set('xero_pkce_verifier', codeVerifier, cookieOpts);

  return response;
}
