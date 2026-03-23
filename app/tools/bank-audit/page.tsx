import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { BankAuditClient } from '@/components/bank-audit/BankAuditClient';

export const metadata = {
  title: 'Bank Audit | Acumon Intelligence',
};

export default async function BankAuditPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) redirect('/login');

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
              software: true,
              periods: {
                orderBy: { startDate: 'desc' },
                select: { id: true, startDate: true, endDate: true },
              },
              accountingConnections: {
                select: { system: true, tenantId: true },
              },
            },
          },
        },
      },
    },
  });

  if (!userWithClients) redirect('/login');

  const assignedClients = userWithClients.clientAssignments
    .map((a: { client: { id: string; clientName: string; isActive: boolean; software: string | null; periods: { id: string; startDate: Date; endDate: Date }[]; accountingConnections: { system: string; tenantId: string | null }[] } }) => a.client)
    .filter((c: { isActive: boolean }) => c.isActive)
    .map((c: { id: string; clientName: string; isActive: boolean; software: string | null; periods: { id: string; startDate: Date; endDate: Date }[]; accountingConnections: { system: string; tenantId: string | null }[] }) => ({
      id: c.id,
      clientName: c.clientName,
      software: c.software,
      periods: c.periods.map((p: { id: string; startDate: Date; endDate: Date }) => ({
        id: p.id,
        startDate: p.startDate.toISOString(),
        endDate: p.endDate.toISOString(),
      })),
      accountingSystem: c.accountingConnections?.[0]?.system || null,
    }));

  const chartOfAccounts = userWithClients.firm.chartOfAccounts.map((a: { id: string; accountCode: string; accountName: string; categoryType: string; sortOrder: number }) => ({
    id: a.id,
    accountCode: a.accountCode,
    accountName: a.accountName,
    categoryType: a.categoryType,
    sortOrder: a.sortOrder,
  }));

  return (
    <BankAuditClient
      userId={session.user.id}
      userName={session.user.name || ''}
      firmId={userWithClients.firm.id}
      firmName={userWithClients.firm.name}
      assignedClients={assignedClients}
      isFirmAdmin={session.user.isFirmAdmin || false}
      chartOfAccounts={chartOfAccounts}
      bankAssertions={null}
    />
  );
}
