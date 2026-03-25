import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { FileText } from 'lucide-react';
import { BackButton } from '@/components/methodology-admin/BackButton';

export default async function TechnicalGuidancePage() {
  const session = await auth();
  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/technical-guidance');
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <BackButton href="/methodology-admin" label="Back to Methodology Admin" />
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Audit Technical Guidance</h1>
        <p className="text-slate-600 mt-1">Technical guidance documentation and standards</p>
      </div>
      <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-slate-300 rounded-lg">
        <FileText className="h-12 w-12 text-slate-300 mb-4" />
        <p className="text-lg text-slate-400 font-medium">Coming Soon</p>
        <p className="text-sm text-slate-400 mt-1">This feature is under development</p>
      </div>
    </div>
  );
}
