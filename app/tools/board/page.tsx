import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { BoardLanding } from '@/components/board/BoardLanding';

export default async function BoardPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/board');
  }

  return <BoardLanding />;
}
