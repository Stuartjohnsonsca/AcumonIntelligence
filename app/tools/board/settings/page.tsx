import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { BoardSettingsClient } from '@/components/board/BoardSettingsClient';

export default async function BoardSettingsPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/board/settings');
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Board Settings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage default agenda templates for new meetings.
        </p>
      </div>
      <BoardSettingsClient />
    </div>
  );
}
