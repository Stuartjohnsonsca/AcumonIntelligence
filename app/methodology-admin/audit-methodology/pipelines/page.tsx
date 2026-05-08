import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { BackButton } from '@/components/methodology-admin/BackButton';
import { PipelinesClient } from '@/components/methodology-admin/PipelinesClient';

export default async function PipelinesPage() {
  const session = await auth();

  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/audit-methodology/pipelines');
  }

  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <BackButton href="/methodology-admin/audit-methodology" label="Back to Audit Methodology" />
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Pipelines</h1>
        <p className="text-slate-600 mt-1">System action definitions available for building pipeline tests</p>
      </div>
      <PipelinesClient />
    </div>
  );
}
