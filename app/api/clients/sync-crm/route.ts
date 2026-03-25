import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fetchAuditClients, type CRMOrganisation } from '@/lib/dynamics-crm';

interface SyncAction {
  action: 'create' | 'update' | 'unchanged';
  crmOrg: CRMOrganisation;
  dbClientId?: string;
  changes?: Record<string, { from: string | null; to: string | null }>;
}

async function computeSyncActions(firmId: string): Promise<SyncAction[]> {
  // Fetch audit clients from Dynamics CRM
  const crmOrgs = await fetchAuditClients();

  // Get existing clients in this firm
  const dbClients = await prisma.client.findMany({
    where: { firmId },
    select: { id: true, clientName: true, crmAccountId: true },
  });

  // Index by CRM account ID and name
  const byCrmId = new Map(dbClients.filter(c => c.crmAccountId).map(c => [c.crmAccountId!, c]));
  const byName = new Map(dbClients.map(c => [c.clientName.toLowerCase(), c]));

  const actions: SyncAction[] = [];

  for (const org of crmOrgs) {
    const dbClient = byCrmId.get(org.accountId) || byName.get(org.name.toLowerCase());

    if (dbClient) {
      const changes: Record<string, { from: string | null; to: string | null }> = {};
      if (!dbClient.crmAccountId) changes.crmAccountId = { from: null, to: org.accountId };

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
        changes: a.changes,
      })),
    });
  } catch (err: any) {
    console.error('CRM sync preview error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch CRM clients' }, { status: 500 });
  }
}

// POST — Execute sync
export async function POST() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.isFirmAdmin && !session.user.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const actions = await computeSyncActions(session.user.firmId);
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
            },
          });
          results.created++;
          break;
        }
        case 'update': {
          if (action.dbClientId) {
            const updateData: Record<string, any> = {};
            if (action.changes?.crmAccountId) updateData.crmAccountId = action.changes.crmAccountId.to;
            if (Object.keys(updateData).length > 0) {
              await prisma.client.update({
                where: { id: action.dbClientId },
                data: updateData,
              });
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
