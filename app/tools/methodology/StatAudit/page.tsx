import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { StatAuditChooser } from './StatAuditChooser';

export default async function StatAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/methodology/StatAudit');
  }

  // If an engagementId is already in the URL, the user is returning to an existing
  // substantive audit — skip the chooser and go straight to the substantive page
  // with the query string preserved.
  const params = await searchParams;
  if (params.engagementId) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === 'string') qs.set(k, v);
    }
    redirect(`/tools/methodology/StatAudit/substantive?${qs.toString()}`);
  }

  return <StatAuditChooser />;
}
