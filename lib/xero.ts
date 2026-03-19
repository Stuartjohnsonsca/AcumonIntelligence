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
  Description?: string;
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
  const res = await fetch(`${XERO_API_BASE}/TaxRates`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Xero-Tenant-Id': tenantId,
      Accept: 'application/json',
    },
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
  const { accessToken, tenantId } = await getValidAccessToken(clientId);

  const whereClause = [
    `Date >= DateTime(${dateFrom.replace(/-/g, ',')})`,
    `Date <= DateTime(${dateTo.replace(/-/g, ',')})`,
  ].join(' AND ');

  // Fetch invoices and bank transactions in parallel
  const [invoices, bankTxns] = await Promise.all([
    fetchPaginated(`${XERO_API_BASE}/Invoices`, accessToken, tenantId, whereClause),
    fetchPaginated(`${XERO_API_BASE}/BankTransactions`, accessToken, tenantId, whereClause),
  ]);

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
  // Adaptive batch size: more transactions → larger batches to finish faster
  // Xero allows ~60 calls/min; stay within limits while maximizing throughput
  const batchSize = entries.length <= 20 ? 5
    : entries.length <= 100 ? 10
    : entries.length <= 300 ? 15
    : 20;
  let consecutiveErrors = 0;
  let currentDelay = XERO_PAGE_DELAY_MS;

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);

    const promises = batch.map(async ([id, type]) => {
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
        consecutiveErrors = 0;
      } catch (err) {
        results.set(id, { createdBy: '', approvedBy: '' });
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('429') || msg.includes('rate')) {
          consecutiveErrors++;
          currentDelay = Math.min(currentDelay * 2, 5000); // Back off on rate limits
        }
      }
    });

    await Promise.all(promises);

    const done = Math.min(i + batchSize, entries.length);
    if (onProgress) onProgress(done, entries.length);

    if (i + batchSize < entries.length) {
      if (consecutiveErrors === 0 && currentDelay > 200) {
        currentDelay = Math.max(200, Math.round(currentDelay * 0.8));
      }
      await new Promise(resolve => setTimeout(resolve, currentDelay));
    }
  }

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

const XERO_PAGE_DELAY_MS = 500; // Xero allows ~60 calls/min; 500ms is safe

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
