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
  'accounting.attachments.read',
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
  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('XERO_CLIENT_ID or XERO_CLIENT_SECRET not set — cannot refresh token');
  }

  const start = Date.now();
  console.log('[Xero] Refreshing access token...');

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

  const elapsed = Date.now() - start;

  if (!res.ok) {
    const body = await res.text();
    console.error(`[Xero] Token refresh failed in ${elapsed}ms: ${res.status} ${body.substring(0, 200)}`);
    throw new Error(`Xero token refresh failed (${res.status}): ${body}`);
  }

  console.log(`[Xero] Token refreshed in ${elapsed}ms`);
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
  const start = Date.now();
  const conn = await prisma.accountingConnection.findUnique({
    where: { clientId_system: { clientId, system: 'xero' } },
  });
  console.log(`[Xero] DB lookup: ${Date.now() - start}ms`);

  if (!conn) throw new Error('No Xero connection found for this client');
  if (new Date() > conn.expiresAt) throw new Error(`Xero connection expired at ${conn.expiresAt.toISOString()} — please reconnect`);

  let accessToken = decrypt(conn.accessToken);
  let tenantId = conn.tenantId!;

  const now = new Date();
  const tokenAge = Math.round((now.getTime() - conn.tokenExpiresAt.getTime()) / 1000);
  if (now >= conn.tokenExpiresAt) {
    console.log(`[Xero] Token expired ${Math.abs(tokenAge)}s ago, refreshing...`);
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
    console.log(`[Xero] Token refresh + DB update: ${Date.now() - start}ms total`);
  } else {
    console.log(`[Xero] Token still valid for ${Math.abs(tokenAge)}s`);
  }

  return { accessToken, tenantId };
}

export interface XeroAccount {
  AccountID: string;
  Code: string;
  Name: string;
  Description?: string;
  Type: string;
  Class: string;
  Status: string;
}

export async function getAccounts(clientId: string, maxRetries?: number): Promise<XeroAccount[]> {
  const { accessToken, tenantId } = await getValidAccessToken(clientId);

  const res = await xeroFetchWithRetry(`${XERO_API_BASE}/Accounts`, {
    Authorization: `Bearer ${accessToken}`,
    'Xero-Tenant-Id': tenantId,
    Accept: 'application/json',
  }, maxRetries);

  if (!res.ok) throw new Error(`Xero Accounts fetch failed (${res.status})`);
  const data = await res.json();
  return data.Accounts ?? [];
}

// ─── Tax Rates ───────────────────────────────────────────────────────────────

export interface XeroTaxRate {
  Name: string;
  TaxType: string;
  EffectiveRate: number;
  DisplayTaxRate: number;
  Status: string;
}

export async function getTaxRates(clientId: string): Promise<Map<string, number>> {
  const { accessToken, tenantId } = await getValidAccessToken(clientId);
  const res = await xeroFetchWithRetry(`${XERO_API_BASE}/TaxRates`, {
    Authorization: `Bearer ${accessToken}`,
    'Xero-Tenant-Id': tenantId,
    Accept: 'application/json',
  });
  if (!res.ok) {
    console.warn(`Xero TaxRates fetch failed (${res.status})`);
    return new Map();
  }
  const data = await res.json();
  const rates = new Map<string, number>();
  for (const tr of (data.TaxRates ?? []) as XeroTaxRate[]) {
    rates.set(tr.TaxType, tr.EffectiveRate ?? tr.DisplayTaxRate ?? 0);
  }
  return rates;
}

// ─── Contact Groups ──────────────────────────────────────────────────────────

export async function batchFetchContactGroups(
  clientId: string,
  contactIds: string[],
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  if (contactIds.length === 0) return results;

  const { accessToken, tenantId } = await getValidAccessToken(clientId);
  const unique = [...new Set(contactIds)];
  const BATCH_SIZE = 50;

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const ids = batch.join(',');
    try {
      const res = await xeroFetchWithRetry(
        `${XERO_API_BASE}/Contacts?IDs=${ids}`,
        {
          Authorization: `Bearer ${accessToken}`,
          'Xero-Tenant-Id': tenantId,
          Accept: 'application/json',
        },
      );
      if (res.ok) {
        const data = await res.json();
        for (const contact of (data.Contacts ?? [])) {
          const groups = (contact.ContactGroups ?? [])
            .map((g: { Name: string }) => g.Name)
            .filter(Boolean)
            .join(', ');
          results.set(contact.ContactID, groups);
        }
      }
    } catch (err) {
      console.warn('Contact group fetch failed (non-fatal):', err instanceof Error ? err.message : err);
    }

    if (i + BATCH_SIZE < unique.length) {
      await new Promise(resolve => setTimeout(resolve, XERO_PAGE_DELAY_MS));
    }
  }
  return results;
}

// ─── Transactions ────────────────────────────────────────────────────────────

export interface XeroLineItem {
  LineItemID?: string;
  Description: string;
  Quantity: number;
  UnitAmount: number;
  TaxAmount: number;
  LineAmount: number;
  AccountCode: string;
  TaxType?: string;
  DiscountRate?: number;
  DiscountAmount?: number;
  ItemCode?: string;
  Tracking?: { Name: string; Option: string }[];
}

export interface XeroTransaction {
  BankTransactionID?: string;
  InvoiceID?: string;
  InvoiceNumber?: string;
  HasAttachments?: boolean;
  Type: string;
  Status?: string;
  Date: string;
  DueDate?: string;
  ExpectedPaymentDate?: string;
  Reference?: string;
  CurrencyCode?: string;
  CurrencyRate?: number;
  UpdatedDateUTC?: string;
  FullyPaidOnDate?: string;
  Url?: string;
  SourceTransactionID?: string;
  LineAmountTypes?: string;
  SentToContact?: boolean;
  RepeatingInvoiceID?: string;
  BrandingThemeID?: string;
  Contact?: { Name: string; ContactID: string };
  SubTotal: number;
  TotalTax: number;
  Total: number;
  AmountDue?: number;
  AmountPaid?: number;
  AmountCredited?: number;
  IsReconciled?: boolean;
  BankAccount?: { AccountID: string; Name: string; Code: string };
  Payments?: { PaymentID: string; Date: string; Amount: number; Reference?: string }[];
  CreditNotes?: { CreditNoteID: string; CreditNoteNumber: string; Total: number }[];
  Overpayments?: { OverpaymentID: string; Total: number }[];
  Prepayments?: { PrepaymentID: string; Total: number }[];
  LineItems: XeroLineItem[];
}

export async function getTransactions(
  clientId: string,
  accountCodes: string[],
  dateFrom: string,
  dateTo: string,
): Promise<XeroTransaction[]> {
  const whereClause = [
    `Date >= DateTime(${dateFrom.replace(/-/g, ',')})`,
    `Date <= DateTime(${dateTo.replace(/-/g, ',')})`,
  ].join(' AND ');

  // Fetch sequentially to avoid doubling API rate
  // Pass clientId so token is refreshed per-page if needed during long fetches
  const invoices = await fetchPaginated(`${XERO_API_BASE}/Invoices`, clientId, whereClause);
  const bankTxns = await fetchPaginated(`${XERO_API_BASE}/BankTransactions`, clientId, whereClause);

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

// ─── History & Notes ─────────────────────────────────────────────────────────

export interface XeroHistoryRecord {
  Changes: string;
  DateUTCString: string;
  DateUTC: string;
  User: string;
  Details: string;
}

export async function getTransactionHistory(
  clientId: string,
  endpoint: 'Invoices' | 'BankTransactions',
  transactionId: string,
): Promise<XeroHistoryRecord[]> {
  const { accessToken, tenantId } = await getValidAccessToken(clientId);
  const url = `${XERO_API_BASE}/${endpoint}/${transactionId}/History`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Xero-Tenant-Id': tenantId,
    Accept: 'application/json',
  };
  const res = await xeroFetchWithRetry(url, headers);
  if (!res.ok) {
    console.warn(`Xero history fetch failed (${res.status}) for ${endpoint}/${transactionId}`);
    return [];
  }
  const data = await res.json();
  return data.HistoryRecords ?? [];
}

export interface TransactionAuditInfo {
  createdBy: string;
  approvedBy: string;
}

export async function batchFetchHistories(
  clientId: string,
  transactions: { id: string; type: 'Invoice' | 'BankTransaction' }[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, TransactionAuditInfo>> {
  const results = new Map<string, TransactionAuditInfo>();
  const uniqueTxns = new Map<string, 'Invoice' | 'BankTransaction'>();
  for (const t of transactions) {
    if (t.id && !uniqueTxns.has(t.id)) uniqueTxns.set(t.id, t.type);
  }

  const entries = Array.from(uniqueTxns.entries());

  // Xero limits: 60 calls/min, 5 concurrent.
  // Use X-MinLimit-Remaining header to pace dynamically.
  const BATCH = 5;
  let consecutiveFailures = 0;
  let completed = 0;
  const queue = [...entries];

  while (queue.length > 0) {
    if (consecutiveFailures >= 10) {
      console.error(`[Xero] 10 consecutive failures — stopping. ${completed}/${entries.length} done.`);
      break;
    }

    const batch = queue.splice(0, BATCH);

    const batchResults = await Promise.all(batch.map(async ([id, type]) => {
      const endpoint = type === 'Invoice' ? 'Invoices' : 'BankTransactions';
      try {
        const history = await getTransactionHistory(clientId, endpoint, id);
        let createdBy = '';
        let approvedBy = '';
        for (const record of history) {
          const changes = (record.Changes || '').toLowerCase();
          if (changes.includes('created') || changes.includes('submitted')) {
            if (!createdBy) createdBy = record.User || '';
          }
          if (changes.includes('approved') || changes.includes('authorised')) {
            approvedBy = record.User || '';
          }
        }
        results.set(id, { createdBy, approvedBy });
        return 'ok';
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('429') || msg.includes('rate')) return 'rate-limited';
        results.set(id, { createdBy: '', approvedBy: '' });
        return 'error';
      }
    }));

    const rateLimitCount = batchResults.filter(r => r === 'rate-limited').length;
    const okCount = batchResults.filter(r => r === 'ok').length;

    if (rateLimitCount > 0) {
      // Put failed items back and wait longer
      const failedEntries = batch.slice(batch.length - rateLimitCount);
      queue.unshift(...failedEntries);
      consecutiveFailures += rateLimitCount;
      console.warn(`[Xero] ${rateLimitCount} rate-limited, waiting 5s before retry`);
      await new Promise(r => setTimeout(r, 5000));
    } else {
      consecutiveFailures = 0;
    }

    completed += okCount + batchResults.filter(r => r === 'error').length;
    if (onProgress) onProgress(completed, entries.length);

    if (queue.length > 0 && rateLimitCount === 0) {
      // Pace based on remaining quota: fast when plenty left, slow when running low
      const remaining = getXeroRateRemaining();
      const delayMs = remaining > 30 ? 500 : remaining > 10 ? 1500 : 3000;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  if (onProgress) onProgress(entries.length, entries.length);

  return results;
}

// ─── Attachments ──────────────────────────────────────────────────────────────

export interface XeroAttachment {
  AttachmentID: string;
  FileName: string;
  MimeType: string;
  ContentLength: number;
  Url: string;
}

export async function getAttachmentsList(
  clientId: string,
  endpoint: 'Invoices' | 'BankTransactions',
  transactionId: string,
): Promise<XeroAttachment[]> {
  const { accessToken, tenantId } = await getValidAccessToken(clientId);
  const url = `${XERO_API_BASE}/${endpoint}/${transactionId}/Attachments`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Xero-Tenant-Id': tenantId,
    Accept: 'application/json',
  };
  const res = await xeroFetchWithRetry(url, headers);
  if (!res.ok) throw new Error(`Xero attachments list failed (${res.status}) for ${endpoint}/${transactionId}`);
  const data = await res.json();
  return data.Attachments ?? [];
}

export async function downloadAttachment(
  clientId: string,
  endpoint: 'Invoices' | 'BankTransactions',
  transactionId: string,
  fileName: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const { accessToken, tenantId } = await getValidAccessToken(clientId);
  const url = `${XERO_API_BASE}/${endpoint}/${transactionId}/Attachments/${encodeURIComponent(fileName)}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Xero-Tenant-Id': tenantId,
    Accept: 'application/octet-stream',
  };
  const res = await xeroFetchWithRetry(url, headers);
  if (!res.ok) throw new Error(`Xero attachment download failed (${res.status}) for ${fileName}`);
  const arrayBuffer = await res.arrayBuffer();
  const mimeType = res.headers.get('content-type') || 'application/octet-stream';
  return { buffer: Buffer.from(arrayBuffer), mimeType };
}

// Track remaining API calls from Xero headers
let xeroMinLimitRemaining = 60;

export function getXeroRateRemaining(): number {
  return xeroMinLimitRemaining;
}

async function xeroFetchWithRetry(
  url: string,
  headers: Record<string, string>,
  maxRetries = 20,
): Promise<Response> {
  const urlPath = url.replace(/^https?:\/\/[^/]+/, '');

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const callStart = Date.now();
    const res = await fetch(url, { headers });
    const callMs = Date.now() - callStart;

    // Track rate limit headers
    const remaining = res.headers.get('X-MinLimit-Remaining');
    if (remaining) xeroMinLimitRemaining = parseInt(remaining, 10);

    if (res.status === 401) {
      console.error(`[Xero] 401 on ${urlPath} in ${callMs}ms — token expired`);
      throw new Error(`Xero token expired (401) on ${urlPath} — will refresh and retry`);
    }

    if (res.status !== 429) {
      if (res.ok) {
        console.log(`[Xero] ${res.status} on ${urlPath} in ${callMs}ms (remaining=${remaining ?? '?'})`);
      } else {
        console.warn(`[Xero] ${res.status} on ${urlPath} in ${callMs}ms`);
      }
      return res;
    }

    if (attempt === maxRetries) {
      // Exhausted all retries — throw so callers get a clear error
      throw new Error(`Xero rate limit exceeded after ${maxRetries} retries on ${urlPath}. Please wait a minute and try again.`);
    }

    // Use Retry-After header if available, otherwise exponential backoff
    const retryAfter = res.headers.get('Retry-After');
    const serverWaitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 0;
    // Start at 5s, ramp up to 60s — Xero's minute window needs real waiting
    const backoffMs = Math.min(5000 * Math.pow(1.3, attempt), 60000);
    const waitMs = Math.max(serverWaitMs || backoffMs, 3000);

    console.log(`[Xero] 429 on ${urlPath}, retry ${attempt + 1}/${maxRetries} in ${Math.round(waitMs / 1000)}s (remaining=${xeroMinLimitRemaining})`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }

  throw new Error('Unreachable');
}

const XERO_PAGE_DELAY_MS = 1200; // Xero allows ~60 calls/min; 1.2s between calls = ~50/min (safe margin)

async function fetchPaginated(
  url: string,
  clientId: string,
  where: string,
): Promise<XeroTransaction[]> {
  const results: XeroTransaction[] = [];
  let page = 1;

  while (true) {
    if (page > 1) {
      await new Promise(resolve => setTimeout(resolve, XERO_PAGE_DELAY_MS));
    }

    // Get a fresh token each page — handles token expiry during long fetches with 429 retries
    const { accessToken, tenantId } = await getValidAccessToken(clientId);
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Xero-Tenant-Id': tenantId,
      Accept: 'application/json',
    };

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
