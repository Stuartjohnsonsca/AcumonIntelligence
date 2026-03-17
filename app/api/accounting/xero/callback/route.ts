import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { exchangeCodeForTokens, getConnectedTenants, encrypt } from '@/lib/xero';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const cookieStore = await cookies();

  const clearOAuthCookies = (response: NextResponse) => {
    response.cookies.delete('xero_oauth_state');
    response.cookies.delete('xero_pkce_verifier');
    return response;
  };

  if (error) {
    return clearOAuthCookies(
      NextResponse.redirect(new URL(`/tools/data-extraction?xeroError=${encodeURIComponent(error)}`, req.url)),
    );
  }

  if (!code || !stateParam) {
    return clearOAuthCookies(
      NextResponse.redirect(new URL('/tools/data-extraction?xeroError=missing_params', req.url)),
    );
  }

  const savedState = cookieStore.get('xero_oauth_state')?.value;
  if (!savedState || savedState !== stateParam) {
    return clearOAuthCookies(
      NextResponse.redirect(new URL('/tools/data-extraction?xeroError=state_mismatch', req.url)),
    );
  }

  const codeVerifier = cookieStore.get('xero_pkce_verifier')?.value;
  if (!codeVerifier) {
    return clearOAuthCookies(
      NextResponse.redirect(new URL('/tools/data-extraction?xeroError=missing_pkce', req.url)),
    );
  }

  let clientId: string;
  try {
    const stateJson = Buffer.from(stateParam, 'base64url').toString('utf8');
    const parsed = JSON.parse(stateJson);
    clientId = parsed.clientId;
  } catch {
    return clearOAuthCookies(
      NextResponse.redirect(new URL('/tools/data-extraction?xeroError=invalid_state', req.url)),
    );
  }

  const redirectUri = process.env.XERO_REDIRECT_URI
    || `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/accounting/xero/callback`;

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri, codeVerifier);
    const tenants = await getConnectedTenants(tokens.access_token);
    const tenant = tenants[0];

    if (!tenant) {
      return clearOAuthCookies(
        NextResponse.redirect(new URL('/tools/data-extraction?xeroError=no_organisation', req.url)),
      );
    }

    const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000);
    const connectionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await prisma.accountingConnection.upsert({
      where: { clientId_system: { clientId, system: 'xero' } },
      create: {
        clientId,
        system: 'xero',
        accessToken: encrypt(tokens.access_token),
        refreshToken: encrypt(tokens.refresh_token),
        tokenExpiresAt: tokenExpiry,
        tenantId: tenant.tenantId,
        orgName: tenant.tenantName,
        connectedBy: session.user.email || 'unknown',
        expiresAt: connectionExpiry,
      },
      update: {
        accessToken: encrypt(tokens.access_token),
        refreshToken: encrypt(tokens.refresh_token),
        tokenExpiresAt: tokenExpiry,
        tenantId: tenant.tenantId,
        orgName: tenant.tenantName,
        connectedBy: session.user.email || 'unknown',
        expiresAt: connectionExpiry,
      },
    });

    await prisma.client.update({
      where: { id: clientId },
      data: { software: 'Xero' },
    });

    return clearOAuthCookies(
      NextResponse.redirect(new URL(`/tools/data-extraction?xeroConnected=true&clientId=${clientId}`, req.url)),
    );
  } catch (err) {
    console.error('Xero callback error:', err);
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return clearOAuthCookies(
      NextResponse.redirect(new URL(`/tools/data-extraction?xeroError=${encodeURIComponent(msg)}`, req.url)),
    );
  }
}
