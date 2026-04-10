import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ArrowLeft, Clock, ShieldCheck } from 'lucide-react';

export default async function StatAuditControlsBasedPage() {
  const session = await auth();
  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/methodology/StatAudit/controls-based');
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/30">
      <div className="container mx-auto px-4 py-16 max-w-2xl">
        <Link
          href="/tools/methodology/StatAudit"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-blue-600 transition-colors mb-8"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to audit type selection
        </Link>

        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-10 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-100 mb-5">
            <Clock className="h-8 w-8 text-amber-600" />
          </div>

          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            Controls Based Audit
          </h1>
          <p className="text-sm text-slate-500 mb-6">Coming soon</p>

          <div className="bg-blue-50 border border-blue-100 rounded-lg p-5 mb-6 text-left">
            <div className="flex items-start gap-3">
              <ShieldCheck className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-semibold text-slate-800 mb-1">
                  Controls Based Statutory Audit
                </h2>
                <p className="text-xs text-slate-600 leading-relaxed">
                  A controls reliance approach for statutory audits — document your
                  understanding of the entity&apos;s control environment, test design
                  and operating effectiveness of controls, and use the results to
                  reduce substantive testing where appropriate.
                </p>
              </div>
            </div>
          </div>

          <p className="text-sm text-slate-600 mb-6">
            This audit type is under active development. We&apos;ll let you know as
            soon as it&apos;s ready.
          </p>

          <div className="flex items-center justify-center gap-3">
            <Link
              href="/tools/methodology/StatAudit/substantive"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              Use Substantive Audit instead
            </Link>
            <Link
              href="/tools/methodology/StatAudit"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-slate-700 text-sm font-medium rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
            >
              Back
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
