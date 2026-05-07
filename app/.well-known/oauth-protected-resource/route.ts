import { NextResponse } from 'next/server';
import { getBaseUrl } from '@/lib/oauth/server';

// MCP spec — protected resource metadata (RFC 9728-ish).
// Tells MCP clients which authorization server is allowed to issue
// tokens for this MCP endpoint.
export async function GET(req: Request) {
  const base = getBaseUrl(req);
  return NextResponse.json({
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    scopes_supported: ['mcp'],
    bearer_methods_supported: ['header'],
    resource_documentation: `${base}/methodology-admin/cloud-audit-connectors/mcp-setup`,
  });
}
