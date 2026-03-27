import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fetchFilteredAccountsWithJobs, type CRMOrganisation, type CRMJobRaw } from '@/lib/dynamics-crm';

interface SyncAction {
  action: 'create' | 'update' | 'unchanged';
  crmOrg: CRMOrganisation;
  dbClientId?: string;
  changes?: Record<string, { from: string | null; to: string | null }>;
}

let cachedJobs: CRMJobRaw[] = [];

async function computeSyncActions(firmId: string): Promise<SyncAction[]> {
  // Fetch accounts and jobs from Dynamics using the firm's client filter
  const { clients: crmOrgs, jobs } = await fetchFilteredAccountsWithJobs(firmId);
  cachedJobs = jobs;

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
          // Only use real GUIDs as crmAccountId, not job-prefixed placeholders
          const crmId = action.crmOrg.accountId.startsWith('job-') ? null : action.crmOrg.accountId;
          try {
            if (crmId) {
              // Upsert by crmAccountId to avoid unique constraint violations
              await prisma.client.upsert({
                where: { crmAccountId: crmId },
                create: {
                  firmId,
                  clientName: action.crmOrg.name,
                  crmAccountId: crmId,
                  sector: action.crmOrg.industry || null,
                  contactName: null,
                  contactEmail: action.crmOrg.email || null,
                },
                update: {
                  clientName: action.crmOrg.name,
                  sector: action.crmOrg.industry || undefined,
                },
              });
            } else {
              await prisma.client.create({
                data: {
                  firmId,
                  clientName: action.crmOrg.name,
                  crmAccountId: null,
                  sector: action.crmOrg.industry || null,
                  contactName: null,
                  contactEmail: action.crmOrg.email || null,
                },
              });
            }
            results.created++;
          } catch (err: any) {
            // Skip duplicate name errors gracefully
            if (err?.code === 'P2002') {
              results.unchanged++;
            } else {
              throw err;
            }
          }
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

    // Now create ResourceJob records for each CRM job
    // Map client names to their DB IDs
    const allClients = await prisma.client.findMany({
      where: { firmId },
      select: { id: true, clientName: true },
    });
    const clientByName = new Map(allClients.map(c => [c.clientName.toLowerCase(), c.id]));

    // Get existing ResourceJobs to avoid duplicates
    const existingJobs = await prisma.resourceJob.findMany({
      where: { firmId },
      select: { crmJobId: true },
    });
    const existingCrmJobIds = new Set(existingJobs.filter(j => j.crmJobId).map(j => j.crmJobId!));

    let jobsCreated = 0;
    for (const job of cachedJobs) {
      if (!job.jobId || existingCrmJobIds.has(job.jobId)) continue;

      const clientId = clientByName.get(job.clientName.toLowerCase());
      if (!clientId) continue;

      // Determine audit type from job type name
      const jobTypeLower = (job.jobType || '').toLowerCase();
      let auditType = 'SME'; // default
      if (jobTypeLower.includes('pie')) auditType = 'PIE';
      else if (jobTypeLower.includes('group')) auditType = 'GROUP';
      else if (jobTypeLower.includes('control')) auditType = jobTypeLower.includes('pie') ? 'PIE_CONTROLS' : 'SME_CONTROLS';

      // Use job year for period end, or current year — parseInt to handle string years from CRM
      const year = parseInt(String(job.year)) || new Date().getFullYear();
      const periodEnd = new Date(year, 11, 31); // Dec 31
      const targetCompletion = job.completionDate ? new Date(job.completionDate) : new Date(year + 1, 2, 31); // Mar 31 next year

      try {
        await prisma.resourceJob.create({
          data: {
            firmId,
            clientId,
            auditType,
            periodEnd,
            targetCompletion,
            budgetHoursSpecialist: 0,
            budgetHoursRI: 0,
            budgetHoursReviewer: 0,
            budgetHoursPreparer: job.budget || 0,
            crmJobId: job.jobId,
            schedulingStatus: 'unscheduled',
            customDeadline: job.firstCustomDeadline ? new Date(job.firstCustomDeadline) : null,
            complianceDeadline: job.firstStatutoryDeadline ? new Date(job.firstStatutoryDeadline) : null,
          },
        });
        jobsCreated++;
      } catch (err: any) {
        // Skip duplicates
        if (err?.code !== 'P2002') console.error('Job create error:', err.message);
      }
    }

    return NextResponse.json({ success: true, results: { ...results, jobsCreated } });
  } catch (err: any) {
    console.error('CRM sync error:', err);
    return NextResponse.json({ error: err.message || 'Sync failed' }, { status: 500 });
  }
}
