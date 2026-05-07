// POST /api/oauth/token
// RFC 6749 + RFC 7636 (PKCE) + RFC 6749 §6 (refresh).
// Accepts application/x-www-form-urlencoded per the OAuth standard.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { issueTokens, rotateRefreshToken, verifyPkce, OAuthError } from '@/lib/oauth/server';

function err(code: string, description: string, status = 400) {
  return NextResponse.json({ error: code, error_description: description }, { status });
}

export async function POST(req: Request) {
  let form: URLSearchParams;
  try {
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/x-www-form-urlencoded')) {
      form = new URLSearchParams(await req.text());
    } else if (contentType.includes('application/json')) {
      const body = await req.json();
      form = new URLSearchParams(Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)])));
    } else {
      return err('invalid_request', 'Content-Type must be application/x-www-form-urlencoded or application/json');
    }
  } catch {
    return err('invalid_request', 'Could not parse request body');
  }

  const grantType = form.get('grant_type') || '';
  const clientId = form.get('client_id') || '';

  if (!clientId) return err('invalid_client', 'client_id required');
  const client = await prisma.oAuthClient.findUnique({ where: { clientId } });
  if (!client) return err('invalid_client', 'Unknown client_id');

  // We only support PKCE-public clients (token_endpoint_auth_method=none),
  // so we don't validate client_secret here.

  try {
    if (grantType === 'authorization_code') {
      const code = form.get('code') || '';
      const codeVerifier = form.get('code_verifier') || '';
      const redirectUri = form.get('redirect_uri') || '';
      if (!code || !codeVerifier || !redirectUri) {
        return err('invalid_request', 'code, code_verifier and redirect_uri are required');
      }

      const stored = await prisma.oAuthAuthCode.findUnique({ where: { code } });
      if (!stored || stored.clientId !== clientId) return err('invalid_grant', 'Unknown auth code');
      if (stored.used) return err('invalid_grant', 'Auth code already used');
      if (stored.expiresAt < new Date()) return err('invalid_grant', 'Auth code expired');
      if (stored.redirectUri !== redirectUri) return err('invalid_grant', 'redirect_uri mismatch');
      if (!verifyPkce(codeVerifier, stored.codeChallenge, stored.codeChallengeMethod)) {
        return err('invalid_grant', 'PKCE verifier does not match');
      }

      // Mark code used (single-use) and issue tokens.
      await prisma.oAuthAuthCode.update({ where: { code }, data: { used: true } });
      const tokens = await issueTokens({
        clientId,
        userId: stored.userId,
        firmId: stored.firmId,
        scope: stored.scope,
        resource: stored.resource,
      });
      return NextResponse.json({
        access_token: tokens.accessToken,
        token_type: 'Bearer',
        expires_in: tokens.accessTokenExpiresIn,
        refresh_token: tokens.refreshToken,
        scope: stored.scope || 'mcp',
      });
    }

    if (grantType === 'refresh_token') {
      const refreshToken = form.get('refresh_token') || '';
      if (!refreshToken) return err('invalid_request', 'refresh_token required');
      const rotated = await rotateRefreshToken(refreshToken);
      if (rotated.clientId !== clientId) return err('invalid_grant', 'client_id does not match refresh token');
      return NextResponse.json({
        access_token: rotated.accessToken,
        token_type: 'Bearer',
        expires_in: rotated.accessTokenExpiresIn,
        refresh_token: rotated.refreshToken,
        scope: 'mcp',
      });
    }

    return err('unsupported_grant_type', `grant_type=${grantType} is not supported`);
  } catch (e) {
    if (e instanceof OAuthError) return err(e.code, e.message);
    console.error('[oauth/token] failure', e);
    return err('server_error', 'Token endpoint error', 500);
  }
}
