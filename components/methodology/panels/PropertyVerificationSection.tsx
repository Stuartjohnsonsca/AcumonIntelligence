'use client';

/**
 * PropertyVerificationSection — UI for the verify_property_assets action.
 *
 * Renders a phase-driven panel inside the Test Execution view:
 *   - awaiting_addresses: waiting-on-client banner + portal request link
 *   - awaiting_sample:    parsed address list + sample calculator
 *   - awaiting_review:    per-property expandable cards with sign-off dots
 *   - completed:          final summary tile
 *
 * Each phase transition POSTs a resume payload back to the test-execution
 * endpoint. The handler on the server (`handleVerifyPropertyAssets`) reads
 * the updated phase field from its step state and runs the next sub-phase.
 */

import React, { useState, useMemo } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Home,
  FileText,
  Loader2,
  MailCheck,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ExtractedAddress {
  id: string;
  raw: string;
  saon?: string;
  paon?: string;
  street?: string;
  town?: string;
  county?: string;
  postcode?: string;
}

interface PropertyDocument {
  id?: string;
  type: string;
  path: string;
}

interface PropertyResult {
  id: string;
  address: ExtractedAddress;
  titleNumber?: string;
  registeredProprietor?: string;
  hasRestriction?: boolean;
  applicationsOutstanding?: boolean;
  flags: string[];
  summary?: string;
  documents: PropertyDocument[];
  totalCostGbp: number;
  valueGbp?: number;
}

interface SignOff {
  userName: string;
  timestamp: string;
}

interface RowState {
  preparer: SignOff | null;
  reviewer: SignOff | null;
  ri: SignOff | null;
  comment: string;
}

interface Props {
  executionId: string;
  engagementId: string;
  pipelineStepState: Record<string, any> | null;
  pauseReason: string | null;
  currentUserName: string;
  onResumed?: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

type DataGroup = 'ownership' | 'purchase' | 'restrictions';
const DATA_GROUP_LABELS: Record<DataGroup, { label: string; description: string }> = {
  ownership: {
    label: 'Ownership',
    description: 'Title, registered proprietor, official copy, register extract (register + plan), outstanding applications',
  },
  purchase: {
    label: 'Purchase',
    description: 'Transaction history — conveyance and deed of transfer documents',
  },
  restrictions: {
    label: 'Restrictions',
    description: 'Charges, notices, cautions, and restrictions noted on the register',
  },
};

export function PropertyVerificationSection({
  executionId,
  engagementId,
  pipelineStepState,
  pauseReason,
  currentUserName,
  onResumed,
}: Props) {
  const phase = (pipelineStepState?.phase as string) || 'awaiting_addresses';
  const addresses: ExtractedAddress[] = Array.isArray(pipelineStepState?.addresses)
    ? pipelineStepState!.addresses
    : [];
  const properties: PropertyResult[] = Array.isArray(pipelineStepState?.properties)
    ? pipelineStepState!.properties
    : [];
  const totalCostGbp: number = Number(pipelineStepState?.total_cost_gbp ?? 0);
  const exceptionCount: number = Number(pipelineStepState?.exception_count ?? 0);
  const portalRequestId: string | undefined = pipelineStepState?.portal_request_id;
  const parseError: string | undefined = pipelineStepState?.parse_error;

  // Data groups — authoritative runtime source. When the pipeline has
  // already been run with some groups, those come through from server
  // state; ticking additional groups and clicking "Fetch additional data"
  // resumes with phase='fetch_additional' which only calls the delta.
  const initialGroups: DataGroup[] = Array.isArray(pipelineStepState?.dataGroups) && pipelineStepState!.dataGroups.length > 0
    ? pipelineStepState!.dataGroups.filter((g: any) => g === 'ownership' || g === 'purchase' || g === 'restrictions')
    : ['ownership'];
  const [dataGroups, setDataGroups] = useState<Set<DataGroup>>(() => new Set(initialGroups));

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [valuesByIndex, setValuesByIndex] = useState<Record<number, number>>(() => {
    const existing = pipelineStepState?.valuesByIndex || {};
    return { ...(existing as Record<number, number>) };
  });
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(
    () => new Set<number>(Array.isArray(pipelineStepState?.selectedIndices) ? pipelineStepState!.selectedIndices : []),
  );
  const [rowStates, setRowStates] = useState<Record<string, RowState>>(() => {
    const existing = pipelineStepState?.rowStates || {};
    const out: Record<string, RowState> = {};
    for (const [id, rs] of Object.entries(existing as Record<string, any>)) {
      out[id] = {
        preparer: rs?.preparer || null,
        reviewer: rs?.reviewer || null,
        ri: rs?.ri || null,
        comment: rs?.comment || '',
      };
    }
    return out;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allSignedOff = useMemo(() => {
    if (properties.length === 0) return false;
    return properties.every(p => rowStates[p.id]?.preparer && rowStates[p.id]?.reviewer && rowStates[p.id]?.ri);
  }, [properties, rowStates]);

  async function postResume(responseData: Record<string, any>) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/test-execution/${executionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resume', responseData }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Resume failed (${res.status})`);
      } else {
        onResumed?.();
      }
    } catch (err: any) {
      setError(err?.message || 'Resume failed');
    } finally {
      setSubmitting(false);
    }
  }

  function toggleSelect(idx: number) {
    setSelectedIndices(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function toggleSignOff(propertyId: string, role: 'preparer' | 'reviewer' | 'ri') {
    setRowStates(prev => {
      const current = prev[propertyId] || { preparer: null, reviewer: null, ri: null, comment: '' };
      const next = { ...current };
      if (next[role]) {
        next[role] = null;
      } else {
        next[role] = { userName: currentUserName, timestamp: new Date().toISOString() };
      }
      return { ...prev, [propertyId]: next };
    });
  }

  function setComment(propertyId: string, comment: string) {
    setRowStates(prev => {
      const current = prev[propertyId] || { preparer: null, reviewer: null, ri: null, comment: '' };
      return { ...prev, [propertyId]: { ...current, comment } };
    });
  }

  function overallConclusion(): 'green' | 'orange' | 'red' {
    const anyException = properties.some(p => p.flags.length > 0);
    if (anyException) return 'orange';
    return 'green';
  }

  // ── Phase rendering ─────────────────────────────────────────────────────

  return (
    <div className="border border-emerald-200 rounded-lg bg-emerald-50/40 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-emerald-100/60 border-b border-emerald-200">
        <Home className="h-4 w-4 text-emerald-700" />
        <h3 className="text-sm font-semibold text-emerald-900">UK Property Asset Verification — HM Land Registry</h3>
        <span className="ml-auto text-xs text-emerald-800">
          Phase: <span className="font-mono">{phase}</span>
        </span>
      </div>

      {error && (
        <div className="px-4 py-2 text-xs bg-red-50 text-red-700 border-b border-red-200 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      {/* ── Phase A: awaiting addresses ───────────────────────────────── */}
      {phase === 'awaiting_addresses' && (
        <div className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            <MailCheck className="h-5 w-5 text-emerald-600 mt-0.5" />
            <div className="text-sm text-slate-700">
              <p className="font-medium">Waiting for the client to reply via the Client Portal with the list of UK properties.</p>
              <p className="text-xs text-slate-500 mt-1">
                When the client responds — either by typing addresses into the chat or uploading a document — this section will advance automatically.
              </p>
              {portalRequestId && (
                <p className="text-xs text-slate-500 mt-1">
                  Portal request ID: <span className="font-mono">{portalRequestId}</span>
                </p>
              )}
              {parseError && (
                <p className="text-xs text-amber-700 mt-2">{parseError}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Phase B: awaiting sample selection ────────────────────────── */}
      {phase === 'awaiting_sample' && (
        <div className="p-4 space-y-3">
          <p className="text-sm text-slate-700">
            {addresses.length} address{addresses.length === 1 ? '' : 'es'} parsed from the client response. Enter a carrying value for each property (from the fixed asset register) and tick the ones to test. Then choose which HMLR data groups to pull for the first run — you can add more groups later without re-fetching what's already in hand.
          </p>

          {/* Data group selector — drives which HMLR APIs the run calls.
              Ticking fewer groups keeps costs down; you can re-open the
              same sample later and tick more groups to fetch only the
              additional data you need. */}
          <DataGroupSelector dataGroups={dataGroups} onChange={setDataGroups} />

          <div className="border border-slate-200 rounded bg-white">
            <div className="grid grid-cols-[32px_1fr_140px] gap-x-3 px-3 py-2 text-xs font-medium text-slate-600 border-b border-slate-200 bg-slate-50">
              <div></div>
              <div>Address</div>
              <div className="text-right">Value (£)</div>
            </div>
            {addresses.map((addr, idx) => (
              <div
                key={addr.id}
                className={`grid grid-cols-[32px_1fr_140px] gap-x-3 px-3 py-2 text-xs border-b border-slate-100 last:border-b-0 ${selectedIndices.has(idx) ? 'bg-emerald-50' : ''}`}
              >
                <div>
                  <input
                    type="checkbox"
                    checked={selectedIndices.has(idx)}
                    onChange={() => toggleSelect(idx)}
                    className="h-3.5 w-3.5"
                  />
                </div>
                <div className="text-slate-700">
                  {addr.raw}
                  <div className="text-[10px] text-slate-400 font-mono">
                    {[addr.saon, addr.paon, addr.street, addr.town, addr.county, addr.postcode].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="text-right">
                  <input
                    type="number"
                    value={valuesByIndex[idx] ?? ''}
                    onChange={e => setValuesByIndex(prev => ({ ...prev, [idx]: Number(e.target.value) || 0 }))}
                    placeholder="0.00"
                    className="w-28 text-right text-xs px-2 py-1 border border-slate-200 rounded"
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between text-xs text-slate-600">
            <span>{selectedIndices.size} selected · Total value £{Object.entries(valuesByIndex).filter(([k]) => selectedIndices.has(Number(k))).reduce((s, [, v]) => s + Number(v || 0), 0).toFixed(2)}</span>
            <Button
              size="sm"
              disabled={selectedIndices.size === 0 || dataGroups.size === 0 || submitting}
              onClick={() =>
                postResume({
                  phase: 'sample_selected',
                  selectedIndices: Array.from(selectedIndices).sort((a, b) => a - b),
                  valuesByIndex,
                  dataGroups: Array.from(dataGroups),
                })
              }
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              Run HMLR Pipeline for {selectedIndices.size} Propert{selectedIndices.size === 1 ? 'y' : 'ies'}
            </Button>
          </div>
        </div>
      )}

      {/* ── Phase C: per-property review ──────────────────────────────── */}
      {phase === 'awaiting_review' && (
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-4 text-xs text-slate-600">
            <span>{properties.length} propert{properties.length === 1 ? 'y' : 'ies'} tested</span>
            <span>Exceptions: <span className={exceptionCount > 0 ? 'text-amber-700 font-medium' : 'text-slate-500'}>{exceptionCount}</span></span>
            <span>HMLR spend: <span className="font-medium">£{totalCostGbp.toFixed(2)}</span></span>
          </div>

          {/*
            Data group re-fetch — ticking additional groups here triggers
            a phase='fetch_additional' resume. The server runs only the
            APIs for the newly-enabled groups and merges the results into
            the cached property state, so the incremental cost is exactly
            the delta of new API calls.
          */}
          <DataGroupSelector
            dataGroups={dataGroups}
            onChange={setDataGroups}
            footer={(() => {
              const currentGroups = new Set(initialGroups);
              const newGroups = Array.from(dataGroups).filter(g => !currentGroups.has(g));
              const removedAny = Array.from(currentGroups).some(g => !dataGroups.has(g));
              if (newGroups.length === 0 && !removedAny) {
                return (
                  <span className="text-[10px] text-slate-400 italic">
                    Tick additional groups to fetch more data for these properties. Already-fetched data is reused — you only pay for the delta.
                  </span>
                );
              }
              if (newGroups.length === 0 && removedAny) {
                return (
                  <span className="text-[10px] text-amber-700">
                    Note: un-ticking a group hides it from future fetches but existing data stays in the results below.
                  </span>
                );
              }
              return (
                <Button
                  size="sm"
                  disabled={submitting}
                  onClick={() =>
                    postResume({
                      phase: 'fetch_additional',
                      dataGroups: Array.from(dataGroups),
                    })
                  }
                >
                  {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                  Fetch additional data ({newGroups.map(g => DATA_GROUP_LABELS[g].label).join(', ')})
                </Button>
              );
            })()}
          />


          {/* Per-property cards */}
          <div className="space-y-2">
            {properties.map((prop) => {
              const isOpen = !!expanded[prop.id];
              const rs = rowStates[prop.id] || { preparer: null, reviewer: null, ri: null, comment: '' };
              return (
                <div key={prop.id} className="border border-slate-200 rounded bg-white overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button
                      type="button"
                      className="text-slate-500 hover:text-slate-700"
                      onClick={() => setExpanded(p => ({ ...p, [prop.id]: !p[prop.id] }))}
                    >
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-800 font-medium truncate">
                        {prop.address.raw}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {prop.titleNumber ? (
                          <>
                            Title <span className="font-mono">{prop.titleNumber}</span>
                            {prop.registeredProprietor ? ` · ${prop.registeredProprietor}` : ''}
                          </>
                        ) : (
                          <span className="text-amber-700">Title not found</span>
                        )}
                        {prop.flags.length > 0 && (
                          <span className="text-amber-700"> · {prop.flags.length} flag{prop.flags.length === 1 ? '' : 's'}</span>
                        )}
                      </div>
                    </div>
                    {/* Sign-off dots */}
                    <div className="flex items-center gap-1.5">
                      {(['preparer', 'reviewer', 'ri'] as const).map(role => {
                        const signed = !!rs[role];
                        return (
                          <button
                            key={role}
                            type="button"
                            title={signed ? `${role.toUpperCase()} signed by ${rs[role]?.userName} on ${new Date(rs[role]!.timestamp).toLocaleString('en-GB')}` : `Click to sign as ${role.toUpperCase()}`}
                            onClick={() => toggleSignOff(prop.id, role)}
                            className={`h-5 w-5 rounded-full border-2 text-[9px] font-semibold flex items-center justify-center transition-colors ${
                              signed
                                ? 'bg-green-500 border-green-600 text-white'
                                : 'bg-white border-slate-300 text-slate-400 hover:border-slate-500'
                            }`}
                          >
                            {role === 'preparer' ? 'P' : role === 'reviewer' ? 'R' : 'RI'}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="px-3 pb-3 pt-1 space-y-3 border-t border-slate-100">
                      {prop.summary && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">AI Summary</div>
                          <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{prop.summary}</p>
                        </div>
                      )}
                      {prop.flags.length > 0 && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-amber-700 font-semibold mb-1 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" /> Flags
                          </div>
                          <ul className="text-xs text-amber-800 space-y-0.5">
                            {prop.flags.map((f, i) => (
                              <li key={i}>• {f}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {prop.documents.length > 0 && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Retrieved documents</div>
                          <div className="flex flex-wrap gap-1.5">
                            {prop.documents.map((d, i) => (
                              <a
                                key={i}
                                href={d.id ? `/api/documents/${d.id}/download` : '#'}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-slate-200 rounded bg-slate-50 text-slate-700 hover:bg-slate-100"
                              >
                                <FileText className="h-3 w-3" />
                                {d.type}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="text-[10px] text-slate-500">
                        HMLR spend for this property: <span className="font-medium">£{prop.totalCostGbp.toFixed(2)}</span>
                      </div>
                      <textarea
                        value={rs.comment}
                        onChange={e => setComment(prop.id, e.target.value)}
                        placeholder="Preparer / Reviewer / RI notes..."
                        className="w-full text-xs px-2 py-1.5 border border-slate-200 rounded resize-y min-h-[48px]"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Complete Review button */}
          <div className="flex items-center justify-between border-t border-slate-200 pt-3">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <Users className="h-3.5 w-3.5" />
              {allSignedOff ? (
                <span className="text-green-700 font-medium flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> All properties signed off by Preparer, Reviewer and RI
                </span>
              ) : (
                <span>Each property needs P / R / RI sign-off before the test can be concluded.</span>
              )}
            </div>
            <Button
              size="sm"
              disabled={!allSignedOff || submitting}
              onClick={() =>
                postResume({
                  phase: 'reviewed',
                  rowStates,
                  conclusion: overallConclusion(),
                })
              }
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              Complete Review
            </Button>
          </div>
        </div>
      )}

      {/* ── Phase D: completed ────────────────────────────────────────── */}
      {phase === 'completed' && (
        <div className="p-4">
          <div className="flex items-center gap-2 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4" />
            Property verification complete · {properties.length} propert{properties.length === 1 ? 'y' : 'ies'} tested · £{totalCostGbp.toFixed(2)} HMLR spend · {exceptionCount} exception{exceptionCount === 1 ? '' : 's'}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Three-checkbox selector for the Ownership / Purchase / Restrictions data
 * groups. Used in both the sample phase (initial pick) and the review phase
 * (incremental add-on). `footer` renders below the checkboxes — typically
 * a hint line in the sample phase and a "Fetch additional data" button in
 * the review phase.
 */
function DataGroupSelector({
  dataGroups,
  onChange,
  footer,
}: {
  dataGroups: Set<DataGroup>;
  onChange: (next: Set<DataGroup>) => void;
  footer?: React.ReactNode;
}) {
  function toggle(g: DataGroup) {
    const next = new Set(dataGroups);
    if (next.has(g)) next.delete(g);
    else next.add(g);
    onChange(next);
  }
  const groups: DataGroup[] = ['ownership', 'purchase', 'restrictions'];
  return (
    <div className="border border-slate-200 rounded bg-slate-50 p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">HMLR data to fetch</div>
      <div className="space-y-1.5">
        {groups.map(g => {
          const on = dataGroups.has(g);
          const meta = DATA_GROUP_LABELS[g];
          return (
            <label key={g} className="flex items-start gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(g)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <div className="flex-1">
                <div className="text-xs font-medium text-slate-800">{meta.label}</div>
                <div className="text-[10px] text-slate-500 leading-tight">{meta.description}</div>
              </div>
            </label>
          );
        })}
      </div>
      {footer && <div className="mt-2 pt-2 border-t border-slate-200">{footer}</div>}
    </div>
  );
}
