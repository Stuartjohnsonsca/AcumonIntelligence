import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ClipboardCheck } from 'lucide-react';

export default async function FileReviewPage() {
  const session = await auth();
  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/file-review');
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Audit File Review Selection</h1>
        <p className="text-slate-600 mt-1">Configure file review criteria and selection</p>
      </div>
      <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-slate-300 rounded-lg">
        <ClipboardCheck className="h-12 w-12 text-slate-300 mb-4" />
        <p className="text-lg text-slate-400 font-medium">Coming Soon</p>
        <p className="text-sm text-slate-400 mt-1">This feature is under development</p>
      </div>
    </div>
  );
}
