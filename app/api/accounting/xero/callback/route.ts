import { NextResponse } from 'next/server';
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

  if (error) {
    return NextResponse.redirect(
      new URL(`/tools/data-extraction?xeroError=${encodeURIComponent(error)}`, req.url),
    );
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(
      new URL('/tools/data-extraction?xeroError=missing_params', req.url),
    );
  }

  let clientId: string;
  try {
    const stateJson = Buffer.from(stateParam, 'base64url').toString('utf8');
    const parsed = JSON.parse(stateJson);
    clientId = parsed.clientId;
  } catch {
    return NextResponse.redirect(
      new URL('/tools/data-extraction?xeroError=invalid_state', req.url),
    );
  }

  const redirectUri = process.env.XERO_REDIRECT_URI
    || `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/accounting/xero/callback`;

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    const tenants = await getConnectedTenants(tokens.access_token);
    const tenant = tenants[0];

    if (!tenant) {
      return NextResponse.redirect(
        new URL('/tools/data-extraction?xeroError=no_organisation', req.url),
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

    return NextResponse.redirect(
      new URL(`/tools/data-extraction?xeroConnected=true&clientId=${clientId}`, req.url),
    );
  } catch (err) {
    console.error('Xero callback error:', err);
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.redirect(
      new URL(`/tools/data-extraction?xeroError=${encodeURIComponent(msg)}`, req.url),
    );
  }
}
