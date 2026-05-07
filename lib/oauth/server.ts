// Helpers for the Acumon OAuth 2.1 server (used only by the
// /api/oauth/* and /.well-known/oauth-* endpoints, plus /api/mcp for
// bearer validation). Not a generic OAuth library — only implements
// what MCP custom-integration clients (claude.ai, Cowork CLI) need.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/db';

// ─── Token / code generation ─────────────────────────────────────────

/** 256 bits of entropy, base64url-encoded → 43 chars. */
export function newRandomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256, base64url-encoded. Used to store tokens at rest. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('base64url');
}

/** PKCE — verify a `code_verifier` against a stored `code_challenge`. */
export function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method !== 'S256') return false;
  const computed = createHash('sha256').update(verifier).digest('base64url');
  if (computed.length !== challenge.length) return false;
  return timingSafeEqual(Buffer.from(computed), Buffer.from(challenge));
}

// ─── Token issuance ──────────────────────────────────────────────────

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface IssueTokensInput {
  clientId: string;
  userId: string;
  firmId: string;
  scope?: string | null;
  resource?: string | null;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}

export async function issueTokens(input: IssueTokensInput): Promise<IssuedTokens> {
  const accessToken = newRandomToken();
  const refreshToken = newRandomToken();
  const now = Date.now();
  await prisma.oAuthAccessToken.create({
    data: {
      tokenHash: hashToken(accessToken),
      refreshTokenHash: hashToken(refreshToken),
      clientId: input.clientId,
      userId: input.userId,
      firmId: input.firmId,
      scope: input.scope || null,
      resource: input.resource || null,
      expiresAt: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000),
      refreshTokenExpiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000),
    },
  });
  return { accessToken, refreshToken, accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

/** Rotate: issue a new pair and revoke the old one. */
export async function rotateRefreshToken(
  oldRefreshToken: string,
): Promise<IssuedTokens & { userId: string; firmId: string; clientId: string }> {
  const oldHash = hashToken(oldRefreshToken);
  const existing = await prisma.oAuthAccessToken.findUnique({ where: { refreshTokenHash: oldHash } });
  if (!existing) throw new OAuthError('invalid_grant', 'Unknown refresh token');
  if (existing.revokedAt) throw new OAuthError('invalid_grant', 'Refresh token revoked');
  if (existing.refreshTokenExpiresAt && existing.refreshTokenExpiresAt < new Date()) {
    throw new OAuthError('invalid_grant', 'Refresh token expired');
  }
  // Mark old revoked first to close the window for replay.
  await prisma.oAuthAccessToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });
  const newPair = await issueTokens({
    clientId: existing.clientId,
    userId: existing.userId,
    firmId: existing.firmId,
    scope: existing.scope,
    resource: existing.resource,
  });
  return { ...newPair, userId: existing.userId, firmId: existing.firmId, clientId: existing.clientId };
}

// ─── Bearer validation (used by /api/mcp) ────────────────────────────

export interface ValidatedBearer {
  userId: string;
  firmId: string;
  clientId: string;
  scope: string | null;
}

export async function validateBearer(rawToken: string): Promise<ValidatedBearer | null> {
  if (!rawToken) return null;
  const row = await prisma.oAuthAccessToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt < new Date()) return null;
  return {
    userId: row.userId,
    firmId: row.firmId,
    clientId: row.clientId,
    scope: row.scope,
  };
}

// ─── OAuth error ─────────────────────────────────────────────────────

export class OAuthError extends Error {
  constructor(
    public readonly code:
      | 'invalid_request'
      | 'invalid_client'
      | 'invalid_grant'
      | 'unauthorized_client'
      | 'unsupported_grant_type'
      | 'invalid_scope'
      | 'access_denied'
      | 'server_error',
    message: string,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

// ─── Misc ────────────────────────────────────────────────────────────

export function getBaseUrl(req: Request): string {
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  return `${proto}://${host}`;
}
