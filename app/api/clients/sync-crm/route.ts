import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fetchFilteredAccounts, type CRMOrganisation } from '@/lib/dynamics-crm';

interface SyncAction {
  action: 'create' | 'update' | 'unchanged';
  crmOrg: CRMOrganisation;
  dbClientId?: string;
  changes?: Record<string, { from: string | null; to: string | null }>;
}

async function computeSyncActions(firmId: string): Promise<SyncAction[]> {
  // Fetch accounts from Dynamics using the firm's client filter
  const crmOrgs = await fetchFilteredAccounts(firmId);

  // Get existing clients in this firm
  const dbClients = await prisma.client.findMany({
    where: { firmId },
    select: { id: true, clientName: true, crmAccountId: true, sector: true },
  });

  const byCrmId = new Map(dbClients.filter(c => c.crmAccountId).map(c => [c.crmAccountId!, c]));
  const byName = new Map(dbClients.map(c => [c.clientName.toLowerCase(), c]));

  const actions: SyncAction[] = [];

  for (const org of crmOrgs) {
    const dbClient = byCrmId.get(org.accountId) || byName.get(org.name.toLowerCase());

    if (dbClient) {
      const changes: Record<string, { from: string | null; to: string | null }> = {};
      if (!dbClient.crmAccountId) changes.crmAccountId = { from: null, to: org.accountId };
      if (org.industry && org.industry !== dbClient.sector) changes.sector = { from: dbClient.sector, to: org.industry };

      if (Object.keys(changes).length > 0) {
        actions.push({ action: 'update', crmOrg: org, dbClientId: dbClient.id, changes });
      } else {
        actions.push({ action: 'unchanged', crmOrg: org, dbClientId: dbClient.id });
      }
    } else {
      actions.push({ action: 'create', crmOrg: org });
    }
  }

  return actions;
}

// GET — Preview
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.isFirmAdmin && !session.user.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const actions = await computeSyncActions(session.user.firmId);

    return NextResponse.json({
      preview: true,
      summary: {
        create: actions.filter(a => a.action === 'create').length,
        update: actions.filter(a => a.action === 'update').length,
        unchanged: actions.filter(a => a.action === 'unchanged').length,
      },
      actions: actions.map(a => ({
        action: a.action,
        name: a.crmOrg.name,
        accountId: a.crmOrg.accountId,
        industry: a.crmOrg.industry,
        city: a.crmOrg.city,
        changes: a.changes,
      })),
    });
  } catch (err: any) {
    console.error('CRM sync preview error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch CRM clients' }, { status: 500 });
  }
}

// POST — Execute sync
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.isFirmAdmin && !session.user.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Parse exclusions
  let excludeIds: Set<string> = new Set();
  try {
    const body = await req.json();
    if (body.excludeAccountIds && Array.isArray(body.excludeAccountIds)) {
      excludeIds = new Set(body.excludeAccountIds);
    }
  } catch { /* no body */ }

  try {
    const allActions = await computeSyncActions(session.user.firmId);
    const actions = allActions.filter(a => !excludeIds.has(a.crmOrg.accountId));
    const firmId = session.user.firmId;
    const results = { created: 0, updated: 0, unchanged: 0 };

    for (const action of actions) {
      switch (action.action) {
        case 'create': {
          await prisma.client.create({
            data: {
              firmId,
              clientName: action.crmOrg.name,
              crmAccountId: action.crmOrg.accountId,
              sector: action.crmOrg.industry || null,
              contactName: null,
              contactEmail: action.crmOrg.email || null,
            },
          });
          results.created++;
          break;
        }
        case 'update': {
          if (action.dbClientId && action.changes) {
            const updateData: Record<string, any> = {};
            if (action.changes.crmAccountId) updateData.crmAccountId = action.changes.crmAccountId.to;
            if (action.changes.sector) updateData.sector = action.changes.sector.to;
            if (Object.keys(updateData).length > 0) {
              await prisma.client.update({ where: { id: action.dbClientId }, data: updateData });
            }
          }
          results.updated++;
          break;
        }
        case 'unchanged':
          results.unchanged++;
          break;
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (err: any) {
    console.error('CRM sync error:', err);
    return NextResponse.json({ error: err.message || 'Sync failed' }, { status: 500 });
  }
}
