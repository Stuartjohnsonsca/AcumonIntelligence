import { prisma } from '@/lib/db';

/**
 * Sync audit jobs from CRM to the resource planning system.
 * Uses the existing dynamics-crm.ts integration.
 *
 * For now this is a stub that will be connected to the real CRM later.
 * The actual CRM functions are in lib/dynamics-crm.ts:
 * - fetchAuditServiceGroups()
 * - fetchUncompletedAuditJobs()
 * - fetchAuditClients()
 */

interface SyncResult {
  newJobs: number;
  completedJobs: number;
  updatedHours: number;
}

/**
 * Run a full CRM sync for a firm.
 * Called on page load and via POST /api/resource-planning/sync
 */
export async function syncFromCRM(firmId: string): Promise<SyncResult> {
  const result: SyncResult = { newJobs: 0, completedJobs: 0, updatedHours: 0 };

  try {
    // TODO: Connect to real CRM when credentials are configured
    // For now, check if any ResourceJobs exist without schedulingStatus set
    // and mark them appropriately

    // Mark jobs that have all allocations completed as 'scheduled'
    const jobs = await prisma.resourceJob.findMany({
      where: { firmId, schedulingStatus: 'unscheduled' },
      include: {
        client: { select: { clientName: true } },
      },
    });

    // Check if any new clients from CRM need ResourceJob entries
    // This would normally call fetchAuditClients() and compare

    return result;
  } catch (error) {
    console.error('CRM sync error:', error);
    return result;
  }
}

/**
 * Sync completed jobs from CRM.
 * Marks jobs as completed when the CRM indicates they are done.
 */
export async function syncCompletedJobs(firmId: string): Promise<number> {
  try {
    // TODO: Call fetchUncompletedAuditJobs() and compare with existing jobs
    // Jobs in DB but NOT in uncompleted list = completed
    return 0;
  } catch (error) {
    console.error('CRM completed sync error:', error);
    return 0;
  }
}

/**
 * Sync actual hours from CRM time entries.
 */
export async function syncActualHours(firmId: string): Promise<number> {
  try {
    // TODO: Fetch actual hours from CRM and update ResourceJob
    return 0;
  } catch (error) {
    console.error('CRM hours sync error:', error);
    return 0;
  }
}

/**
 * Get the count of jobs by scheduling status for a firm.
 */
export async function getJobStatusCounts(firmId: string): Promise<Record<string, number>> {
  const counts = await prisma.resourceJob.groupBy({
    by: ['schedulingStatus'],
    where: { firmId },
    _count: true,
  });

  const result: Record<string, number> = {
    unscheduled: 0,
    pre_scheduled: 0,
    scheduled: 0,
    completed: 0,
  };

  for (const c of counts) {
    result[c.schedulingStatus] = c._count;
  }

  return result;
}
