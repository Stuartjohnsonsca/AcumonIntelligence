import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { MethodologyAdminClient } from '@/components/methodology-admin/MethodologyAdminClient';

export default async function MethodologyAdminPage() {
  const session = await auth();

  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin');
  }

  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Methodology Administration</h1>
        <p className="text-slate-600 mt-1">Manage audit methodology settings and templates</p>
      </div>
      <MethodologyAdminClient />
    </div>
  );
}
