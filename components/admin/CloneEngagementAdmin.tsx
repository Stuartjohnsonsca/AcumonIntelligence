'use client';

import { useEffect, useState, useMemo } from 'react';
import { Loader2, Copy, AlertTriangle, Check, ExternalLink } from 'lucide-react';

interface EngagementRow {
  id: string;
  auditType: string;
  framework: string | null;
  status: string;
  cloneOfId: string | null;
  cloneIndex: number;
  cloneLabel: string | null;
  createdAt: string;
  client: { id: string; clientName: string };
  period: { id: string; startDate: string; endDate: string };
  firm: { id: string; name: string };
}

interface CloneResult {
  ok: boolean;
  newEngagementId: string;
  cloneIndex: number;
  cloneLabel: string | null;
  copied: Record<string, number>;
  stripped: string[];
}

/**
 * Super-Admin tool: clone an engagement (same client + same period, new id).
 *
 * Spec confirmed with the user 2026-05-22 — methodology + setup data
 * carries over; test executions, conclusions, sign-offs, findings and
 * the four "client interaction" portal tables (requests, messages,
 * uploads, preview sessions, comms prefs) are stripped. Full table
 * list lives in lib/clone-engagement.ts.
 */
export function CloneEngagementAdmin() {
  const [loading, setLoading] = useState(true);
  const [engagements, setEngagements] = useState<EngagementRow[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [label, setLabel] = useState('');
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CloneResult | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/clone-engagement');
      if (res.ok) {
        const data = await res.json();
        setEngagements(Array.isArray(data.engagements) ? data.engagements : []);
      }
    } finally {
      setLoading(false);
    }
  }

  // Group by firm → client → period so the picker scales when the
  // platform has hundreds of engagements. Search box filters by any
  // visible label so a Super Admin can drill straight to a known
  // client / engagement id.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return engagements;
    return engagements.filter(e => {
      const hay = `${e.firm.name} ${e.client.clientName} ${e.auditType} ${e.framework || ''} ${e.id} ${e.cloneLabel || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [engagements, search]);

  const selected = engagements.find(e => e.id === selectedId);

  async function runClone() {
    if (!selected) return;
    setCloning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/admin/clone-engagement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceEngagementId: selected.id,
          cloneLabel: label.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || `Clone failed (${res.status})`);
        return;
      }
      setResult(data);
      // Refresh the list so the new clone appears immediately.
      await load();
    } catch (err: any) {
      setError(err?.message || 'Network error');
    } finally {
      setCloning(false);
    }
  }

  function fmtPeriod(startIso: string, endIso: string): string {
    try {
      const s = new Date(startIso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      const e = new Date(endIso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      return `${s} → ${e}`;
    } catch { return ''; }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-800">Clone Engagement</h2>
        <p className="text-xs text-slate-500 max-w-2xl">
          Super-Admin only. Creates a new engagement against the SAME client + SAME period with a fresh id.
          Methodology and setup data (TB rows, RMM, materiality, audit plan, team, permanent file, etc.) come across;
          every test execution, conclusion, sign-off, finding, and the four client-interaction portal tables
          (requests, uploads, messages, preview sessions, comms preferences) are stripped so the clone starts from
          a clean state.
        </p>
        <p className="text-[11px] text-amber-700">
          Use sparingly — each clone duplicates the whole engagement workspace. The new engagement is fully separate;
          edits in one don&rsquo;t affect the other.
        </p>
      </div>

      {/* ── Search + table ── */}
      <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by firm / client / audit type / engagement id"
            className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
          />
          <span className="text-[11px] text-slate-400">{filtered.length} of {engagements.length} engagements</span>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400"><Loader2 className="h-4 w-4 animate-spin inline mr-1" /> Loading engagements…</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400 italic">No engagements match.</div>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Firm</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Client</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Period</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Audit Type</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Status</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Clone</th>
                  <th className="px-2 py-1.5 text-center font-semibold text-slate-600 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => {
                  const isSelected = e.id === selectedId;
                  return (
                    <tr
                      key={e.id}
                      className={`border-t border-slate-100 cursor-pointer ${isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                      onClick={() => setSelectedId(e.id)}
                    >
                      <td className="px-2 py-1.5 text-slate-700">{e.firm.name}</td>
                      <td className="px-2 py-1.5 text-slate-700">{e.client.clientName}</td>
                      <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">{fmtPeriod(e.period.startDate, e.period.endDate)}</td>
                      <td className="px-2 py-1.5 text-slate-700">{e.auditType}{e.framework ? ` · ${e.framework}` : ''}</td>
                      <td className="px-2 py-1.5">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{e.status}</span>
                      </td>
                      <td className="px-2 py-1.5 text-slate-500">
                        {e.cloneIndex > 0
                          ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">#{e.cloneIndex}{e.cloneLabel ? ` ${e.cloneLabel}` : ''}</span>
                          : <span className="text-[10px] text-slate-400">original</span>}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input type="radio" checked={isSelected} onChange={() => setSelectedId(e.id)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Clone action panel ── */}
      <div className="border border-slate-200 rounded-lg bg-white p-4 space-y-3">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-[11px] text-slate-500 mb-0.5">Optional clone label (helps tell clones apart in the engagement list)</label>
            <input
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Demo 2026-05-22 · Sandbox · Regulator review"
              className="w-full text-xs border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:border-blue-400"
              disabled={cloning}
            />
          </div>
          <button
            onClick={runClone}
            disabled={!selected || cloning}
            className="inline-flex items-center gap-1.5 text-xs px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
          >
            {cloning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
            Clone selected engagement
          </button>
        </div>
        {selected && !cloning && (
          <p className="text-[11px] text-slate-500">
            Will create a new engagement against <strong>{selected.client.clientName}</strong> ({selected.auditType}{selected.framework ? ` · ${selected.framework}` : ''}) period {fmtPeriod(selected.period.startDate, selected.period.endDate)} on firm <strong>{selected.firm.name}</strong>.
          </p>
        )}
        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5 inline-flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> {error}
          </div>
        )}
        {result && (
          <div className="text-xs bg-green-50 border border-green-200 rounded p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-green-800 font-semibold">
              <Check className="h-4 w-4" /> Clone created — engagement <code className="font-mono">{result.newEngagementId}</code>
              {result.cloneLabel && <span className="text-green-700 font-normal">· label: {result.cloneLabel}</span>}
              <span className="text-green-700 font-normal">· clone #{result.cloneIndex}</span>
            </div>
            <details className="text-[11px] text-slate-600">
              <summary className="cursor-pointer">What was copied vs stripped</summary>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <div className="font-semibold text-slate-700 mb-1">Copied</div>
                  <ul className="space-y-0.5">
                    {Object.entries(result.copied)
                      .sort((a, b) => b[1] - a[1])
                      .map(([k, v]) => (
                        <li key={k}><span className="font-mono text-slate-500">{v.toString().padStart(4, ' ')}</span> {k}</li>
                      ))}
                  </ul>
                </div>
                <div>
                  <div className="font-semibold text-slate-700 mb-1">Stripped (not copied)</div>
                  <ul className="space-y-0.5">
                    {result.stripped.map(s => (
                      <li key={s} className="text-slate-500">{s}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </details>
            <a
              href={`/audit/${result.newEngagementId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
            >
              <ExternalLink className="h-3 w-3" /> Open the cloned engagement
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
