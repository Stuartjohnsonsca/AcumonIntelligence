'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { ArrowRight, BookOpen, ShieldCheck, Clock } from 'lucide-react';

export function StatAuditChooser() {
  const searchParams = useSearchParams();

  // Preserve any existing query params (clientId, periodId, etc.) when navigating
  const qs = useMemo(() => {
    const params = new URLSearchParams();
    searchParams.forEach((value, key) => params.set(key, value));
    const str = params.toString();
    return str ? `?${str}` : '';
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/30">
      <div className="container mx-auto px-4 py-16 max-w-4xl">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Statutory Audit</h1>
          <p className="text-sm text-slate-500">Choose the audit approach for this engagement</p>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          {/* Substantive */}
          <Link
            href={`/tools/methodology/StatAudit/substantive${qs}`}
            className="group bg-white rounded-2xl border border-slate-200 p-7 hover:border-blue-400 hover:shadow-xl transition-all"
          >
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-blue-100 text-blue-600 mb-5 group-hover:scale-110 transition-transform">
              <BookOpen className="h-7 w-7" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Substantive</h2>
            <p className="text-sm text-slate-600 leading-relaxed mb-5">
              Traditional substantive audit approach — direct testing of balances and transactions.
              Full trial balance, materiality, RMM, walkthroughs, audit plan, and completion.
            </p>
            <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 group-hover:gap-2.5 transition-all">
              Start Substantive Audit
              <ArrowRight className="h-4 w-4" />
            </div>
          </Link>

          {/* Controls Based */}
          <Link
            href={`/tools/methodology/StatAudit/controls-based${qs}`}
            className="group bg-white rounded-2xl border border-slate-200 p-7 hover:border-amber-400 hover:shadow-xl transition-all relative"
          >
            <div className="absolute top-4 right-4 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold">
              <Clock className="h-3 w-3" />
              Coming Soon
            </div>
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-100 text-amber-600 mb-5 group-hover:scale-110 transition-transform">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Controls Based</h2>
            <p className="text-sm text-slate-600 leading-relaxed mb-5">
              Controls reliance approach — document, test, and rely on the entity&apos;s internal
              controls to reduce substantive testing. ISA (UK) 315 walkthroughs and ISA (UK) 330
              control testing.
            </p>
            <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-600 group-hover:gap-2.5 transition-all">
              View Details
              <ArrowRight className="h-4 w-4" />
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
