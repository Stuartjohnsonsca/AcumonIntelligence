import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ToolLandingPage } from '@/components/tools/ToolLandingPage';

export default async function BankReceiptsPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/bank-receipts');
  }

  return (
    <ToolLandingPage
      toolName="Bank Statement Subsequent Receipts Review"
      category="Statutory Audit"
      description="Automated review of subsequent bank receipts against outstanding debtor balances."
    />
  );
}
