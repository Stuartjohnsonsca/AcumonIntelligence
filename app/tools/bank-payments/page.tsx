import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ToolLandingPage } from '@/components/tools/ToolLandingPage';

export default async function BankPaymentsPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/bank-payments');
  }

  return (
    <ToolLandingPage
      toolName="Bank Statement Subsequent Payments Review"
      category="Statutory Audit"
      description="Automated review of subsequent bank payments against outstanding creditor balances."
    />
  );
}
