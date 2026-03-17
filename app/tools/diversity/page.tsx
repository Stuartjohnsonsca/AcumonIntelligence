import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ToolLandingPage } from '@/components/tools/ToolLandingPage';

export default async function DiversityPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/diversity');
  }

  return (
    <ToolLandingPage
      toolName="Diversity Assurance"
      category="Assurance"
      description="Diversity metrics analysis and assurance reporting for organisations."
    />
  );
}
