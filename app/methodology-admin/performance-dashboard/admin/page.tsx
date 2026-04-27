import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { BackButton } from '@/components/methodology-admin/BackButton';
import { PerformanceDashboardAdminClient } from '@/components/methodology-admin/PerformanceDashboardAdminClient';

export default async function PerformanceDashboardAdminPage() {
  const session = await auth();
  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/performance-dashboard/admin');
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <BackButton href="/methodology-admin/performance-dashboard" label="Back to Performance Dashboard" />
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900">Manage Performance Dashboard data</h1>
        <p className="text-slate-600 mt-1">
          Capture monitoring activities, findings, RCAs, remediations, CSFs, people-metric snapshots, the annual
          activity schedule and ISQM(UK)1 evidence — these populate the live Performance Dashboard.
        </p>
      </div>
      <PerformanceDashboardAdminClient />
    </div>
  );
}
