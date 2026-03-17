import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ToolLandingPage } from '@/components/tools/ToolLandingPage';

export default async function JournalsTestingPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/journals-testing');
  }

  return (
    <ToolLandingPage
      toolName="Journals Testing"
      category="Statutory Audit"
      description="AI-powered analysis and testing of journal entries for unusual patterns and anomalies."
    />
  );
}
