import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { IndustriesClient } from '@/components/methodology-admin/IndustriesClient';
import { BackButton } from '@/components/methodology-admin/BackButton';

export default async function IndustriesPage() {
  const session = await auth();

  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/audit-methodology/industries');
  }

  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  const industries = await prisma.methodologyIndustry.findMany({
    where: { firmId: session.user.firmId },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });

  return (
    <div className="container mx-auto px-4 py-10 max-w-4xl">
      <BackButton href="/methodology-admin/audit-methodology" label="Back to Audit Methodology" />
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Industries</h1>
        <p className="text-slate-600 mt-1">Manage industry definitions for test bank categorisation</p>
      </div>
      <IndustriesClient firmId={session.user.firmId} initialIndustries={industries} />
    </div>
  );
}
