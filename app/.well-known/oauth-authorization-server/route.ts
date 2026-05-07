import { NextResponse } from 'next/server';
import { getBaseUrl } from '@/lib/oauth/server';

// RFC 8414 — OAuth 2.0 Authorization Server Metadata
// Discovered automatically by MCP custom-integration clients
// (claude.ai's connector UI, Cowork CLI, etc.).
export async function GET(req: Request) {
  const base = getBaseUrl(req);
  return NextResponse.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    scopes_supported: ['mcp'],
  });
}
