import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { BackButton } from '@/components/methodology-admin/BackButton';
import { DataPurgeClient } from '@/components/methodology-admin/DataPurgeClient';

export default async function DataPurgePage() {
  const session = await auth();

  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/data-purge');
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-4xl">
      <BackButton href="/methodology-admin" label="Back to Methodology Admin" />
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Reset Tab Data</h1>
        <p className="text-slate-600 mt-1">
          Wipe a single tab&apos;s data for one Client + Period. Pick the Client + Period, choose the tab,
          type DELETE to confirm, then click Commit Delete. Every wipe is recorded in the audit trail
          and (when the tab cascades) also clears the artifacts that were triggered from it.
        </p>
      </div>
      <DataPurgeClient />
    </div>
  );
}
