'use client';

import { useState, useMemo } from 'react';
import { CheckCircle2, AlertTriangle, Database, MessageSquare, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Per-line-item population source picker for the "Obtain Population"
 * stage of any audit test.
 *
 * The user spec: each line item gets a radio choice — pull the
 * population from the GL, or request it from the client. The picker
 * also surfaces a check that the obtained population agrees to the
 * expected balance (the figure the audit plan is testing against).
 *
 * Inputs the host (TestExecutionPanel) supplies:
 *   - lines:    one entry per item the test needs population data
 *               for. Each entry carries an expected balance the
 *               obtained population is checked against.
 *   - initialChoices / initialObtained: optional pre-loaded state
 *               (so the picker can rehydrate when the user re-opens
 *               a partially-completed test).
 *   - onObtain(line, source):
 *               called when the user clicks Obtain — host fetches
 *               the GL data or fires the portal request and
 *               returns the obtained data + total. Async because
 *               either path involves a network hop.
 *   - onContinue(state): called once every line has an obtained
 *               population and the user is ready to advance to the
 *               next pipeline stage (Sampling).
 */

export type PopulationSource = 'client' | 'gl';

export interface PopulationLine {
  id: string;
  /** Display label — usually FS Line + account code or description. */
  label: string;
  /** Expected balance the obtained population must agree to (within
   *  the configured tolerance). */
  expectedAmount: number;
}

export interface ObtainedPopulation {
  source: PopulationSource;
  obtainedAmount: number;
  itemCount: number;
  /** Free-text note shown next to the line — e.g. "GL fetched at
   *  09:31" or "Client uploaded statement.pdf". */
  note?: string;
  obtainedAt: string;
}

export interface PopulationPickerState {
  choices: Record<string, PopulationSource>;
  obtained: Record<string, ObtainedPopulation>;
}

interface Props {
  lines: PopulationLine[];
  /** % tolerance for the agree-to-expected check. Defaults to 0.5%
   *  (half a percent), in line with how most firms cope with normal
   *  rounding differences. */
  tolerancePct?: number;
  initialChoices?: Record<string, PopulationSource>;
  initialObtained?: Record<string, ObtainedPopulation>;
  busyLineIds?: Set<string>;
  onObtain: (line: PopulationLine, source: PopulationSource) => void | Promise<void>;
  onContinue?: (state: PopulationPickerState) => void;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PopulationSourcePicker({
  lines, tolerancePct = 0.5, initialChoices, initialObtained, busyLineIds, onObtain, onContinue,
}: Props) {
  const [choices, setChoices] = useState<Record<string, PopulationSource>>(initialChoices || {});
  const [obtained, setObtained] = useState<Record<string, ObtainedPopulation>>(initialObtained || {});

  // Per-line agreement status. The picker can't move on until every
  // line is either green (within tolerance) or has been overridden;
  // amber means obtained, but the totals are out by more than the
  // tolerance allows.
  const lineStatus = useMemo(() => {
    const status: Record<string, 'pending' | 'green' | 'amber' | 'red'> = {};
    for (const line of lines) {
      const obt = obtained[line.id];
      if (!obt) { status[line.id] = 'pending'; continue; }
      const expected = Math.abs(line.expectedAmount);
      if (expected === 0) {
        status[line.id] = obt.obtainedAmount === 0 ? 'green' : 'amber';
        continue;
      }
      const diffPct = Math.abs(obt.obtainedAmount - line.expectedAmount) / expected * 100;
      status[line.id] = diffPct <= tolerancePct ? 'green' : diffPct <= tolerancePct * 10 ? 'amber' : 'red';
    }
    return status;
  }, [lines, obtained, tolerancePct]);

  const allObtained = lines.length > 0 && lines.every(l => obtained[l.id]);
  const anyMaterialMismatch = lines.some(l => lineStatus[l.id] === 'red');

  function setChoice(lineId: string, source: PopulationSource) {
    setChoices(prev => ({ ...prev, [lineId]: source }));
  }

  async function handleObtain(line: PopulationLine) {
    const source = choices[line.id] || 'gl';
    await onObtain(line, source);
    // Note: the host updates `obtained` via the parent's state and
    // re-renders this component with the new initialObtained — we
    // don't mutate `obtained` here so the host stays the source of
    // truth.
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span className="uppercase tracking-wide font-semibold">Obtain Population</span>
        <span>Tolerance ±{tolerancePct}% on the agree-to-expected check.</span>
      </div>

      <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-[9px] uppercase tracking-wide text-slate-500 font-semibold">
              <th className="text-left px-3 py-1.5">Line item</th>
              <th className="text-right px-2 py-1.5 w-28">Expected</th>
              <th className="text-center px-2 py-1.5 w-44">Source</th>
              <th className="text-right px-2 py-1.5 w-28">Obtained</th>
              <th className="text-right px-2 py-1.5 w-24">Diff</th>
              <th className="text-center px-2 py-1.5 w-20">Status</th>
              <th className="px-2 py-1.5 w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map(line => {
              const choice = choices[line.id] || 'gl';
              const obt = obtained[line.id];
              const status = lineStatus[line.id];
              const diff = obt ? obt.obtainedAmount - line.expectedAmount : 0;
              const isBusy = busyLineIds?.has(line.id) || false;
              return (
                <tr key={line.id} className={status === 'red' ? 'bg-red-50/40' : status === 'amber' ? 'bg-amber-50/30' : ''}>
                  <td className="px-3 py-2 text-slate-700">
                    <div className="truncate" title={line.label}>{line.label}</div>
                    {obt?.note && <div className="text-[9px] text-slate-400 mt-0.5">{obt.note}</div>}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-slate-700">{fmt(line.expectedAmount)}</td>
                  <td className="px-2 py-2 text-center">
                    {/* Per-line radio: GL vs Client. Disabled once the
                        population is obtained — re-choosing a source
                        would invalidate the obtained total. To
                        switch source the user clicks Re-obtain. */}
                    <div className="inline-flex items-center gap-2">
                      <label className={`inline-flex items-center gap-1 cursor-pointer text-[10px] ${obt ? 'opacity-60 cursor-not-allowed' : ''}`}>
                        <input
                          type="radio"
                          name={`pop-source-${line.id}`}
                          value="gl"
                          checked={choice === 'gl'}
                          onChange={() => !obt && setChoice(line.id, 'gl')}
                          disabled={!!obt}
                          className="h-3 w-3"
                        />
                        <Database className="h-3 w-3 text-slate-500" />
                        GL
                      </label>
                      <label className={`inline-flex items-center gap-1 cursor-pointer text-[10px] ${obt ? 'opacity-60 cursor-not-allowed' : ''}`}>
                        <input
                          type="radio"
                          name={`pop-source-${line.id}`}
                          value="client"
                          checked={choice === 'client'}
                          onChange={() => !obt && setChoice(line.id, 'client')}
                          disabled={!!obt}
                          className="h-3 w-3"
                        />
                        <MessageSquare className="h-3 w-3 text-slate-500" />
                        Client
                      </label>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-slate-700">{obt ? fmt(obt.obtainedAmount) : '—'}</td>
                  <td className={`px-2 py-2 text-right font-mono tabular-nums ${diff > 0 ? 'text-red-600' : diff < 0 ? 'text-amber-700' : 'text-slate-400'}`}>
                    {obt ? fmt(diff) : '—'}
                  </td>
                  <td className="px-2 py-2 text-center">
                    {status === 'green' && <span className="inline-flex items-center gap-1 text-[10px] text-green-700"><CheckCircle2 className="h-3 w-3" /> Agrees</span>}
                    {status === 'amber' && <span className="inline-flex items-center gap-1 text-[10px] text-amber-700"><AlertTriangle className="h-3 w-3" /> Off ±tol</span>}
                    {status === 'red' && <span className="inline-flex items-center gap-1 text-[10px] text-red-700"><AlertTriangle className="h-3 w-3" /> Material</span>}
                    {status === 'pending' && <span className="text-[10px] text-slate-400">Pending</span>}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Button
                      onClick={() => void handleObtain(line)}
                      disabled={isBusy}
                      size="sm"
                      variant={obt ? 'outline' : 'default'}
                      className="h-6 text-[10px]"
                      title={obt ? 'Re-fetch from the chosen source — replaces the previous result' : `Obtain population from ${choice === 'gl' ? 'the GL' : 'the client portal'}`}
                    >
                      {isBusy
                        ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        : null}
                      {obt ? 'Re-obtain' : 'Obtain'}
                    </Button>
                  </td>
                </tr>
              );
            })}
            {lines.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-4 text-center text-[10px] text-slate-400 italic">No line items in scope for this test.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Continue gate — only enabled once every line has an obtained
          population. Material mismatches don't block but flag a
          warning so the user knows they're advancing with imbalances. */}
      {onContinue && (
        <div className="flex items-center justify-end gap-2 pt-1">
          {allObtained && anyMaterialMismatch && (
            <span className="text-[10px] text-red-700 inline-flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Material mismatch on one or more lines — review before continuing.
            </span>
          )}
          <Button
            onClick={() => onContinue({ choices, obtained })}
            disabled={!allObtained}
            size="sm"
            className="h-7 text-[11px]"
          >
            Continue to Sampling
          </Button>
        </div>
      )}
    </div>
  );
}
