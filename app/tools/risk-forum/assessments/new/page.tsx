import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import AssessmentFlow from '@/components/risk-forum/AssessmentFlow';

export const metadata = {
  title: 'New Behavioural Assessment | Risk Forum',
  description: 'Build a personality profile through survey and AI interview',
};

export default async function NewAssessmentPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) redirect('/login?callbackUrl=/tools/risk-forum/assessments/new');
  return <AssessmentFlow />;
}
