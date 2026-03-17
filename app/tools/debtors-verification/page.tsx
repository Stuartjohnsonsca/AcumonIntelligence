import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ToolLandingPage } from '@/components/tools/ToolLandingPage';

export default async function DebtorsVerificationPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/debtors-verification');
  }

  return (
    <ToolLandingPage
      toolName="Debtors Listing Verification"
      category="Statutory Audit"
      description="Verification of debtor balances against supporting documentation and subsequent receipts."
    />
  );
}
