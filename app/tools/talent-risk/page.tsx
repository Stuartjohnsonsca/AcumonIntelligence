import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ToolLandingPage } from '@/components/tools/ToolLandingPage';

export default async function TalentRiskPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/talent-risk');
  }

  return (
    <ToolLandingPage
      toolName="Workforce & Talent Risk"
      category="Assurance"
      description="Workforce analytics and talent risk identification for organisational resilience."
    />
  );
}
