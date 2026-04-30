import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { BackButton } from '@/components/methodology-admin/BackButton';
import { PerformanceDashboardClient } from '@/components/methodology-admin/PerformanceDashboardClient';
import { HowToButton } from '@/components/howto/HowToButton';
import { HowToOverlay } from '@/components/howto/HowToOverlay';

export default async function PerformanceDashboardPage() {
  const session = await auth();
  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/performance-dashboard');
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <BackButton href="/methodology-admin" label="Back to Methodology Admin" />
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900">Performance Dashboard</h1>
        <p className="text-slate-600 mt-1">
          Audit Quality lead view of audit team performance against Acumon&apos;s G3Q operational model — quality
          monitoring, root-cause analysis, remediation, critical success factors and ISQM(UK)1 readiness.
        </p>
      </div>
      <PerformanceDashboardClient />
      <HowToButton />
      <HowToOverlay />
    </div>
  );
}
