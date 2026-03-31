import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

const LR_SPARQL_ENDPOINT = 'https://landregistry.data.gov.uk/landregistry/query';

/**
 * POST /api/aggregator-connectors/test
 * Test connectivity for a saved connector.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { connectorId, connectorType } = await req.json();

  let config: Record<string, string> = {};

  // Load config from DB if connectorId provided
  if (connectorId) {
    const record = await prisma.methodologyTemplate.findFirst({
      where: { id: connectorId, firmId: '__global__', templateType: 'aggregator_connector' },
    });
    if (!record) return NextResponse.json({ success: false, message: 'Connector not found' });
    const items = typeof record.items === 'object' && record.items !== null
      ? record.items as Record<string, unknown> : {};
    config = (items.config as Record<string, string>) || {};

    // Update test timestamp
    await prisma.methodologyTemplate.update({
      where: { id: connectorId },
      data: { items: { ...items, lastTestedAt: new Date().toISOString() } },
    });
  }

  try {
    const result = await testConnector(connectorType, config);

    // Update status
    if (connectorId) {
      const record = await prisma.methodologyTemplate.findFirst({ where: { id: connectorId } });
      const items = typeof record?.items === 'object' && record?.items !== null
        ? record.items as Record<string, unknown> : {};
      await prisma.methodologyTemplate.update({
        where: { id: connectorId },
        data: { items: { ...items, status: result.success ? 'active' : 'error', lastTestedAt: new Date().toISOString(), lastTestResult: result.message } },
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Test failed';
    return NextResponse.json({ success: false, message });
  }
}

async function testConnector(type: string, config: Record<string, string>): Promise<{ success: boolean; message: string }> {
  switch (type) {
    case 'hm_land_registry': {
      // Simple SPARQL ASK query to test connectivity
      const endpoint = config.endpoint || LR_SPARQL_ENDPOINT;
      const sparql = 'ASK { ?s ?p ?o } LIMIT 1';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/sparql-results+json' },
        body: `query=${encodeURIComponent(sparql)}`,
      });
      if (res.ok) return { success: true, message: 'Connected to HM Land Registry SPARQL endpoint' };
      return { success: false, message: `Land Registry returned ${res.status}` };
    }

    case 'companies_house': {
      if (!config.apiKey) return { success: false, message: 'API Key is required' };
      const res = await fetch('https://api.company-information.service.gov.uk/search/companies?q=test&items_per_page=1', {
        headers: { 'Authorization': `Basic ${Buffer.from(config.apiKey + ':').toString('base64')}` },
      });
      if (res.ok) return { success: true, message: 'Connected to Companies House API' };
      if (res.status === 401) return { success: false, message: 'Invalid API key' };
      return { success: false, message: `Companies House returned ${res.status}` };
    }

    case 'fca_register': {
      const endpoint = config.endpoint || 'https://register.fca.org.uk/services/V0.1';
      const res = await fetch(`${endpoint}/Firm?q=test&paginationDetails.limit=1`, {
        headers: { 'Accept': 'application/json' },
      });
      if (res.ok) return { success: true, message: 'Connected to FCA Register API' };
      return { success: false, message: `FCA Register returned ${res.status}` };
    }

    case 'xero':
    case 'sage':
    case 'quickbooks': {
      // OAuth connectors — validate credentials exist
      if (!config.clientId || !config.clientSecret) {
        return { success: false, message: 'Client ID and Client Secret are required' };
      }
      return { success: true, message: `${type} credentials saved. OAuth flow required to complete connection.` };
    }

    case 'hmrc': {
      if (!config.clientId || !config.clientSecret) {
        return { success: false, message: 'Client ID and Client Secret are required' };
      }
      const env = config.environment === 'production' ? 'api.service.hmrc.gov.uk' : 'test-api.service.hmrc.gov.uk';
      const res = await fetch(`https://${env}/hello/world`, {
        headers: { 'Accept': 'application/vnd.hmrc.1.0+json' },
      });
      if (res.ok) return { success: true, message: `Connected to HMRC ${config.environment || 'sandbox'} API` };
      return { success: false, message: `HMRC returned ${res.status}` };
    }

    case 'open_banking': {
      if (!config.clientId || !config.clientSecret) {
        return { success: false, message: 'Client ID and Client Secret are required' };
      }
      return { success: true, message: `${config.provider || 'Open Banking'} credentials saved. OAuth consent flow required.` };
    }

    case 'charity_commission': {
      if (!config.apiKey) return { success: false, message: 'API Key is required' };
      const res = await fetch('https://api.charitycommission.gov.uk/register/api/allcharitydetailsV2/0/1/0', {
        headers: { 'Ocp-Apim-Subscription-Key': config.apiKey },
      });
      if (res.ok) return { success: true, message: 'Connected to Charity Commission API' };
      if (res.status === 401) return { success: false, message: 'Invalid API key' };
      return { success: false, message: `Charity Commission returned ${res.status}` };
    }

    case 'confirmation_statement': {
      if (!config.username || !config.password) {
        return { success: false, message: 'Username and Password are required' };
      }
      return { success: true, message: 'Confirmation.com credentials saved. Connection verified on next use.' };
    }

    default:
      return { success: false, message: `Unknown connector type: ${type}` };
  }
}
