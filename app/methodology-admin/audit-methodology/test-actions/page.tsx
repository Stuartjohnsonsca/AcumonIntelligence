import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { TestActionsClient } from '@/components/methodology-admin/TestActionsClient';
import { BackButton } from '@/components/methodology-admin/BackButton';

export default async function TestActionsPage() {
  const session = await auth();
  if (!session?.user || !session.user.twoFactorVerified) redirect('/login');
  if (!session.user.isSuperAdmin) redirect('/access-denied');

  let actions: any[] = [];
  try {
    const table = await prisma.methodologyRiskTable.findUnique({
      where: { firmId_tableType: { firmId: session.user.firmId, tableType: 'test_actions' } },
    });
    if (table?.data && Array.isArray(table.data)) actions = table.data;
  } catch {}

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <BackButton href="/methodology-admin/audit-methodology" label="Back to Audit Methodology" />
      <TestActionsClient initialActions={actions} />
    </div>
  );
}
