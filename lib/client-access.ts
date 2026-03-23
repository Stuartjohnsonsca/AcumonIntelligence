import { prisma } from '@/lib/db';

interface SessionUser {
  id: string;
  firmId: string;
  isSuperAdmin?: boolean;
  isFirmAdmin?: boolean;
}

/**
 * Verifies the authenticated user has access to a specific client.
 * SuperAdmins can access any client. Other users must be in the same firm
 * AND have a UserClientAssignment for the client.
 */
export async function verifyClientAccess(
  user: SessionUser,
  clientId: string,
): Promise<{ allowed: boolean; reason?: string }> {
  if (user.isSuperAdmin) return { allowed: true };

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { firmId: true },
  });

  if (!client) return { allowed: false, reason: 'Client not found' };
  if (client.firmId !== user.firmId) return { allowed: false, reason: 'Client belongs to a different firm' };

  const assignment = await prisma.userClientAssignment.findUnique({
    where: { userId_clientId: { userId: user.id, clientId } },
  });

  if (!assignment) return { allowed: false, reason: 'Not assigned to this client' };

  return { allowed: true };
}

/**
 * Verifies the user has access to an extraction job via the job's client.
 */
export async function verifyJobAccess(
  user: SessionUser,
  jobId: string,
): Promise<{ allowed: boolean; clientId?: string; reason?: string }> {
  const job = await prisma.extractionJob.findUnique({
    where: { id: jobId },
    select: { clientId: true },
  });

  if (!job) return { allowed: false, reason: 'Job not found' };

  const access = await verifyClientAccess(user, job.clientId);
  return { ...access, clientId: job.clientId };
}

/**
 * Verifies the user has access to a document summary job via the job's client.
 */
export async function verifySummaryJobAccess(
  user: SessionUser,
  jobId: string,
): Promise<{ allowed: boolean; clientId?: string; reason?: string }> {
  const job = await prisma.docSummaryJob.findUnique({
    where: { id: jobId },
    select: { clientId: true },
  });

  if (!job) return { allowed: false, reason: 'Job not found' };

  const access = await verifyClientAccess(user, job.clientId);
  return { ...access, clientId: job.clientId };
}
