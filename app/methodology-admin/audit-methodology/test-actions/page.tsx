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
      // Also find the test that uses this type code and get its flow
      const test = await prisma.methodologyTest.findFirst({
        where: { firmId: session.user.firmId, testTypeCode: tt.code },
        select: { name: true, flow: true, description: true },
      });
      const flow = test?.flow as any;
      const flowSteps = flow?.nodes
        ?.filter((n: any) => n.type !== 'start' && n.type !== 'end')
        ?.map((n: any) => ({
          label: n.data?.label || n.type,
          type: n.type,
          inputType: n.data?.inputType || null,
          assignee: n.data?.assignee || null,
          waitFor: n.data?.waitFor || null,
          collection: n.data?.collection || null,
          portalTemplate: n.data?.executionDef?.portalFallbackTemplate || n.data?.executionDef?.requestTemplate || null,
          evidenceTypes: n.data?.executionDef?.evidenceTypes || null,
          systemInstruction: n.data?.executionDef?.systemInstruction || null,
        })) || [];

      systemActionDetails[tt.code] = {
        name: tt.name, code: tt.code, actionType: tt.actionType,
        executionDef: tt.executionDef,
        testName: test?.name, testDescription: test?.description,
        flowSteps,
      };
    }
  } catch {}

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <BackButton href="/methodology-admin/audit-methodology" label="Back to Audit Methodology" />
      <TestActionsClient initialActions={actions} isSuperAdmin={session.user.isSuperAdmin} systemActionDetails={systemActionDetails} />
    </div>
  );
}
