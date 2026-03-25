import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AuditMethodologyClient } from '@/components/methodology-admin/AuditMethodologyClient';
import { BackButton } from '@/components/methodology-admin/BackButton';

export default async function AuditMethodologyPage() {
  const session = await auth();

  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/audit-methodology');
  }

  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <BackButton href="/methodology-admin" label="Back to Methodology Admin" />
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Audit Methodology</h1>
        <p className="text-slate-600 mt-1">Configure tools, industries, test bank, and schedules</p>
      </div>
      <AuditMethodologyClient />
    </div>
  );
}
