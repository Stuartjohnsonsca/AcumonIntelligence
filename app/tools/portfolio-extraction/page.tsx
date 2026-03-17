import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ToolLandingPage } from '@/components/tools/ToolLandingPage';

export default async function PortfolioExtractionPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/portfolio-extraction');
  }

  return (
    <ToolLandingPage
      toolName="Portfolio Document Extraction"
      category="Statutory Audit"
      description="Batch extraction and analysis across an entire client portfolio."
    />
  );
}
