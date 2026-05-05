import { prisma } from '@/lib/db';

interface SessionUser {
  id: string;
  firmId: string;
  isSuperAdmin?: boolean;
  isFirmAdmin?: boolean;
}

/**
 * Verifies the authenticated user has access to a specific client.
 *
 *   • SuperAdmins  — any client in any firm.
 *   • FirmAdmins   — any client in the same firm. They manage the
 *                    firm's roster centrally and shouldn't need an
 *                    explicit per-client assignment.
 *   • Other users  — same firm AND a UserClientAssignment row for the
 *                    client (i.e. they've been assigned to the client
 *                    explicitly, or auto-assigned by creating it).
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

  // Firm-wide admin bypass: a Firm Admin manages every client in
  // their firm and shouldn't need a per-client assignment row.
  if (user.isFirmAdmin) return { allowed: true };

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
