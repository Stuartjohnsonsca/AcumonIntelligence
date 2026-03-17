import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ToolLandingPage } from '@/components/tools/ToolLandingPage';

export default async function FSCheckerPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/fs-checker');
  }

  return (
    <ToolLandingPage
      toolName="Financial Statements Checker"
      category="Statutory Audit"
      description="Automated consistency and compliance checks on financial statements."
    />
  );
}
