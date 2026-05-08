import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { MeetingPrepareView } from '@/components/board/MeetingPrepareView';

export default async function BoardPrepareMeetingPage({
  params,
}: {
  params: Promise<{ meetingId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/board/prepare');
  }

  const { meetingId } = await params;

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <MeetingPrepareView meetingId={meetingId} />
    </div>
  );
}
