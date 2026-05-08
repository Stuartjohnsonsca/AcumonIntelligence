import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { LiveMeetingView } from '@/components/board/LiveMeetingView';

export default async function BoardPresentMeetingPage({
  params,
}: {
  params: Promise<{ meetingId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/board/present');
  }

  const { meetingId } = await params;

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <LiveMeetingView meetingId={meetingId} />
    </div>
  );
}
