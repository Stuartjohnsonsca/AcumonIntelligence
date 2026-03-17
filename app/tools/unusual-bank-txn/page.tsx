import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ToolLandingPage } from '@/components/tools/ToolLandingPage';

export default async function UnusualBankTxnPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/unusual-bank-txn');
  }

  return (
    <ToolLandingPage
      toolName="Unusual Bank Transaction Review"
      category="Statutory Audit"
      description="AI-driven identification and review of unusual or high-risk bank transactions."
    />
  );
}
