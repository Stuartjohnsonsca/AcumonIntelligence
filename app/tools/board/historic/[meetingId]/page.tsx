import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { HistoricMeetingView } from '@/components/board/HistoricMeetingView';

export default async function BoardHistoricMeetingPage({
  params,
}: {
  params: Promise<{ meetingId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/board/historic');
  }

  const { meetingId } = await params;

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <HistoricMeetingView meetingId={meetingId} />
    </div>
  );
}
