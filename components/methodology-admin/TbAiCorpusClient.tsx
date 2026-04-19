'use client';

import { useMemo, useState } from 'react';
import { Search, ChevronDown, ChevronRight, AlertOctagon, CheckCircle2, Sparkles } from 'lucide-react';
import type { CorpusEntry } from '@/lib/tb-ai-corpus';

const CANONICAL_MIN_SAMPLES = 3;
const CANONICAL_MIN_CONSENSUS = 0.75;

export function TbAiCorpusClient({ entries }: { entries: CorpusEntry[] }) {
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'overrides' | 'samples' | 'confidence' | 'alphabetical'>('overrides');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = q
      ? entries.filter(e =>
          e.description.toLowerCase().includes(q)
          || (e.canonical.fsNoteLevel || '').toLowerCase().includes(q)
          || (e.canonical.fsLevel || '').toLowerCase().includes(q))
      : entries;
    rows = [...rows];
    switch (sortBy) {
      case 'overrides': rows.sort((a, b) => b.aiOverriddenCount - a.aiOverriddenCount || b.sampleCount - a.sampleCount); break;
      case 'samples':   rows.sort((a, b) => b.sampleCount - a.sampleCount); break;
      case 'confidence':rows.sort((a, b) => (b.consensusCount / b.sampleCount) - (a.consensusCount / a.sampleCount)); break;
      case 'alphabetical': rows.sort((a, b) => a.description.localeCompare(b.description)); break;
    }
    return rows;
  }, [entries, query, sortBy]);

  // Summary KPIs at the top of the page
  const totalSamples = entries.reduce((s, e) => s + e.sampleCount, 0);
  const totalAiAccepted = entries.reduce((s, e) => s + e.aiAcceptedCount, 0);
  const totalAiOverridden = entries.reduce((s, e) => s + e.aiOverriddenCount, 0);
  const totalAiUsed = totalAiAccepted + totalAiOverridden;
  const acceptRate = totalAiUsed > 0 ? totalAiAccepted / totalAiUsed : 0;
  const canonicalCount = entries.filter(e =>
    e.sampleCount >= CANONICAL_MIN_SAMPLES && e.consensusCount / e.sampleCount >= CANONICAL_MIN_CONSENSUS
  ).length;

  return (
    <div>
      {/* ── KPI summary ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KpiCard label="Distinct descriptions" value={entries.length.toLocaleString()} />
        <KpiCard label="Total samples" value={totalSamples.toLocaleString()} />
        <KpiCard
          label="AI accept rate"
          value={totalAiUsed > 0 ? `${(acceptRate * 100).toFixed(1)}%` : '—'}
          sub={`${totalAiAccepted} accepted, ${totalAiOverridden} overridden`}
          intent={totalAiUsed > 0 && acceptRate < 0.6 ? 'warn' : 'ok'}
        />
        <KpiCard label="Canonical entries" value={canonicalCount.toLocaleString()} sub="≥3 samples, ≥75% consensus" intent="ok" />
      </div>

      {entries.length === 0 ? (
        <div className="border border-dashed border-slate-200 rounded-lg p-10 text-center">
          <Sparkles className="h-6 w-6 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">No classifications recorded yet.</p>
          <p className="text-xs text-slate-400 mt-2">
            The corpus fills up automatically as auditors leave the TB tab. Each tab-switch captures the full set of
            classified rows. Come back after your team has done a few engagements.
          </p>
        </div>
      ) : (
        <>
          {/* ── Controls ─────────────────────────────────────────── */}
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center gap-1 flex-1 max-w-md">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={`Search ${entries.length} descriptions…`}
                className="flex-1 text-xs border border-slate-200 rounded px-2 py-1.5"
              />
            </div>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              className="text-xs border border-slate-200 rounded px-2 py-1.5 bg-white"
            >
              <option value="overrides">Most corrected</option>
              <option value="samples">Most seen</option>
              <option value="confidence">Highest confidence</option>
              <option value="alphabetical">Alphabetical</option>
            </select>
          </div>

          {/* ── Table ──────────────────────────────────────────────── */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-100 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Description</th>
                  <th className="text-left px-3 py-2 font-medium">FS Note</th>
                  <th className="text-left px-3 py-2 font-medium">FS Level</th>
                  <th className="text-left px-3 py-2 font-medium">FS Statement</th>
                  <th className="text-right px-3 py-2 font-medium">Samples</th>
                  <th className="text-right px-3 py-2 font-medium">Consensus</th>
                  <th className="text-right px-3 py-2 font-medium">AI ✓ / ✗</th>
                  <th className="w-6"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => {
                  const isExpanded = expanded.has(e.descriptionKey);
                  const consensusPct = e.sampleCount > 0 ? e.consensusCount / e.sampleCount : 0;
                  const isCanonical = e.sampleCount >= CANONICAL_MIN_SAMPLES && consensusPct >= CANONICAL_MIN_CONSENSUS;
                  const hasOverrides = e.aiOverriddenCount > 0;
                  return (
                    <>
                      <tr key={e.descriptionKey} className={`border-b border-slate-100 hover:bg-slate-50 ${hasOverrides ? 'bg-amber-50/20' : ''}`}>
                        <td className="px-3 py-2">
                          <button onClick={() => toggle(e.descriptionKey)} className="flex items-center gap-1 text-left text-slate-800 hover:text-blue-600">
                            {isExpanded ? <ChevronDown className="h-3 w-3 flex-shrink-0" /> : <ChevronRight className="h-3 w-3 flex-shrink-0" />}
                            <span className="font-medium">{e.description || <em className="text-slate-400">(blank)</em>}</span>
                          </button>
                        </td>
                        <td className="px-3 py-2 text-slate-700">{e.canonical.fsNoteLevel || <em className="text-slate-300">—</em>}</td>
                        <td className="px-3 py-2 text-slate-700">{e.canonical.fsLevel || <em className="text-slate-300">—</em>}</td>
                        <td className="px-3 py-2 text-slate-700">{e.canonical.fsStatement || <em className="text-slate-300">—</em>}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-700">{e.sampleCount}</td>
                        <td className="px-3 py-2 text-right">
                          <span className={`font-mono ${consensusPct >= 0.9 ? 'text-green-700' : consensusPct >= 0.75 ? 'text-emerald-600' : consensusPct >= 0.5 ? 'text-amber-600' : 'text-red-600'}`}>
                            {(consensusPct * 100).toFixed(0)}%
                          </span>
                          <span className="text-slate-400"> ({e.consensusCount}/{e.sampleCount})</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {(e.aiAcceptedCount + e.aiOverriddenCount) === 0 ? (
                            <span className="text-slate-300 text-[10px] italic">AI not used</span>
                          ) : (
                            <span className="font-mono">
                              <span className="text-green-600">{e.aiAcceptedCount}</span>
                              <span className="text-slate-400"> / </span>
                              <span className={e.aiOverriddenCount > 0 ? 'text-red-600' : 'text-slate-400'}>{e.aiOverriddenCount}</span>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {isCanonical
                            ? <span title="Canonical — used to auto-classify future rows with this description"><CheckCircle2 className="h-3.5 w-3.5 text-green-500" /></span>
                            : hasOverrides
                              ? <span title="AI has been corrected — prompt-tuning candidate"><AlertOctagon className="h-3.5 w-3.5 text-amber-500" /></span>
                              : null}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${e.descriptionKey}-detail`} className="bg-slate-50/60 border-b border-slate-100">
                          <td colSpan={8} className="px-8 py-3">
                            <div className="text-[11px] text-slate-600">
                              <span className="font-semibold">All answers seen for this description</span> (most common first):
                            </div>
                            <ul className="mt-1.5 space-y-0.5">
                              {e.variants.map((v, vi) => (
                                <li key={vi} className="flex items-center gap-2 text-[11px]">
                                  <span className="inline-block w-8 text-right font-mono font-semibold text-slate-700">{v.count}×</span>
                                  <span className="text-slate-700">{v.fsNoteLevel || <em className="text-slate-400">(blank)</em>}</span>
                                  <span className="text-slate-400">→</span>
                                  <span className="text-slate-700">{v.fsLevel || <em className="text-slate-400">(blank)</em>}</span>
                                  <span className="text-slate-400">→</span>
                                  <span className="text-slate-700">{v.fsStatement || <em className="text-slate-400">(blank)</em>}</span>
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="py-8 text-center text-xs text-slate-400 italic">
                No entries match &ldquo;{query}&rdquo;
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, intent }: { label: string; value: string; sub?: string; intent?: 'ok' | 'warn' }) {
  const border = intent === 'warn' ? 'border-amber-200 bg-amber-50/40'
    : intent === 'ok' ? 'border-green-200 bg-green-50/40'
    : 'border-slate-200 bg-white';
  return (
    <div className={`border rounded-lg p-3 ${border}`}>
      <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">{label}</div>
      <div className="text-lg font-bold text-slate-900 mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}
