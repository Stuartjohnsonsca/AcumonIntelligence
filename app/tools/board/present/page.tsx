import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { MeetingList } from '@/components/board/MeetingList';

export default async function BoardPresentPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/board/present');
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Present Meetings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Scheduled and in-progress meetings ready to run.
        </p>
      </div>
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <MeetingList statusFilter={['scheduled', 'in_progress']} />
      </div>
    </div>
  );
}
