// Generic fetcher for cloud audit-software connectors. The recipe
// (base URL, auth scheme, endpoint paths) lives on
// CloudAuditConnector.config; the user's per-attempt CREDENTIALS are
// supplied at call-time and never persisted.
//
// IMPORTANT: this module makes no assumptions about any particular
// vendor's API. If a connector's `endpoints` is empty (e.g. the
// seeded MyWorkPapers stub before an admin has filled it in) the
// fetch fails fast with an explanatory error. We do not invent
// endpoint paths.

import type { CloudConnectorConfig, CloudConnectorEndpoint } from './types';

export interface CloudFetchCredentials {
  /** Bearer token, basic-auth pair, or API key — interpreted per authScheme. */
  token?: string;
  username?: string;
  password?: string;
  /** OAuth client credentials. */
  clientId?: string;
  clientSecret?: string;
}

export interface CloudFetchContext {
  clientName?: string;
  /** ISO YYYY-MM-DD. */
  periodEnd?: string;
  engagementId?: string;
  /** Caller-supplied additional substitutions. */
  extra?: Record<string, string>;
}

export class CloudConnectorError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'CloudConnectorError';
  }
}

function substitutePath(path: string, ctx: CloudFetchContext): string {
  let out = path;
  if (ctx.clientName) out = out.replaceAll('{clientName}', encodeURIComponent(ctx.clientName));
  if (ctx.periodEnd) out = out.replaceAll('{periodEnd}', encodeURIComponent(ctx.periodEnd));
  if (ctx.engagementId) out = out.replaceAll('{engagementId}', encodeURIComponent(ctx.engagementId));
  if (ctx.extra) {
    for (const [k, v] of Object.entries(ctx.extra)) {
      out = out.replaceAll(`{${k}}`, encodeURIComponent(v));
    }
  }
  return out;
}

async function buildAuthHeaders(
  config: CloudConnectorConfig,
  creds: CloudFetchCredentials,
): Promise<Record<string, string>> {
  switch (config.authScheme) {
    case 'bearer': {
      if (!creds.token) throw new CloudConnectorError('Bearer token required');
      return { Authorization: `Bearer ${creds.token}` };
    }
    case 'basic': {
      if (!creds.username || !creds.password) {
        throw new CloudConnectorError('Username + password required for basic auth');
      }
      const enc = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
      return { Authorization: `Basic ${enc}` };
    }
    case 'api_key': {
      if (!creds.token) throw new CloudConnectorError('API key required');
      const headerName = config.authConfig?.headerName || 'X-API-Key';
      return { [headerName]: creds.token };
    }
    case 'oauth2_client_credentials': {
      const tokenUrl = config.authConfig?.oauth2?.tokenUrl;
      if (!tokenUrl) throw new CloudConnectorError('OAuth2 token URL not configured on connector');
      if (!creds.clientId || !creds.clientSecret) {
        throw new CloudConnectorError('Client ID + Client Secret required for OAuth2');
      }
      const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          ...(config.authConfig?.oauth2?.scope ? { scope: config.authConfig.oauth2.scope } : {}),
        }).toString(),
      });
      if (!tokenRes.ok) {
        throw new CloudConnectorError(`OAuth2 token exchange failed: ${tokenRes.status}`, tokenRes.status);
      }
      const json = await tokenRes.json().catch(() => ({})) as { access_token?: string };
      if (!json.access_token) throw new CloudConnectorError('OAuth2 response missing access_token');
      return { Authorization: `Bearer ${json.access_token}` };
    }
    default:
      throw new CloudConnectorError(`Unsupported auth scheme: ${(config as { authScheme: string }).authScheme}`);
  }
}

function readJsonPath(obj: unknown, path?: string): unknown {
  if (!path) return obj;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

async function callEndpoint(
  config: CloudConnectorConfig,
  endpoint: CloudConnectorEndpoint,
  creds: CloudFetchCredentials,
  ctx: CloudFetchContext,
  body?: unknown,
): Promise<{ data: unknown; rawBytes?: ArrayBuffer; contentType?: string }> {
  if (!config.baseUrl) {
    throw new CloudConnectorError(
      'This connector has no base URL configured. A firm admin must complete the connection recipe before it can be used.',
    );
  }
  const url = config.baseUrl.replace(/\/+$/, '') + '/' + substitutePath(endpoint.path, ctx).replace(/^\/+/, '');
  const authHeaders = await buildAuthHeaders(config, creds);
  const res = await fetch(url, {
    method: endpoint.method,
    headers: {
      Accept: 'application/json',
      ...(endpoint.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders,
      ...(endpoint.headers || {}),
    },
    body: body !== undefined && endpoint.method === 'POST' ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new CloudConnectorError(
      `Connector call ${endpoint.method} ${endpoint.path} failed: ${res.status} ${text.slice(0, 200)}`,
      res.status,
    );
  }
  const contentType = res.headers.get('content-type') || undefined;
  if (contentType && /(zip|pdf|octet-stream|x-zip)/.test(contentType)) {
    const buf = await res.arrayBuffer();
    return { data: null, rawBytes: buf, contentType };
  }
  const json = await res.json().catch(() => ({}));
  return { data: readJsonPath(json, endpoint.jsonPath), contentType };
}

export interface CloudFetchResult {
  /** Structured prior-period data from listClients/fetchEngagement (when JSON). */
  data?: unknown;
  /** Binary archive bytes from downloadArchive (when zip/PDF). */
  archiveBytes?: ArrayBuffer;
  archiveContentType?: string;
  archiveSuggestedFileName?: string;
}

/** Pull a prior audit file from a configured connector. The behaviour
 *  is fully driven by which endpoints the connector recipe defines —
 *  we do not invent paths. If `downloadArchive` is set we use it
 *  (preferred — gives us the zip/PDF for the Prior Period archive
 *  section). Otherwise `fetchEngagement` returns structured JSON we
 *  pass straight to the AI extractor.
 */
export async function fetchPriorAuditFile(
  config: CloudConnectorConfig,
  creds: CloudFetchCredentials,
  ctx: CloudFetchContext,
): Promise<CloudFetchResult> {
  const dl = config.endpoints.downloadArchive;
  if (dl) {
    const { rawBytes, contentType } = await callEndpoint(config, dl, creds, ctx);
    return {
      archiveBytes: rawBytes,
      archiveContentType: contentType,
      archiveSuggestedFileName: ctx.clientName
        ? `${ctx.clientName} prior audit file`
        : 'prior-audit-file',
    };
  }
  const fe = config.endpoints.fetchEngagement;
  if (fe) {
    const { data } = await callEndpoint(config, fe, creds, ctx);
    return { data };
  }
  throw new CloudConnectorError(
    'Connector has neither downloadArchive nor fetchEngagement endpoint configured. '
    + 'A firm admin must add at least one before the connector can be used.',
  );
}
