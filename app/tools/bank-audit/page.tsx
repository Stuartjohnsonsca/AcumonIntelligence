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
                where: { isActive: true },
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
    .map(a => a.client)
    .filter((c): c is NonNullable<typeof c> => c != null && c.isActive)
    .map(({ isActive: _, ...rest }) => ({
      ...rest,
      periods: rest.periods.map(p => ({
        id: p.id,
        startDate: p.startDate.toISOString(),
        endDate: p.endDate.toISOString(),
      })),
      accountingSystem: rest.accountingConnections?.[0]?.system || null,
    }));

  const chartOfAccounts = userWithClients.firm.chartOfAccounts.map(a => ({
    id: a.id,
    accountCode: a.accountCode,
    accountName: a.accountName,
    categoryType: a.categoryType,
    sortOrder: a.sortOrder,
  }));

  // Get FS Assertions for Cash / Bank descriptions
  const fsAssertionsForBank = await prisma.fSAssertionMapping.findMany({
    where: {
      clientId: { in: assignedClients.map(c => c.id) },
      mappingType: 'fs_level',
      rowLabel: { contains: 'Cash', mode: 'insensitive' },
    },
  });

  const bankAssertions = fsAssertionsForBank.length > 0
    ? fsAssertionsForBank
    : null;

  return (
    <BankAuditClient
      userId={session.user.id}
      userName={session.user.name || ''}
      firmId={userWithClients.firm.id}
      firmName={userWithClients.firm.name}
      assignedClients={assignedClients}
      isFirmAdmin={session.user.isFirmAdmin || false}
      chartOfAccounts={chartOfAccounts}
      bankAssertions={bankAssertions}
    />
  );
}
