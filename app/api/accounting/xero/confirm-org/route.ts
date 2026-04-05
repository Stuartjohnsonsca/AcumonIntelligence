import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { decrypt, encrypt } from '@/lib/xero';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { pendingId, tenantId } = await req.json();

  if (!pendingId || !tenantId) {
    return NextResponse.json({ error: 'pendingId and tenantId required' }, { status: 400 });
  }

  // Retrieve the pending auth
  const pending = await prisma.pendingXeroAuth.findUnique({
    where: { id: pendingId },
  });

  if (!pending) {
    return NextResponse.json({ error: 'Pending auth not found or expired' }, { status: 404 });
  }

  // Check it's not too old (5 minute window)
  const ageMs = Date.now() - pending.createdAt.getTime();
  if (ageMs > 5 * 60 * 1000) {
    await prisma.pendingXeroAuth.delete({ where: { id: pendingId } });
    return NextResponse.json({ error: 'Auth session expired. Please reconnect to Xero.' }, { status: 410 });
  }

  // Validate the selected tenant is in the list
  const tenants = pending.tenants as { tenantId: string; tenantName: string }[];
  const selectedTenant = tenants.find(t => t.tenantId === tenantId);

  if (!selectedTenant) {
    return NextResponse.json({ error: 'Selected organisation not found in authorised list' }, { status: 400 });
  }

  // Decrypt tokens from pending record
  const accessToken = decrypt(pending.accessToken);
  const refreshToken = decrypt(pending.refreshToken);

  const tokenExpiry = new Date(pending.createdAt.getTime() + pending.expiresIn * 1000);
  const connectionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // Save the connection with the user's chosen org
  await prisma.accountingConnection.upsert({
    where: { clientId_system: { clientId: pending.clientId, system: 'xero' } },
    create: {
      clientId: pending.clientId,
      system: 'xero',
      accessToken: encrypt(accessToken),
      refreshToken: encrypt(refreshToken),
      tokenExpiresAt: tokenExpiry,
      tenantId: selectedTenant.tenantId,
      orgName: selectedTenant.tenantName,
      connectedBy: pending.connectedBy,
      expiresAt: connectionExpiry,
    },
    update: {
      accessToken: encrypt(accessToken),
      refreshToken: encrypt(refreshToken),
      tokenExpiresAt: tokenExpiry,
      tenantId: selectedTenant.tenantId,
      orgName: selectedTenant.tenantName,
      connectedBy: pending.connectedBy,
      expiresAt: connectionExpiry,
    },
  });

  await prisma.client.update({
    where: { id: pending.clientId },
    data: { software: 'Xero' },
  });

  // Handle delegated flow
  if (pending.isDelegated && pending.delegatedToken) {
    await prisma.xeroAuthRequest.update({
      where: { token: pending.delegatedToken },
      data: { status: 'authorised', respondedAt: new Date(), codeVerifier: null },
    });
  }

  // Clean up pending record
  await prisma.pendingXeroAuth.delete({ where: { id: pendingId } });

  console.log(`[Xero] Confirmed org: ${selectedTenant.tenantName} for client ${pending.clientId}`);

  // Return redirect URL — use stored returnUrl if available
  const returnBase = pending.returnUrl || '/tools/data-extraction';
  const sep = returnBase.includes('?') ? '&' : '?';
  const redirectUrl = pending.isDelegated && pending.delegatedToken
    ? `/xero-authorise/${pending.delegatedToken}`
    : `${returnBase}${sep}xeroConnected=true&clientId=${pending.clientId}`;

  return NextResponse.json({ ok: true, redirectUrl, orgName: selectedTenant.tenantName });
}
