import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import RiskForumClient from '@/components/risk-forum/RiskForumClient';

export const metadata = {
  title: 'Risk Forum | Acumon Intelligence',
  description: 'Behavioural risk simulation using personality-driven agents',
};

export default async function RiskForumPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) redirect('/login?callbackUrl=/tools/risk-forum');

  return <RiskForumClient user={session.user} />;
}
