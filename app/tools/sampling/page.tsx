import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { SamplingCalculatorClient } from '@/components/tools/SamplingCalculatorClient';
import { ErrorBoundaryWrapper } from '@/components/ErrorBoundaryWrapper';

export default async function SamplingPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/sampling');
  }

  const userWithClients = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      firm: true,
      clientAssignments: {
        include: {
          client: {
            select: { id: true, clientName: true, software: true, contactFirstName: true, contactSurname: true, contactEmail: true, isActive: true },
          },
        },
      },
    },
  });

  if (!userWithClients) redirect('/login');

  const assignedClients = userWithClients.clientAssignments
    .map(a => a.client)
    .filter((c): c is NonNullable<typeof c> => c != null && c.isActive)
    .map(({ isActive: _, ...rest }) => rest);

  // Firm sampling config
  const firmConfig = await prisma.firmSamplingConfig.findUnique({
    where: { firmId: userWithClients.firmId },
  });

  return (
    <ErrorBoundaryWrapper pageName="Sampling Calculator">
    <Suspense fallback={null}>
      <SamplingCalculatorClient
        userId={session.user.id}
        userName={session.user.name || ''}
        firmId={userWithClients.firmId}
        firmName={userWithClients.firm.name}
        assignedClients={assignedClients}
        isFirmAdmin={session.user.isFirmAdmin}
        isPortfolioOwner={session.user.isPortfolioOwner}
        firmConfig={firmConfig ? {
          confidenceLevel: firmConfig.confidenceLevel,
          confidenceFactorTable: firmConfig.confidenceFactorTable as Record<string, unknown>[] | null,
          riskMatrix: firmConfig.riskMatrix as number[][] | null,
        } : null}
      />
    </Suspense>
    </ErrorBoundaryWrapper>
  );
}
