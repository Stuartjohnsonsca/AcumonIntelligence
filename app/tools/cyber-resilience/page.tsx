import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ToolLandingPage } from '@/components/tools/ToolLandingPage';

export default async function CyberResiliencePage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/cyber-resilience');
  }

  return (
    <ToolLandingPage
      toolName="Cybersecurity Resilience"
      category="Assurance"
      description="Cybersecurity posture assessment and resilience testing tools."
    />
  );
}
