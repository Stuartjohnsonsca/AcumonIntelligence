/**
 * Strip secrets from network traces / arbitrary objects before sending to Claude.
 *
 * Header keys matching SENSITIVE_HEADER_PATTERN are replaced with '[REDACTED]'.
 * Body / object keys matching SENSITIVE_KEY_PATTERN are replaced with '[REDACTED]'.
 * Recurses into nested objects and arrays. Truncates strings over MAX_STRING_LEN.
 */

const SENSITIVE_HEADER_PATTERN = /^(authorization|cookie|set-cookie|x-api-key|x-auth-token|proxy-authorization)$/i;
const SENSITIVE_KEY_PATTERN = /(password|secret|token|apikey|api_key|client_secret|private_key|access_key|cookie|authorization)/i;
const MAX_STRING_LEN = 4000;
const MAX_DEPTH = 8;

export interface NetworkRequestRecord {
  url: string;
  method: string;
  status?: number;
  durationMs?: number;
  startedAt: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: unknown;
  responseBody?: unknown;
  errorMessage?: string;
}

export interface ConsoleEntry {
  level: 'log' | 'warn' | 'error';
  message: string;
  stack?: string;
  at: number;
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[MAX_DEPTH]';
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LEN ? value.slice(0, MAX_STRING_LEN) + '…[truncated]' : value;
  }
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redactValue(v, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redactValue(v, depth + 1);
    }
  }
  return out;
}

export function redactHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return headers;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADER_PATTERN.test(k) ? '[REDACTED]' : v;
  }
  return out;
}

export function redactNetworkTrace(trace: NetworkRequestRecord[] | undefined | null): NetworkRequestRecord[] {
  if (!Array.isArray(trace)) return [];
  return trace.slice(-50).map((req) => ({
    ...req,
    requestHeaders: redactHeaders(req.requestHeaders),
    responseHeaders: redactHeaders(req.responseHeaders),
    requestBody: req.requestBody !== undefined ? redactValue(req.requestBody) : undefined,
    responseBody: req.responseBody !== undefined ? redactValue(req.responseBody) : undefined,
  }));
}

export function redactConsole(entries: ConsoleEntry[] | undefined | null): ConsoleEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries.slice(-50).map((e) => ({
    ...e,
    message: typeof e.message === 'string' && e.message.length > MAX_STRING_LEN ? e.message.slice(0, MAX_STRING_LEN) : e.message,
  }));
}
