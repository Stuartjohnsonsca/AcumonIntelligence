import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { exchangeCodeForTokens, getConnectedTenants, encrypt } from '@/lib/xero';

export async function GET(req: Request) {
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

  // Parse the state to determine if this is a delegated or authenticated flow
  let clientId: string;
  let delegatedToken: string | null = null;

  if (stateParam) {
    try {
      const stateJson = Buffer.from(stateParam, 'base64url').toString('utf8');
      const parsed = JSON.parse(stateJson);
      clientId = parsed.clientId;
      delegatedToken = parsed.delegatedToken || null;
    } catch {
      clientId = '';
    }
  } else {
    clientId = '';
  }

  const isDelegated = !!delegatedToken;

  if (error) {
    if (isDelegated) {
      return clearOAuthCookies(
        NextResponse.redirect(new URL(`/xero-authorise/${delegatedToken}?error=${encodeURIComponent(error)}`, req.url)),
      );
    }
    return clearOAuthCookies(
      NextResponse.redirect(new URL(`/tools/data-extraction?xeroError=${encodeURIComponent(error)}`, req.url)),
    );
  }

  if (!code || !stateParam) {
    if (isDelegated) {
      return clearOAuthCookies(
        NextResponse.redirect(new URL(`/xero-authorise/${delegatedToken}?error=missing_params`, req.url)),
      );
    }
    return clearOAuthCookies(
      NextResponse.redirect(new URL('/tools/data-extraction?xeroError=missing_params', req.url)),
    );
  }

  // Validate state cookie
  const savedState = cookieStore.get('xero_oauth_state')?.value;
  if (!savedState || savedState !== stateParam) {
    if (isDelegated) {
      return clearOAuthCookies(
        NextResponse.redirect(new URL(`/xero-authorise/${delegatedToken}?error=state_mismatch`, req.url)),
      );
    }
    return clearOAuthCookies(
      NextResponse.redirect(new URL('/tools/data-extraction?xeroError=state_mismatch', req.url)),
    );
  }

  // Get PKCE verifier — for delegated flow it's stored in the DB, for authenticated flow in a cookie
  let codeVerifier: string | undefined;

  if (isDelegated) {
    const authRequest = await prisma.xeroAuthRequest.findUnique({
      where: { token: delegatedToken! },
    });
    codeVerifier = authRequest?.codeVerifier || undefined;
  } else {
    codeVerifier = cookieStore.get('xero_pkce_verifier')?.value;
  }

  if (!codeVerifier) {
    if (isDelegated) {
      return clearOAuthCookies(
        NextResponse.redirect(new URL(`/xero-authorise/${delegatedToken}?error=missing_pkce`, req.url)),
      );
    }
    return clearOAuthCookies(
      NextResponse.redirect(new URL('/tools/data-extraction?xeroError=missing_pkce', req.url)),
    );
  }

  // For authenticated (non-delegated) flow, verify the user is logged in
  if (!isDelegated) {
    const session = await auth();
    if (!session?.user?.twoFactorVerified) {
      return NextResponse.redirect(new URL('/login', req.url));
    }
  }

  if (!clientId) {
    if (isDelegated) {
      return clearOAuthCookies(
        NextResponse.redirect(new URL(`/xero-authorise/${delegatedToken}?error=invalid_state`, req.url)),
      );
    }
    return clearOAuthCookies(
      NextResponse.redirect(new URL('/tools/data-extraction?xeroError=invalid_state', req.url)),
    );
  }

  const redirectUri = process.env.XERO_REDIRECT_URI
    || `${process.env.NEXTAUTH_URL || 'https://acumon-intelligence.vercel.app'}/api/accounting/xero/callback`;

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri, codeVerifier);
    const tenants = await getConnectedTenants(tokens.access_token);
    const tenant = tenants[0];

    if (!tenant) {
      const noOrgUrl = isDelegated
        ? `/xero-authorise/${delegatedToken}?error=no_organisation`
        : '/tools/data-extraction?xeroError=no_organisation';
      return clearOAuthCookies(NextResponse.redirect(new URL(noOrgUrl, req.url)));
    }

    const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000);
    const connectionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const connectedBy = isDelegated
      ? `client:${delegatedToken}`
      : (await auth())?.user?.email || 'unknown';

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
        connectedBy,
        expiresAt: connectionExpiry,
      },
      update: {
        accessToken: encrypt(tokens.access_token),
        refreshToken: encrypt(tokens.refresh_token),
        tokenExpiresAt: tokenExpiry,
        tenantId: tenant.tenantId,
        orgName: tenant.tenantName,
        connectedBy,
        expiresAt: connectionExpiry,
      },
    });

    await prisma.client.update({
      where: { id: clientId },
      data: { software: 'Xero' },
    });

    // Mark the delegated request as authorised
    if (isDelegated) {
      await prisma.xeroAuthRequest.update({
        where: { token: delegatedToken! },
        data: {
          status: 'authorised',
          respondedAt: new Date(),
          codeVerifier: null,
        },
      });

      return clearOAuthCookies(
        NextResponse.redirect(new URL(`/xero-authorise/${delegatedToken}`, req.url)),
      );
    }

    return clearOAuthCookies(
      NextResponse.redirect(new URL(`/tools/data-extraction?xeroConnected=true&clientId=${clientId}`, req.url)),
    );
  } catch (err) {
    console.error('Xero callback error:', err);
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (isDelegated) {
      return clearOAuthCookies(
        NextResponse.redirect(new URL(`/xero-authorise/${delegatedToken}?error=${encodeURIComponent(msg)}`, req.url)),
      );
    }
    return clearOAuthCookies(
      NextResponse.redirect(new URL(`/tools/data-extraction?xeroError=${encodeURIComponent(msg)}`, req.url)),
    );
  }
}
