// RFC 7591 — OAuth 2.0 Dynamic Client Registration
// Called by MCP custom-integration clients (claude.ai, Cowork CLI) the
// first time a user adds the Acumon MCP server to their assistant. We
// only support `none` token-endpoint auth (PKCE-only public clients) —
// MCP clients today don't carry their own secrets to remote servers.

import { NextResponse } from 'next/server';
import { newRandomToken } from '@/lib/oauth/server';
import { prisma } from '@/lib/db';

interface RegistrationRequest {
  client_name?: string;
  redirect_uris?: string[];
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  scope?: string;
}

function isHttpsOrLocalhost(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]')) return true;
    return false;
  } catch { return false; }
}

export async function POST(req: Request) {
  let body: RegistrationRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_client_metadata', error_description: 'Body must be JSON' }, { status: 400 });
  }

  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (redirectUris.length === 0) {
    return NextResponse.json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris required' }, { status: 400 });
  }
  for (const uri of redirectUris) {
    if (typeof uri !== 'string' || !isHttpsOrLocalhost(uri)) {
      return NextResponse.json({ error: 'invalid_redirect_uri', error_description: `Bad redirect_uri: ${uri}` }, { status: 400 });
    }
  }

  // Only PKCE-public clients are supported (token_endpoint_auth_method=none).
  const tokenAuthMethod = body.token_endpoint_auth_method || 'none';
  if (tokenAuthMethod !== 'none') {
    return NextResponse.json({
      error: 'invalid_client_metadata',
      error_description: 'Only token_endpoint_auth_method=none (PKCE) is supported',
    }, { status: 400 });
  }

  const grantTypes = Array.isArray(body.grant_types) && body.grant_types.length > 0
    ? body.grant_types
    : ['authorization_code', 'refresh_token'];
  for (const gt of grantTypes) {
    if (gt !== 'authorization_code' && gt !== 'refresh_token') {
      return NextResponse.json({
        error: 'invalid_client_metadata',
        error_description: `Unsupported grant_type: ${gt}`,
      }, { status: 400 });
    }
  }

  const clientId = newRandomToken();
  const created = await prisma.oAuthClient.create({
    data: {
      clientId,
      clientName: (body.client_name || 'MCP Client').slice(0, 200),
      redirectUris: redirectUris as unknown as object,
      tokenEndpointAuthMethod: tokenAuthMethod,
      grantTypes: grantTypes as unknown as object,
    },
  });

  return NextResponse.json({
    client_id: created.clientId,
    client_id_issued_at: Math.floor(created.createdAt.getTime() / 1000),
    client_name: created.clientName,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: tokenAuthMethod,
    grant_types: grantTypes,
    response_types: ['code'],
    scope: 'mcp',
  }, { status: 201 });
}
