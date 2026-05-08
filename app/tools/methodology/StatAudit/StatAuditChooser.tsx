'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpen, ShieldCheck, Clock } from 'lucide-react';

interface ClientOption { id: string; clientName: string; }
interface PeriodOption { id: string; startDate: string; endDate: string; }

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function StatAuditChooser() {
  const searchParams = useSearchParams();

  // Client + period state. Seeded from the URL so a refresh keeps the
  // selections, and so a deep link from elsewhere lands on the chooser
  // with the right rows already picked.
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientId, setClientId] = useState(searchParams.get('clientId') || '');

  const [periods, setPeriods] = useState<PeriodOption[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [periodId, setPeriodId] = useState(searchParams.get('periodId') || '');

  // Load clients on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/clients');
        if (!cancelled && res.ok) {
          const data = await res.json();
          setClients(data.clients || data || []);
        }
      } catch { /* tolerant — empty list shows in dropdown */ }
      finally { if (!cancelled) setClientsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load periods whenever the chosen client changes (and on initial
  // mount when clientId came from the URL).
  useEffect(() => {
    if (!clientId) { setPeriods([]); return; }
    let cancelled = false;
    setPeriodsLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/periods`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          setPeriods(data.periods || data || []);
        }
      } catch { /* tolerant */ }
      finally { if (!cancelled) setPeriodsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  // Build the query string the tile links use. Preserves any other
  // params already on the URL (e.g. xeroConnected from an OAuth
  // redirect) and overrides clientId / periodId with the latest
  // selections so the engagement auto-opens on the next page.
  const qs = useMemo(() => {
    const params = new URLSearchParams();
    searchParams.forEach((value, key) => {
      if (key !== 'clientId' && key !== 'periodId') params.set(key, value);
    });
    if (clientId) params.set('clientId', clientId);
    if (periodId) params.set('periodId', periodId);
    const str = params.toString();
    return str ? `?${str}` : '';
  }, [searchParams, clientId, periodId]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/30">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Statutory Audit</h1>
          <p className="text-sm text-slate-500">Pick a client and period, then choose the audit approach</p>
        </div>

        {/* Client + Period selectors — above the tiles so the user lines
            up the engagement context first; the tile links carry the
            chosen ids through to AuditEngagementPage via query params,
            which auto-opens the engagement on arrival. */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-6">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Client</label>
              <select
                value={clientId}
                onChange={e => { setClientId(e.target.value); setPeriodId(''); }}
                disabled={clientsLoading}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              >
                <option value="">{clientsLoading ? 'Loading clients…' : 'Select client…'}</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.clientName}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Period</label>
              <select
                value={periodId}
                onChange={e => setPeriodId(e.target.value)}
                disabled={!clientId || periodsLoading}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              >
                <option value="">
                  {!clientId ? 'Select a client first' :
                    periodsLoading ? 'Loading periods…' :
                      periods.length === 0 ? 'No periods yet — add one on next step' :
                        'Select period…'}
                </option>
                {periods.map(p => (
                  <option key={p.id} value={p.id}>
                    {formatDate(p.startDate)} – {formatDate(p.endDate)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {clientId && periodId && (
            <p className="text-[11px] text-slate-400 mt-3">
              Click an approach below to open the audit file for this client + period.
            </p>
          )}
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
