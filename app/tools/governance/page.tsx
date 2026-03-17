import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ToolLandingPage } from '@/components/tools/ToolLandingPage';

export default async function GovernancePage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/governance');
  }

  return (
    <ToolLandingPage
      toolName="Agentic AI & Governance"
      category="Assurance"
      description="AI governance framework assessment and compliance reporting."
    />
  );
}
