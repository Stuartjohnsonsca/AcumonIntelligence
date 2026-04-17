import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import AssessmentHubClient from '@/components/risk-forum/AssessmentHubClient';

export const metadata = {
  title: 'Behavioural Assessments | Risk Forum',
  description: 'Build personality-driven profiles for Risk Forum simulations',
};

export default async function AssessmentHubPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) redirect('/login?callbackUrl=/tools/risk-forum/assessments');
  return <AssessmentHubClient />;
}
