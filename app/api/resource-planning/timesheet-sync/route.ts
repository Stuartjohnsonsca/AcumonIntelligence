/**
 * Timesheet hours sync — called by the Resources page on load.
 * Fetches jca_totalunits from Dynamics CRM and updates ResourceJob.timesheetHours.
 * Runs at most once per 24 hours to keep the page fast.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { crmGetRaw } from '@/lib/dynamics-crm';

const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.firmId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const firmId = session.user.firmId;

  // Check if a sync has already run in the last 24 hours
  const firm = await prisma.firm.findUnique({
    where: { id: firmId },
    select: { timesheetLastSyncedAt: true, powerAppsBaseUrl: true },
  });

  if (!firm?.powerAppsBaseUrl) {
    // No CRM configured — nothing to sync
    return Response.json({ synced: false, reason: 'No CRM configured' });
  }

  if (firm.timesheetLastSyncedAt) {
    const age = Date.now() - firm.timesheetLastSyncedAt.getTime();
    if (age < SYNC_INTERVAL_MS) {
      return Response.json({
        synced: false,
        reason: 'Already synced today',
        nextSyncIn: Math.round((SYNC_INTERVAL_MS - age) / 60000) + ' minutes',
      });
    }
  }

  // Fetch jca_totalunits for all jobs from CRM
  let updated = 0;
  let errors = 0;

  try {
    const data = await crmGetRaw<{ value: Array<{ jca_jobid: string; jca_totalunits: number | null }> }>(
      firmId,
      'jca_jobs?$select=jca_jobid,jca_totalunits&$top=5000',
    );

    const jobUnitsMap = new Map<string, number>();
    for (const row of data.value ?? []) {
      if (row.jca_jobid && row.jca_totalunits !== null && row.jca_totalunits !== undefined) {
        jobUnitsMap.set(row.jca_jobid, row.jca_totalunits);
      }
    }

    // Update ResourceJob records in batches
    const jobsInDb = await prisma.resourceJob.findMany({
      where: { firmId, crmJobId: { not: null } },
      select: { id: true, crmJobId: true },
    });

    for (const job of jobsInDb) {
      const units = jobUnitsMap.get(job.crmJobId!);
      if (units === undefined) continue;
      try {
        await prisma.resourceJob.update({
          where: { id: job.id },
          data: { timesheetHours: units * 10 },
        });
        updated++;
      } catch {
        errors++;
      }
    }

    // Record sync timestamp
    await prisma.firm.update({
      where: { id: firmId },
      data: { timesheetLastSyncedAt: new Date() },
    });

    console.log(`[timesheet-sync] Updated ${updated} jobs, ${errors} errors`);
    return Response.json({ synced: true, updated, errors });
  } catch (err: any) {
    console.error('[timesheet-sync] CRM fetch failed:', err.message);
    return Response.json({ synced: false, reason: err.message }, { status: 200 }); // 200 so client doesn't retry
  }
}
