import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AuditEngagementPage } from '@/components/methodology/AuditEngagementPage';

export default async function StatControlsAuditPage() {
  const session = await auth();
  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/methodology/StatControlsAudit');
  }
  return <AuditEngagementPage auditType="SME_CONTROLS" />;
}
