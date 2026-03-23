import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { BankToTBClient } from '@/components/tools/BankToTBClient';

export default async function BankToTBPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/bank-to-tb');
  }

  const userWithClients = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      firm: {
        include: {
          chartOfAccounts: {
            orderBy: { sortOrder: 'asc' },
          },
        },
      },
      clientAssignments: {
        include: {
          client: {
            select: {
              id: true,
              clientName: true,
              isActive: true,
              periods: {
                orderBy: { startDate: 'desc' },
                select: { id: true, startDate: true, endDate: true },
              },
            },
          },
        },
      },
    },
  });

  if (!userWithClients) redirect('/login');

  const assignedClients = userWithClients.clientAssignments
    .map(a => a.client)
    .filter((c): c is NonNullable<typeof c> => c != null && c.isActive)
    .map(({ isActive: _, ...rest }) => ({
      ...rest,
      periods: rest.periods.map(p => ({
        id: p.id,
        startDate: p.startDate.toISOString(),
        endDate: p.endDate.toISOString(),
      })),
    }));

  const chartOfAccounts = userWithClients.firm.chartOfAccounts.map(a => ({
    id: a.id,
    accountCode: a.accountCode,
    accountName: a.accountName,
    categoryType: a.categoryType,
    sortOrder: a.sortOrder,
  }));

  return (
    <Suspense fallback={null}>
      <BankToTBClient
        userId={session.user.id}
        userName={session.user.name || ''}
        firmId={userWithClients.firmId}
        firmName={userWithClients.firm.name}
        assignedClients={assignedClients}
        isFirmAdmin={session.user.isFirmAdmin}
        chartOfAccounts={chartOfAccounts}
      />
    </Suspense>
  );
}
