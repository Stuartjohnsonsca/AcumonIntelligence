/**
 * Dynamics 365 / Power Apps CRM client.
 *
 * Authentication: Client Credentials flow only.
 * Credentials stored per-firm in the Firm table.
 * MSAL is used only for user authentication to this app, NOT for Dataverse.
 */

import { prisma } from '@/lib/db';

export interface CRMOrganisation {
  accountId: string;
  name: string;
  address1?: string;
  city?: string;
  postcode?: string;
  telephone?: string;
  email?: string;
  websiteUrl?: string;
  industry?: string;
  sicCode?: string;
}

export interface CRMJob {
  jobId: string;
  name: string;
  clientName: string;
  clientGuid: string;
  serviceType: string;
  serviceGroup: string;
  completed: boolean;
  startDate: string | null;
  completionDate: string | null;
  budget: number | null;
  year: number | null;
}

const AUDIT_KEYWORDS = ['aud', 'audit', 'assurance', 'internal'];

// Token cache per firm
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

interface FirmCrmConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  tenantId: string;
  clientFilter: string | null;
}

async function getFirmCrmConfig(firmId: string): Promise<FirmCrmConfig> {
  const firm = await prisma.firm.findUnique({
    where: { id: firmId },
    select: { powerAppsClientId: true, powerAppsClientSecret: true, powerAppsBaseUrl: true, powerAppsTenantId: true, powerAppsClientFilter: true },
  });

  if (!firm?.powerAppsClientId || !firm?.powerAppsClientSecret || !firm?.powerAppsBaseUrl || !firm?.powerAppsTenantId) {
    throw new Error('PowerApps/Dynamics 365 is not configured for this firm. Go to Firm Settings to set up the connection.');
  }

  return {
    clientId: firm.powerAppsClientId,
    clientSecret: firm.powerAppsClientSecret,
    baseUrl: firm.powerAppsBaseUrl,
    tenantId: firm.powerAppsTenantId,
    clientFilter: firm.powerAppsClientFilter || null,
  };
}

/**
 * Get access token using client credentials flow.
 */
async function getToken(firmId: string): Promise<{ token: string; baseUrl: string }> {
  const cached = tokenCache.get(firmId);
  if (cached && Date.now() < cached.expiresAt - 60000) {
    const config = await getFirmCrmConfig(firmId);
    return { token: cached.token, baseUrl: config.baseUrl };
  }

  const config = await getFirmCrmConfig(firmId);
  const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: `${config.baseUrl}/.default`,
    grant_type: 'client_credentials',
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to get Dynamics token: ${res.status} ${err}`);
  }

  const data = await res.json();
  tokenCache.set(firmId, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return { token: data.access_token, baseUrl: config.baseUrl };
}

async function crmGet<T>(firmId: string, path: string): Promise<T> {
  const { token, baseUrl } = await getToken(firmId);
  const url = `${baseUrl}/api/data/v9.2/${path}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Accept: 'application/json',
      Prefer: 'odata.include-annotations=*',
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Dynamics CRM API error: ${res.status} ${err}`);
  }

  return res.json();
}

export async function testConnection(firmId: string): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const data = await crmGet(firmId, 'WhoAmI');
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function fetchAuditServiceGroups(firmId: string): Promise<{ id: string; name: string }[]> {
  const data = await crmGet<{ value: Array<{ jca_servicegroupreferenceid: string; jca_servicegroup: string }> }>(
    firmId, 'jca_servicegroupreferences?$select=jca_servicegroup,jca_servicegroupreferenceid'
  );
  return data.value
    .filter(sg => AUDIT_KEYWORDS.some(kw => (sg.jca_servicegroup || '').toLowerCase().includes(kw)))
    .map(sg => ({ id: sg.jca_servicegroupreferenceid, name: sg.jca_servicegroup }));
}

export async function fetchUncompletedAuditJobs(firmId: string): Promise<CRMJob[]> {
  const data = await crmGet<{ value: Array<Record<string, any>> }>(
    firmId,
    `jca_jobs?$filter=jca_completed eq false&$select=jca_jobid,jca_name,jca_customername,jca_clientguid,jca_jobtyperef,jca_completed,jca_startdate,jca_completiondate,jca_budget,jca_year&$top=5000`
  );

  return data.value
    .filter(job => AUDIT_KEYWORDS.some(kw => (job.jca_jobtyperef || '').toLowerCase().includes(kw)))
    .map(job => ({
      jobId: job.jca_jobid,
      name: job.jca_name,
      clientName: job.jca_customername || '',
      clientGuid: job.jca_clientguid || '',
      serviceType: job.jca_jobtyperef || '',
      serviceGroup: '',
      completed: job.jca_completed || false,
      startDate: job.jca_startdate || null,
      completionDate: job.jca_completiondate || null,
      budget: job.jca_budget || null,
      year: job.jca_year || null,
    }));
}

export async function fetchAccount(firmId: string, accountId: string): Promise<CRMOrganisation | null> {
  try {
    const data = await crmGet<Record<string, any>>(
      firmId,
      `accounts(${accountId})?$select=name,accountid,address1_line1,address1_city,address1_postalcode,telephone1,emailaddress1,websiteurl,industrycode,sic`
    );
    return {
      accountId: data.accountid,
      name: data.name,
      address1: data.address1_line1,
      city: data.address1_city,
      postcode: data.address1_postalcode,
      telephone: data.telephone1,
      email: data.emailaddress1,
      websiteUrl: data.websiteurl,
      industry: data['industrycode@OData.Community.Display.V1.FormattedValue'] || null,
      sicCode: data.sic,
    };
  } catch { return null; }
}

export async function fetchAuditClients(firmId: string): Promise<CRMOrganisation[]> {
  const jobs = await fetchUncompletedAuditJobs(firmId);
  const uniqueGuids = [...new Set(jobs.map(j => j.clientGuid).filter(Boolean))];
  if (uniqueGuids.length === 0) return [];
  const accounts = await Promise.all(uniqueGuids.map(guid => fetchAccount(firmId, guid)));
  return accounts.filter((a): a is CRMOrganisation => a !== null);
}

/**
 * Fetch accounts directly from Dataverse using the firm's client filter.
 * This is the primary import method — uses OData $filter from Firm settings.
 */
export async function fetchFilteredAccounts(firmId: string): Promise<CRMOrganisation[]> {
  const config = await getFirmCrmConfig(firmId);
  const select = 'name,accountid,address1_line1,address1_city,address1_postalcode,telephone1,emailaddress1,websiteurl,industrycode,sic';

  let path = `accounts?$select=${select}&$top=500`;
  if (config.clientFilter) {
    path += `&$filter=${encodeURIComponent(config.clientFilter)}`;
  }

  const data = await crmGet<{ value: Array<Record<string, any>> }>(firmId, path);

  return data.value.map(d => ({
    accountId: d.accountid,
    name: d.name,
    address1: d.address1_line1,
    city: d.address1_city,
    postcode: d.address1_postalcode,
    telephone: d.telephone1,
    email: d.emailaddress1,
    websiteUrl: d.websiteurl,
    industry: d['industrycode@OData.Community.Display.V1.FormattedValue'] || null,
    sicCode: d.sic,
  }));
}
