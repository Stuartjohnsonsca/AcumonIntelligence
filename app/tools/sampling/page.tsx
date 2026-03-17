import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ToolLandingPage } from '@/components/tools/ToolLandingPage';

export default async function SamplingPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/sampling');
  }

  return (
    <ToolLandingPage
      toolName="Sample Calculator"
      category="Statutory Audit"
      description="Statistical sampling calculator for audit populations with configurable risk parameters."
    />
  );
}
