import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { BackButton } from '@/components/methodology-admin/BackButton';
import Link from 'next/link';

export default async function InternalCommunicationPage() {
  const session = await auth();
  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/internal-communication');
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <BackButton href="/methodology-admin" label="Back to Methodology Admin" />
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Internal Communication</h1>
        <p className="text-sm text-slate-500 mt-1">Email templates for internal audit team communications</p>
      </div>
      <div className="border rounded-lg p-6">
        <p className="text-sm text-slate-600 mb-4">
          Manage email templates used for internal communications such as Technical Breach notifications,
          EQR reviews, and team updates.
        </p>
        <Link
          href="/methodology-admin/template-documents/emails"
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
        >
          Open Email Template Manager
        </Link>
      </div>
    </div>
  );
}
