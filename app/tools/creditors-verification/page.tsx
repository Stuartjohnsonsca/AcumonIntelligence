import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ToolLandingPage } from '@/components/tools/ToolLandingPage';

export default async function CreditorsVerificationPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/creditors-verification');
  }

  return (
    <ToolLandingPage
      toolName="Creditors Listing Verification"
      category="Statutory Audit"
      description="Verification of creditor balances against supporting documentation and subsequent payments."
    />
  );
}
