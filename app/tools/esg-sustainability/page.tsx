import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ToolLandingPage } from '@/components/tools/ToolLandingPage';

export default async function ESGSustainabilityPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/esg-sustainability');
  }

  return (
    <ToolLandingPage
      toolName="ESG & Sustainability Reporting"
      category="Assurance"
      description="Environmental, social, and governance reporting analysis and assurance."
    />
  );
}
