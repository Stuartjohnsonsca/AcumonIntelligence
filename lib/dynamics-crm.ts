/**
 * Dynamics 365 / Power Apps CRM client.
 *
 * Uses MSAL On-Behalf-Of (OBO) flow to authenticate:
 * 1. User signs in via Microsoft Entra ID (NextAuth stores their access token)
 * 2. Server exchanges that token for a Dynamics-scoped token via MSAL OBO
 * 3. Dynamics API calls use the delegated token (as the user)
 *
 * Falls back to client credentials if no user token is available.
 */

import { ConfidentialClientApplication } from '@azure/msal-node';
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

// Service type group keywords that indicate audit/assurance work
const AUDIT_KEYWORDS = ['aud', 'audit', 'assurance', 'internal'];

// MSAL app cache (per-firm)
const msalApps = new Map<string, ConfidentialClientApplication>();

/**
 * Get or create an MSAL ConfidentialClientApplication for a firm.
 * Uses the firm's PowerApps credentials or falls back to env vars.
 */
async function getMsalApp(firmId: string): Promise<{ app: ConfidentialClientApplication; baseUrl: string }> {
  if (msalApps.has(firmId)) {
    const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { powerAppsBaseUrl: true } });
    return { app: msalApps.get(firmId)!, baseUrl: firm?.powerAppsBaseUrl || '' };
  }

  const firm = await prisma.firm.findUnique({
    where: { id: firmId },
    select: {
      powerAppsClientId: true,
      powerAppsClientSecret: true,
      powerAppsBaseUrl: true,
      powerAppsTenantId: true,
    },
  });

  const clientId = firm?.powerAppsClientId || process.env.AZURE_AD_CLIENT_ID || '';
  const clientSecret = firm?.powerAppsClientSecret || process.env.AZURE_AD_CLIENT_SECRET || '';
  const tenantId = firm?.powerAppsTenantId || process.env.AZURE_AD_TENANT_ID || '';
  const baseUrl = firm?.powerAppsBaseUrl || process.env.DYNAMICS_CRM_BASE_URL || '';

  if (!clientId || !clientSecret || !tenantId) {
    throw new Error('Missing PowerApps/Dynamics CRM configuration for this firm');
  }

  const app = new ConfidentialClientApplication({
    auth: {
      clientId,
      clientSecret,
      authority: `https://login.microsoftonline.com/${tenantId}`,
    },
  });

  msalApps.set(firmId, app);
  return { app, baseUrl };
}

/**
 * Get a Dynamics CRM access token using MSAL.
 *
 * Strategy:
 * 1. If userAccessToken provided → OBO flow (delegated, acts as the user)
 * 2. Otherwise → Client Credentials flow (app-only)
 */
async function getDynamicsToken(firmId: string, userAccessToken?: string): Promise<string> {
  const { app, baseUrl } = await getMsalApp(firmId);
  const scope = `${baseUrl}/.default`;

  if (userAccessToken) {
    // On-Behalf-Of flow — exchange user's Entra ID token for Dynamics token
    try {
      const result = await app.acquireTokenOnBehalfOf({
        oboAssertion: userAccessToken,
        scopes: [scope],
      });
      if (result?.accessToken) return result.accessToken;
    } catch (oboErr: any) {
      console.warn('OBO flow failed, falling back to client credentials:', oboErr.message);
    }
  }

  // Client Credentials flow (fallback)
  const result = await app.acquireTokenByClientCredential({
    scopes: [scope],
  });

  if (!result?.accessToken) {
    throw new Error('Failed to acquire Dynamics CRM token via MSAL');
  }

  return result.accessToken;
}

/**
 * Make a GET request to the Dynamics Web API.
 */
async function crmGet<T>(firmId: string, path: string, userAccessToken?: string): Promise<T> {
  const token = await getDynamicsToken(firmId, userAccessToken);
  const { baseUrl } = await getMsalApp(firmId);
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

/**
 * Test the CRM connection. Returns WhoAmI data or an error.
 */
export async function testConnection(firmId: string, userAccessToken?: string): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const data = await crmGet(firmId, 'WhoAmI', userAccessToken);
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Fetch all service groups that match audit/assurance keywords.
 */
export async function fetchAuditServiceGroups(firmId: string, userAccessToken?: string): Promise<{ id: string; name: string }[]> {
  const data = await crmGet<{ value: Array<{ jca_servicegroupreferenceid: string; jca_servicegroup: string }> }>(
    firmId, 'jca_servicegroupreferences?$select=jca_servicegroup,jca_servicegroupreferenceid', userAccessToken
  );

  return data.value
    .filter(sg => {
      const name = (sg.jca_servicegroup || '').toLowerCase();
      return AUDIT_KEYWORDS.some(kw => name.includes(kw));
    })
    .map(sg => ({ id: sg.jca_servicegroupreferenceid, name: sg.jca_servicegroup }));
}

/**
 * Fetch uncompleted jobs filtered by audit keywords.
 */
export async function fetchUncompletedAuditJobs(firmId: string, userAccessToken?: string): Promise<CRMJob[]> {
  const data = await crmGet<{ value: Array<Record<string, any>> }>(
    firmId,
    `jca_jobs?$filter=jca_completed eq false&$select=jca_jobid,jca_name,jca_customername,jca_clientguid,jca_jobtyperef,jca_completed,jca_startdate,jca_completiondate,jca_budget,jca_year&$top=5000`,
    userAccessToken
  );

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
    serviceGroup: '',
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
export async function fetchAccount(firmId: string, accountId: string, userAccessToken?: string): Promise<CRMOrganisation | null> {
  try {
    const data = await crmGet<Record<string, any>>(
      firmId,
      `accounts(${accountId})?$select=name,accountid,address1_line1,address1_city,address1_postalcode,telephone1,emailaddress1,websiteurl,industrycode,sic`,
      userAccessToken
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
 */
export async function fetchAuditClients(firmId: string, userAccessToken?: string): Promise<CRMOrganisation[]> {
  const jobs = await fetchUncompletedAuditJobs(firmId, userAccessToken);
  const uniqueClientGuids = [...new Set(jobs.map(j => j.clientGuid).filter(Boolean))];
  if (uniqueClientGuids.length === 0) return [];

  const accounts = await Promise.all(
    uniqueClientGuids.map(guid => fetchAccount(firmId, guid, userAccessToken))
  );

  return accounts.filter((a): a is CRMOrganisation => a !== null);
}
