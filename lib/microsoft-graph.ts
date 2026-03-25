/**
 * Microsoft Graph API client using client credentials flow.
 * Fetches users from the firm's Azure AD tenant.
 */

export interface ADUser {
  id: string;               // Azure Object ID
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
  jobTitle: string | null;
  department: string | null;
  mobilePhone: string | null;
  businessPhones: string[];
  employeeId: string | null;
  officeLocation: string | null;
  accountEnabled: boolean;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface GraphUsersResponse {
  value: ADUser[];
  '@odata.nextLink'?: string;
}

// Cache token to avoid requesting a new one on every call
let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Get an access token using client credentials flow (app-level, no user context).
 */
async function getClientCredentialsToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.token;
  }

  const tenantId = process.env.AZURE_AD_TENANT_ID;
  const clientId = process.env.AZURE_AD_CLIENT_ID;
  const clientSecret = process.env.AZURE_AD_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Missing Azure AD configuration: AZURE_AD_TENANT_ID, AZURE_AD_CLIENT_ID, AZURE_AD_CLIENT_SECRET');
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to get Azure AD token: ${res.status} ${err}`);
  }

  const data: TokenResponse = await res.json();

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}

/**
 * Fetch all active users from the Azure AD tenant.
 * Handles pagination automatically.
 */
export async function fetchAllADUsers(): Promise<ADUser[]> {
  const token = await getClientCredentialsToken();

  const selectFields = [
    'id', 'displayName', 'mail', 'userPrincipalName', 'jobTitle',
    'department', 'mobilePhone', 'businessPhones', 'employeeId',
    'officeLocation', 'accountEnabled',
  ].join(',');

  let url: string | null = `https://graph.microsoft.com/v1.0/users?$select=${selectFields}&$top=999`;
  const allUsers: ADUser[] = [];

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Graph API error: ${res.status} ${err}`);
    }

    const data: GraphUsersResponse = await res.json();
    allUsers.push(...data.value);

    url = data['@odata.nextLink'] || null;
  }

  // Filter out disabled accounts
  return allUsers.filter(u => u.accountEnabled !== false);
}

/**
 * Fetch filtered AD users: Audit department + specific named users.
 * This is the primary sync function — only imports relevant users.
 * Only returns enabled (active) accounts.
 */
export async function fetchAuditDeptUsers(additionalEmails?: string[]): Promise<ADUser[]> {
  const allUsers = await fetchAllADUsers();

  // Default additional users to always include
  const alwaysIncludeEmails = new Set([
    ...(additionalEmails || []).map(e => e.toLowerCase()),
  ]);

  return allUsers.filter(user => {
    // Include if in the Audit department
    if (user.department?.toLowerCase().includes('audit')) return true;

    // Include if in the always-include list (by email or UPN)
    const email = (user.mail || user.userPrincipalName || '').toLowerCase();
    if (alwaysIncludeEmails.has(email)) return true;

    // Include by display name match for the always-include list
    const name = user.displayName?.toLowerCase() || '';
    for (const e of alwaysIncludeEmails) {
      // Match partial name if the email contains a name-like pattern
      const namePart = e.split('@')[0]?.replace(/[._]/g, ' ').toLowerCase();
      if (namePart && name.includes(namePart)) return true;
    }

    return false;
  });
}

/**
 * Fetch a single user by their Azure Object ID.
 */
export async function fetchADUser(objectId: string): Promise<ADUser | null> {
  const token = await getClientCredentialsToken();

  const selectFields = [
    'id', 'displayName', 'mail', 'userPrincipalName', 'jobTitle',
    'department', 'mobilePhone', 'businessPhones', 'employeeId',
    'officeLocation', 'accountEnabled',
  ].join(',');

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${objectId}?$select=${selectFields}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph API error: ${res.status} ${err}`);
  }

  return res.json();
}
