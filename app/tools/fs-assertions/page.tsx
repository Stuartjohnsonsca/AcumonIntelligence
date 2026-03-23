import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { FSAssertionsClient } from '@/components/fs-assertions/FSAssertionsClient';

export const metadata = {
  title: 'FS Assertions Mapping | Acumon Intelligence',
};

export default async function FSAssertionsPage() {
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

  // Financial statement headings for FS-level mapping
  const fsHeadings = [
    'Revenue', 'Cost of Sales', 'Gross Profit', 'Administrative Expenses',
    'Operating Profit', 'Interest Income', 'Interest Expense', 'Profit Before Tax',
    'Tax Charge', 'Profit After Tax',
    'Fixed Assets - Tangible', 'Fixed Assets - Intangible', 'Investments',
    'Stock', 'Debtors', 'Cash / Bank', 'Prepayments',
    'Creditors - Amounts Due Within One Year', 'Creditors - Amounts Due After One Year',
    'Accruals', 'Deferred Income', 'Bank Loans', 'Directors Loan Account',
    'Share Capital', 'Retained Earnings', 'Other Reserves',
  ];

  return (
    <FSAssertionsClient
      userId={session.user.id}
      assignedClients={assignedClients}
      chartOfAccounts={chartOfAccounts}
      fsHeadings={fsHeadings}
    />
  );
}
