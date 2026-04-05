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
  let returnUrl: string | null = null;

  if (stateParam) {
    try {
      const stateJson = Buffer.from(stateParam, 'base64url').toString('utf8');
      const parsed = JSON.parse(stateJson);
      clientId = parsed.clientId;
      delegatedToken = parsed.delegatedToken || null;
      returnUrl = parsed.returnUrl || null;
    } catch {
      clientId = '';
    }
  } else {
    clientId = '';
  }

  // Build the non-delegated redirect base URL (fallback to data-extraction for backwards compat)
  const baseRedirect = returnUrl || '/tools/data-extraction';

  const isDelegated = !!delegatedToken;

  if (error) {
    if (isDelegated) {
      return clearOAuthCookies(
        NextResponse.redirect(new URL(`/xero-authorise/${delegatedToken}?error=${encodeURIComponent(error)}`, req.url)),
      );
    }
    return clearOAuthCookies(
      NextResponse.redirect(new URL(`${baseRedirect}${baseRedirect.includes('?') ? '&' : '?'}xeroError=${encodeURIComponent(error)}`, req.url)),
    );
  }

  if (!code || !stateParam) {
    if (isDelegated) {
      return clearOAuthCookies(
        NextResponse.redirect(new URL(`/xero-authorise/${delegatedToken}?error=missing_params`, req.url)),
      );
    }
    return clearOAuthCookies(
      NextResponse.redirect(new URL(`${baseRedirect}${baseRedirect.includes('?') ? '&' : '?'}xeroError=missing_params`, req.url)),
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
      NextResponse.redirect(new URL(`${baseRedirect}${baseRedirect.includes('?') ? '&' : '?'}xeroError=state_mismatch`, req.url)),
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
      NextResponse.redirect(new URL(`${baseRedirect}${baseRedirect.includes('?') ? '&' : '?'}xeroError=missing_pkce`, req.url)),
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
      NextResponse.redirect(new URL(`${baseRedirect}${baseRedirect.includes('?') ? '&' : '?'}xeroError=invalid_state`, req.url)),
    );
  }

  const redirectUri = process.env.XERO_REDIRECT_URI
    || `${process.env.NEXTAUTH_URL || 'https://acumon-intelligence.vercel.app'}/api/accounting/xero/callback`;

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri, codeVerifier);
    const tenants = await getConnectedTenants(tokens.access_token);

    if (!tenants || tenants.length === 0) {
      const noOrgUrl = isDelegated
        ? `/xero-authorise/${delegatedToken}?error=no_organisation`
        : `${baseRedirect}${baseRedirect.includes('?') ? '&' : '?'}xeroError=no_organisation`;
      return clearOAuthCookies(NextResponse.redirect(new URL(noOrgUrl, req.url)));
    }

    const connectedBy = isDelegated
      ? `client:${delegatedToken}`
      : (await auth())?.user?.email || 'unknown';

    // Multiple orgs: store tokens temporarily and redirect to org picker
    if (tenants.length > 1) {
      console.log(`[Xero] ${tenants.length} orgs available — redirecting to org picker`);

      const pending = await prisma.pendingXeroAuth.create({
        data: {
          clientId,
          accessToken: encrypt(tokens.access_token),
          refreshToken: encrypt(tokens.refresh_token),
          expiresIn: tokens.expires_in,
          connectedBy,
          isDelegated,
          delegatedToken,
          returnUrl,
          tenants: tenants.map((t: { tenantId: string; tenantName: string; createdDateUtc?: string }) => ({
            tenantId: t.tenantId,
            tenantName: t.tenantName,
            createdDateUtc: t.createdDateUtc,
          })),
        },
      });

      return clearOAuthCookies(
        NextResponse.redirect(new URL(`/xero-select-org?pendingId=${pending.id}`, req.url)),
      );
    }

    // Single org: save connection immediately
    const tenant = tenants[0];
    console.log(`[Xero] Single org: ${tenant.tenantName} — saving connection`);

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

    if (isDelegated) {
      await prisma.xeroAuthRequest.update({
        where: { token: delegatedToken! },
        data: { status: 'authorised', respondedAt: new Date(), codeVerifier: null },
      });
      return clearOAuthCookies(
        NextResponse.redirect(new URL(`/xero-authorise/${delegatedToken}`, req.url)),
      );
    }

    const sep = baseRedirect.includes('?') ? '&' : '?';
    return clearOAuthCookies(
      NextResponse.redirect(new URL(`${baseRedirect}${sep}xeroConnected=true&clientId=${clientId}`, req.url)),
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
      NextResponse.redirect(new URL(`${baseRedirect}${baseRedirect.includes('?') ? '&' : '?'}xeroError=${encodeURIComponent(msg)}`, req.url)),
    );
  }
}
