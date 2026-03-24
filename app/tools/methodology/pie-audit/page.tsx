import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AuditEngagementPage } from '@/components/methodology/AuditEngagementPage';

export default async function PIEAuditPage() {
  const session = await auth();
  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/methodology/pie-audit');
  }
  return <AuditEngagementPage auditType="PIE" />;
}
