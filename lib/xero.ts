import crypto from 'crypto';
import { prisma } from '@/lib/db';

const XERO_AUTH_URL = 'https://login.xero.com/identity/connect/authorize';
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0';
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';

const SCOPES = [
  'offline_access',
  'openid',
  'profile',
  'email',
  'accounting.invoices.read',
  'accounting.payments.read',
  'accounting.banktransactions.read',
  'accounting.manualjournals.read',
  'accounting.settings.read',
  'accounting.contacts.read',
].join(' ');

// ─── PKCE ────────────────────────────────────────────────────────────────────

export function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const data = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final('utf8');
}

export function buildAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string,
  loginHint?: string,
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'login',
  });
  if (loginHint) {
    params.set('login_hint', loginHint);
  }
  return `${XERO_AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  id_token?: string;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const clientId = process.env.XERO_CLIENT_ID!;
  const clientSecret = process.env.XERO_CLIENT_SECRET!;

  const res = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Xero token exchange failed (${res.status}): ${body}`);
  }

  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const clientId = process.env.XERO_CLIENT_ID!;
  const clientSecret = process.env.XERO_CLIENT_SECRET!;

  const res = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Xero token refresh failed (${res.status}): ${body}`);
  }

  return res.json();
}

export interface XeroTenant {
  tenantId: string;
  tenantName: string;
  tenantType: string;
}

export async function getConnectedTenants(accessToken: string): Promise<XeroTenant[]> {
  const res = await fetch(XERO_CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Xero connections fetch failed (${res.status})`);
  return res.json();
}

async function getValidAccessToken(clientId: string): Promise<{ accessToken: string; tenantId: string }> {
  const conn = await prisma.accountingConnection.findUnique({
    where: { clientId_system: { clientId, system: 'xero' } },
  });

  if (!conn) throw new Error('No Xero connection found for this client');
  if (new Date() > conn.expiresAt) throw new Error('Xero connection expired — please reconnect');

  let accessToken = decrypt(conn.accessToken);
  let tenantId = conn.tenantId!;

  if (new Date() >= conn.tokenExpiresAt) {
    const currentRefresh = decrypt(conn.refreshToken);
    const tokens = await refreshAccessToken(currentRefresh);

    const newExpiry = new Date(Date.now() + tokens.expires_in * 1000);
    await prisma.accountingConnection.update({
      where: { id: conn.id },
      data: {
        accessToken: encrypt(tokens.access_token),
        refreshToken: encrypt(tokens.refresh_token),
        tokenExpiresAt: newExpiry,
      },
    });

    accessToken = tokens.access_token;
  }

  return { accessToken, tenantId };
}

export interface XeroAccount {
  AccountID: string;
  Code: string;
  Name: string;
  Type: string;
  Class: string;
  Status: string;
}

export async function getAccounts(clientId: string): Promise<XeroAccount[]> {
  const { accessToken, tenantId } = await getValidAccessToken(clientId);

  const res = await fetch(`${XERO_API_BASE}/Accounts`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Xero-Tenant-Id': tenantId,
      Accept: 'application/json',
    },
  });

  if (!res.ok) throw new Error(`Xero Accounts fetch failed (${res.status})`);
  const data = await res.json();
  return data.Accounts ?? [];
}

export interface XeroTransaction {
  BankTransactionID?: string;
  InvoiceID?: string;
  Type: string;
  Date: string;
  Reference?: string;
  Contact?: { Name: string; ContactID: string };
  SubTotal: number;
  TotalTax: number;
  Total: number;
  LineItems: {
    Description: string;
    Quantity: number;
    UnitAmount: number;
    TaxAmount: number;
    LineAmount: number;
    AccountCode: string;
  }[];
}

export async function getTransactions(
  clientId: string,
  accountCodes: string[],
  dateFrom: string,
  dateTo: string,
): Promise<XeroTransaction[]> {
  const { accessToken, tenantId } = await getValidAccessToken(clientId);

  const whereClause = [
    `Date >= DateTime(${dateFrom.replace(/-/g, ',')})`,
    `Date <= DateTime(${dateTo.replace(/-/g, ',')})`,
  ].join(' AND ');

  const invoices = await fetchPaginated(
    `${XERO_API_BASE}/Invoices`,
    accessToken,
    tenantId,
    whereClause,
  );

  await new Promise(resolve => setTimeout(resolve, XERO_PAGE_DELAY_MS));

  const bankTxns = await fetchPaginated(
    `${XERO_API_BASE}/BankTransactions`,
    accessToken,
    tenantId,
    whereClause,
  );

  const allTxns = [...invoices, ...bankTxns];

  if (accountCodes.length === 0) return allTxns;

  const codeSet = new Set(accountCodes);
  return allTxns.filter(txn =>
    txn.LineItems?.some((li: { AccountCode: string }) => codeSet.has(li.AccountCode)),
  );
}

export async function revokeConnection(accessToken: string, tenantId: string): Promise<void> {
  try {
    const res = await fetch(`${XERO_CONNECTIONS_URL}/${tenantId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok && res.status !== 404) {
      console.warn(`Xero revoke returned ${res.status} for tenant ${tenantId}`);
    }
  } catch (err) {
    console.warn('Xero revoke failed (best-effort):', err instanceof Error ? err.message : err);
  }
}

async function xeroFetchWithRetry(
  url: string,
  headers: Record<string, string>,
  maxRetries = 5,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, { headers });

    if (res.status !== 429) return res;

    if (attempt === maxRetries) return res;

    const retryAfter = res.headers.get('Retry-After');
    const waitMs = retryAfter
      ? parseInt(retryAfter, 10) * 1000
      : Math.min(1000 * Math.pow(2, attempt), 30000);

    console.log(`[Xero] 429 rate-limited on ${url}, retry ${attempt + 1}/${maxRetries} after ${waitMs}ms`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }

  throw new Error('Unreachable');
}

const XERO_PAGE_DELAY_MS = 1200;

async function fetchPaginated(
  url: string,
  accessToken: string,
  tenantId: string,
  where: string,
): Promise<XeroTransaction[]> {
  const results: XeroTransaction[] = [];
  let page = 1;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Xero-Tenant-Id': tenantId,
    Accept: 'application/json',
  };

  while (true) {
    if (page > 1) {
      await new Promise(resolve => setTimeout(resolve, XERO_PAGE_DELAY_MS));
    }

    const params = new URLSearchParams({ where, page: String(page) });
    const res = await xeroFetchWithRetry(`${url}?${params}`, headers);

    if (!res.ok) throw new Error(`Xero API fetch failed (${res.status}) for ${url}`);
    const data = await res.json();

    const items: XeroTransaction[] = data.Invoices ?? data.BankTransactions ?? [];
    results.push(...items);

    if (items.length < 100) break;
    page++;
  }

  return results;
}
