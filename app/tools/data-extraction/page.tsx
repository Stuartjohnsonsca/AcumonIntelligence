import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { DataExtractionClient } from '@/components/tools/DataExtractionClient';

export default async function DataExtractionPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/data-extraction');
  }

  // Get clients assigned to this user
  const userWithClients = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      firm: true,
      clientAssignments: {
        include: {
          client: { select: { id: true, clientName: true, software: true, contactName: true, contactEmail: true, isActive: true } },
        },
      },
    },
  });

  if (!userWithClients) redirect('/login');

  // Clients assigned to this user — filter active ones
  const assignedClients = userWithClients.clientAssignments
    .map(a => a.client)
    .filter((c): c is NonNullable<typeof c> => c != null && c.isActive)
    .map(({ isActive: _, ...rest }) => rest);

  // All firm clients not assigned to this user (for access request)
  const allFirmClients = await prisma.client.findMany({
    where: { firmId: userWithClients.firmId, isActive: true },
    select: { id: true, clientName: true, software: true, contactName: true, contactEmail: true },
  });

  const assignedIds = new Set(assignedClients.map(c => c.id));
  const unassignedClients = allFirmClients.filter(c => !assignedIds.has(c.id));

  return (
    <DataExtractionClient
      userId={session.user.id}
      userName={session.user.name || ''}
      firmName={userWithClients.firm.name}
      assignedClients={assignedClients}
      unassignedClients={unassignedClients}
      isFirmAdmin={session.user.isFirmAdmin}
      isPortfolioOwner={session.user.isPortfolioOwner}
    />
  );
}
