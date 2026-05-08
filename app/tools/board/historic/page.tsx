import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { MeetingList } from '@/components/board/MeetingList';

export default async function BoardHistoricPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/board/historic');
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Historic Meetings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Completed meetings, approved minutes, and archived records.
        </p>
      </div>
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <MeetingList statusFilter={['completed', 'approved', 'archived']} />
      </div>
    </div>
  );
}
