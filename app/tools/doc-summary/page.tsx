import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ToolLandingPage } from '@/components/tools/ToolLandingPage';

export default async function DocSummaryPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/doc-summary');
  }

  return (
    <ToolLandingPage
      toolName="Document Summary"
      category="Statutory Audit"
      description="AI-powered document summarisation for audit working papers and evidence."
    />
  );
}
