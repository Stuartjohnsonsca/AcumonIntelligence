import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { KeyboardShortcutsClient } from '@/components/my-account/KeyboardShortcutsClient';

export default async function KeyboardShortcutsPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) redirect('/login');

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <KeyboardShortcutsClient />
    </div>
  );
}
