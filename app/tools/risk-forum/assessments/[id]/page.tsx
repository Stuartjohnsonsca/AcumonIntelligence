import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import AssessmentDetailClient from '@/components/risk-forum/AssessmentDetailClient';

export const metadata = {
  title: 'Assessment Detail | Risk Forum',
};

export default async function AssessmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) redirect('/login?callbackUrl=/tools/risk-forum/assessments');
  const { id } = await params;
  return <AssessmentDetailClient profileId={id} />;
}
