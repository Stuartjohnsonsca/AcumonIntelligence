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
  let systemActionDetails: Record<string, any> = {};
  try {
    const table = await prisma.methodologyRiskTable.findUnique({
      where: { firmId_tableType: { firmId: session.user.firmId, tableType: 'test_actions' } },
    });
    if (table?.data && Array.isArray(table.data)) actions = table.data;

    // Load MethodologyTestType details for system actions
    const systemTestTypes = await prisma.methodologyTestType.findMany({
      where: { firmId: session.user.firmId, code: { in: ['fetch_evidence_accounting', 'large_unusual_items'] } },
    });
    for (const tt of systemTestTypes) {
      systemActionDetails[tt.code] = { name: tt.name, code: tt.code, actionType: tt.actionType, executionDef: tt.executionDef };
    }
  } catch {}

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <BackButton href="/methodology-admin/audit-methodology" label="Back to Audit Methodology" />
      <TestActionsClient initialActions={actions} isSuperAdmin={session.user.isSuperAdmin} systemActionDetails={systemActionDetails} />
    </div>
  );
}
