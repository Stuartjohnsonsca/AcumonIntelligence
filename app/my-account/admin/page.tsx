import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AdminClient } from '@/components/admin/AdminClient';

export default async function AdminPage() {
  const session = await auth();

  if (!session?.user?.twoFactorVerified || !session.user.isSuperAdmin) {
    redirect('/my-account');
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <div className="mb-8">
        <div className="flex items-center space-x-3 mb-2">
          <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
            <span className="text-purple-700 font-bold text-sm">SA</span>
          </div>
          <h1 className="text-3xl font-bold text-slate-900">Administration</h1>
        </div>
        <p className="text-slate-600">Super Administrator panel — manage products and firms</p>
      </div>
      <AdminClient />
    </div>
  );
}
