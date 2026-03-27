import { auth } from '@/lib/auth';
import { fetchUncompletedAuditJobs } from '@/lib/dynamics-crm';

/**
 * GET - Return distinct audit service types from CRM (jca_jobtyperef, filtered for audit keywords).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!session.user.isResourceAdmin && !session.user.isSuperAdmin) {
    return Response.json({ error: 'Forbidden: Resource Admin required' }, { status: 403 });
  }

  try {
    const jobs = await fetchUncompletedAuditJobs(session.user.firmId);
    const serviceTypes = [...new Set(
      jobs
        .map(j => (j.serviceType || '').trim())
        .filter(Boolean)
    )].sort();

    return Response.json({ serviceTypes });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
