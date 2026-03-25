/**
 * Dynamics 365 / Power Apps CRM client.
 * Connects to the firm's CRM to pull audit clients from Jobs.
 *
 * Filters: Organisations with uncompleted Jobs where ServiceTypeGroup
 * contains AUD, AUDIT, Assurance, or Internal.
 */

export interface CRMOrganisation {
  accountId: string;
  name: string;
  // Extended fields from account entity
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

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

// Token cache
let cachedToken: { token: string; expiresAt: number } | null = null;

const CRM_BASE_URL = process.env.DYNAMICS_CRM_BASE_URL || 'https://org4572af51.crm11.dynamics.com';
const CRM_CLIENT_ID = process.env.DYNAMICS_CRM_CLIENT_ID || '';
const CRM_CLIENT_SECRET = process.env.DYNAMICS_CRM_CLIENT_SECRET || '';
const CRM_TENANT_ID = process.env.DYNAMICS_CRM_TENANT_ID || process.env.AZURE_AD_TENANT_ID || '';

// Service type group keywords that indicate audit/assurance work
const AUDIT_KEYWORDS = ['aud', 'audit', 'assurance', 'internal'];

/**
 * Get access token for Dynamics CRM using client credentials flow.
 */
async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.token;
  }

  if (!CRM_CLIENT_ID || !CRM_CLIENT_SECRET || !CRM_TENANT_ID) {
    throw new Error('Missing Dynamics CRM configuration: DYNAMICS_CRM_CLIENT_ID, DYNAMICS_CRM_CLIENT_SECRET, DYNAMICS_CRM_TENANT_ID');
  }

  const tokenUrl = `https://login.microsoftonline.com/${CRM_TENANT_ID}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: CRM_CLIENT_ID,
    client_secret: CRM_CLIENT_SECRET,
    scope: `${CRM_BASE_URL}/.default`,
    grant_type: 'client_credentials',
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to get Dynamics CRM token: ${res.status} ${err}`);
  }

  const data: TokenResponse = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

/**
 * Make a GET request to the Dynamics Web API.
 */
async function crmGet<T>(path: string): Promise<T> {
  const token = await getToken();
  const url = `${CRM_BASE_URL}/api/data/v9.2/${path}`;

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

/**
 * Fetch all service groups that match audit/assurance keywords.
 */
export async function fetchAuditServiceGroups(): Promise<{ id: string; name: string }[]> {
  const data = await crmGet<{ value: Array<{ jca_servicegroupreferenceid: string; jca_servicegroup: string }> }>(
    'jca_servicegroupreferences?$select=jca_servicegroup,jca_servicegroupreferenceid'
  );

  return data.value
    .filter(sg => {
      const name = (sg.jca_servicegroup || '').toLowerCase();
      return AUDIT_KEYWORDS.some(kw => name.includes(kw));
    })
    .map(sg => ({ id: sg.jca_servicegroupreferenceid, name: sg.jca_servicegroup }));
}

/**
 * Fetch uncompleted jobs. Optionally filter by service type keywords.
 * Returns jobs where jca_completed = false and service type matches audit keywords.
 */
export async function fetchUncompletedAuditJobs(): Promise<CRMJob[]> {
  // Fetch all uncompleted jobs
  const data = await crmGet<{ value: Array<Record<string, any>> }>(
    `jca_jobs?$filter=jca_completed eq false&$select=jca_jobid,jca_name,jca_customername,jca_clientguid,jca_jobtyperef,jca_completed,jca_startdate,jca_completiondate,jca_budget,jca_year&$top=5000`
  );

  // Filter by service type containing audit keywords
  // jca_jobtyperef contains the service type name as text
  const auditJobs = data.value.filter(job => {
    const serviceType = (job.jca_jobtyperef || '').toLowerCase();
    return AUDIT_KEYWORDS.some(kw => serviceType.includes(kw));
  });

  return auditJobs.map(job => ({
    jobId: job.jca_jobid,
    name: job.jca_name,
    clientName: job.jca_customername || '',
    clientGuid: job.jca_clientguid || '',
    serviceType: job.jca_jobtyperef || '',
    serviceGroup: '', // Would need join to service group table
    completed: job.jca_completed || false,
    startDate: job.jca_startdate || null,
    completionDate: job.jca_completiondate || null,
    budget: job.jca_budget || null,
    year: job.jca_year || null,
  }));
}

/**
 * Fetch account (organisation) details by ID.
 */
export async function fetchAccount(accountId: string): Promise<CRMOrganisation | null> {
  try {
    const data = await crmGet<Record<string, any>>(
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
  } catch {
    return null;
  }
}

/**
 * Main sync function: Find all organisations with uncompleted audit jobs.
 * Returns unique organisations that should be clients.
 */
export async function fetchAuditClients(): Promise<CRMOrganisation[]> {
  const jobs = await fetchUncompletedAuditJobs();

  // Get unique client GUIDs
  const uniqueClientGuids = [...new Set(jobs.map(j => j.clientGuid).filter(Boolean))];

  if (uniqueClientGuids.length === 0) return [];

  // Fetch account details for each unique client
  const accounts = await Promise.all(
    uniqueClientGuids.map(guid => fetchAccount(guid))
  );

  return accounts.filter((a): a is CRMOrganisation => a !== null);
}
