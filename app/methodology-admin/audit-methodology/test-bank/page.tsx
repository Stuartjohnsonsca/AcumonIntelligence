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

  const [industries, testTypes, testBanks, fwTemplate] = await Promise.all([
    prisma.methodologyIndustry.findMany({
      where: { firmId, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    }),
    prisma.methodologyTestType.findMany({
      where: { firmId, isActive: true },
      orderBy: { name: 'asc' },
    }),
    prisma.methodologyTestBank.findMany({
      where: { firmId },
    }),
    prisma.methodologyTemplate.findFirst({
      where: { firmId, templateType: 'audit_type_schedules', auditType: '__framework_options' },
    }),
  ]);

  const frameworkOptions = fwTemplate ? fwTemplate.items as string[] : [];

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <BackButton href="/methodology-admin/audit-methodology" label="Back to Audit Methodology" />
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Test Bank</h1>
        <p className="text-slate-600 mt-1">Define audit tests by industry and FS statement line</p>
      </div>
      <TestBankClient
        firmId={firmId}
        initialIndustries={industries}
        initialTestTypes={testTypes}
        initialTestBanks={testBanks as any}
        initialFrameworkOptions={frameworkOptions}
      />
    </div>
  );
}
