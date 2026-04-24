import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { buildAuthorizeUrl, generatePKCE } from '@/lib/xero';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.redirect(new URL('/xero-authorise/invalid', req.url));
  }

  const request = await prisma.xeroAuthRequest.findUnique({
    where: { token },
  });

  if (!request || request.status !== 'pending' || new Date() > request.expiresAt) {
    return NextResponse.redirect(new URL(`/xero-authorise/${token}`, req.url));
  }

  const xeroClientId = process.env.XERO_CLIENT_ID;
  if (!xeroClientId) {
    return new NextResponse('Xero integration not configured', { status: 503 });
  }

  const redirectUri = process.env.XERO_REDIRECT_URI
    || `${process.env.NEXTAUTH_URL || 'https://acumon-website.vercel.app'}/api/accounting/xero/callback`;

  const state = JSON.stringify({
    clientId: request.clientId,
    delegatedToken: token,
  });
  const stateEncoded = Buffer.from(state).toString('base64url');

  const loginHint = searchParams.get('login_hint') || undefined;

  const { codeVerifier, codeChallenge } = generatePKCE();

  await prisma.xeroAuthRequest.update({
    where: { id: request.id },
    data: { codeVerifier },
  });

  const url = buildAuthorizeUrl(xeroClientId, redirectUri, stateEncoded, codeChallenge, loginHint);

  const response = NextResponse.redirect(url);

  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 600,
    path: '/',
  };

  response.cookies.set('xero_oauth_state', stateEncoded, cookieOpts);

  return response;
}
