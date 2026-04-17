import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { TestBankClient } from '@/components/methodology-admin/TestBankClient';
import { BackButton } from '@/components/methodology-admin/BackButton';

export default async function TestBankPage() {
  const session = await auth();

  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/audit-methodology/test-bank');
  }

  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  const firmId = session.user.firmId;

  const [testTypes, tests, fsLines, industries, allocations, fwTemplate] = await Promise.all([
    prisma.methodologyTestType.findMany({
      where: { firmId, isActive: true },
      orderBy: { name: 'asc' },
    }),
    prisma.methodologyTest.findMany({
      where: { firmId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.methodologyFsLine.findMany({
      where: { firmId, isActive: true },
      orderBy: [{ isMandatory: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.methodologyIndustry.findMany({
      where: { firmId, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    }),
    prisma.methodologyTestAllocation.findMany({
      where: { test: { firmId } },
      include: {
        test: { select: { id: true, name: true, testTypeCode: true, assertions: true, framework: true, significantRisk: true } },
        fsLine: { select: { id: true, name: true } },
        industry: { select: { id: true, name: true } },
      },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.methodologyTemplate.findFirst({
      where: { firmId, templateType: 'audit_type_schedules', auditType: '__framework_options' },
    }),
  ]);

  const frameworkOptions = fwTemplate ? fwTemplate.items as string[] : [];
  const testActions = testTypes.map(tt => ({
    id: tt.id,
    name: tt.name,
    description: tt.codeSection || '',
    actionType: (tt.actionType === 'client_action' ? 'client' : tt.actionType === 'ai_action' ? 'ai' : 'team') as 'client' | 'ai' | 'team' | 'review',
    isReusable: true,
    executionDef: (tt as any).executionDef || undefined,
  }));
  const canEditFlow = session.user.isSuperAdmin || session.user.isMethodologyAdmin || (session.user as any).isTestBuilder;

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <BackButton href="/methodology-admin/audit-methodology" label="Back to Audit Methodology" />
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Test Bank</h1>
        <p className="text-slate-600 mt-1">Manage audit tests, allocations, and test actions</p>
      </div>
      <TestBankClient
        firmId={firmId}
        initialTestTypes={testTypes}
        initialTests={tests as any}
        initialFsLines={fsLines as any}
        initialIndustries={industries as any}
        initialAllocations={allocations as any}
        initialFrameworkOptions={frameworkOptions}
        initialTestActions={testActions}
        canEditFlow={canEditFlow}
      />
    </div>
  );
}
