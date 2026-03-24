import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AuditStubClient } from '@/components/methodology-admin/AuditStubClient';

export default async function SMEControlsAuditPage() {
  const session = await auth();
  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/methodology/sme-controls-audit');
  }
  return <AuditStubClient auditType="SME_CONTROLS" />;
}
