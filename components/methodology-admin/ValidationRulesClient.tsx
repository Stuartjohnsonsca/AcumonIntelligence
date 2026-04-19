'use client';

import { useState } from 'react';
import { Plus, Save, Trash2, AlertTriangle, AlertOctagon, Loader2, Check, FlaskConical, X } from 'lucide-react';
import type { ValidationRule } from '@/lib/validation-rules';
import { evaluateRule, newRuleId, starterRule } from '@/lib/validation-rules';

/**
 * Client for the Methodology Admin → Validation Rules page.
 *
 * Renders a card-per-rule list with inline edit. Admin can add,
 * delete, toggle active, and test-run a rule's expression against
 * typed mock values without leaving the page.
 *
 * Save model: client holds the full rule list; a single "Save all"
 * button pushes the array to the server. Simpler than per-rule PUT
 * and matches how the other firm-wide-settings screens work.
 */

interface Props {
  initialRules: ValidationRule[];
  scheduleKeys: Array<{ key: string; label: string }>;
}

export function ValidationRulesClient({ initialRules, scheduleKeys }: Props) {
  const [rules, setRules] = useState<ValidationRule[]>(initialRules);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Rule-tester state — a panel on each rule card lets the admin
  // type "what if" values for any identifier the rule references
  // and see whether it would fire. Keyed by rule.id.
  const [testOpenFor, setTestOpenFor] = useState<string | null>(null);
  const [testValues, setTestValues] = useState<Record<string, Record<string, string>>>({});

  function update(id: string, patch: Partial<ValidationRule>) {
    setRules(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }
  function addRule() {
    setRules(prev => [...prev, { ...starterRule(), id: newRuleId(), isActive: false }]);
  }
  function removeRule(id: string) {
    if (!confirm('Delete this validation rule? This cannot be undone.')) return;
    setRules(prev => prev.filter(r => r.id !== id));
  }

  async function saveAll() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/methodology-admin/validation-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Save failed (${res.status})`);
        return;
      }
      setSavedAt(new Date());
      setTimeout(() => setSavedAt(prev => (prev && Date.now() - prev.getTime() > 1800 ? null : prev)), 2000);
    } catch (err: any) {
      setError(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {/* ── Save bar ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={addRule}
            className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100 font-medium"
          >
            <Plus className="h-3.5 w-3.5" /> Add rule
          </button>
          <span className="text-xs text-slate-400">
            {rules.filter(r => r.isActive).length} active / {rules.length} total
          </span>
        </div>
        <div className="flex items-center gap-2">
          {savedAt && <span className="text-xs text-green-600 flex items-center gap-1"><Check className="h-3 w-3" /> Saved</span>}
          {error && <span className="text-xs text-red-600">{error}</span>}
          <button
            onClick={saveAll}
            disabled={saving}
            className="inline-flex items-center gap-1.5 text-xs px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save all
          </button>
        </div>
      </div>

      {rules.length === 0 && (
        <div className="border border-dashed border-slate-200 rounded-lg p-8 text-center">
          <p className="text-sm text-slate-500 mb-2">No validation rules yet.</p>
          <p className="text-xs text-slate-400 mb-4">
            Click &ldquo;Add rule&rdquo; to set up the first check. Each rule is a formula that, when true, flags
            a warning or error on the affected schedule.
          </p>
          <button
            onClick={addRule}
            className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100 font-medium"
          >
            <Plus className="h-3.5 w-3.5" /> Add your first rule
          </button>
        </div>
      )}

      {/* ── Rule list ──────────────────────────────────────────────── */}
      <div className="space-y-3">
        {rules.map(rule => {
          const testing = testOpenFor === rule.id;
          const testVals = testValues[rule.id] || {};
          // Evaluate against the test values for live feedback.
          const testEval = testing ? evaluateRule(rule, mapStringValues(testVals)) : null;
          return (
            <div
              key={rule.id}
              className={`border rounded-lg p-4 ${
                rule.isActive
                  ? rule.severity === 'error' ? 'border-red-200 bg-red-50/30' : 'border-amber-200 bg-amber-50/30'
                  : 'border-slate-200 bg-white'
              }`}
            >
              {/* Top row — label + active toggle + delete */}
              <div className="flex items-center gap-3 mb-3">
                <span title={rule.severity === 'error' ? 'Error severity' : 'Warning severity'}>
                  {rule.severity === 'error'
                    ? <AlertOctagon className="h-4 w-4 text-red-600" />
                    : <AlertTriangle className="h-4 w-4 text-amber-500" />}
                </span>
                <input
                  type="text"
                  value={rule.label}
                  onChange={e => update(rule.id, { label: e.target.value })}
                  placeholder="Rule label (shown as the banner heading)"
                  className="flex-1 text-sm font-medium border border-transparent hover:border-slate-200 focus:border-blue-300 rounded px-2 py-1 bg-transparent focus:bg-white outline-none"
                />
                <label className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rule.isActive}
                    onChange={e => update(rule.id, { isActive: e.target.checked })}
                    className="h-3.5 w-3.5"
                  />
                  Active
                </label>
                <button
                  onClick={() => setTestOpenFor(testing ? null : rule.id)}
                  className="p-1 text-slate-400 hover:text-indigo-600"
                  title={testing ? 'Close tester' : 'Test this rule with mock values'}
                >
                  <FlaskConical className="h-4 w-4" />
                </button>
                <button
                  onClick={() => removeRule(rule.id)}
                  className="p-1 text-slate-400 hover:text-red-600"
                  title="Delete rule"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {/* Schedule + Severity row */}
              <div className="grid grid-cols-2 gap-3 mb-2">
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-0.5">Target schedule</label>
                  {scheduleKeys.length > 0 ? (
                    <select
                      value={rule.scheduleKey}
                      onChange={e => update(rule.id, { scheduleKey: e.target.value })}
                      className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white"
                    >
                      <option value="">— pick schedule —</option>
                      {scheduleKeys.map(s => (
                        <option key={s.key} value={s.key}>{s.label} <span className="text-slate-400">({s.key})</span></option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={rule.scheduleKey}
                      onChange={e => update(rule.id, { scheduleKey: e.target.value })}
                      placeholder="e.g. fees, materiality, ethics"
                      className="w-full text-xs border border-slate-200 rounded px-2 py-1.5"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-0.5">Severity</label>
                  <select
                    value={rule.severity}
                    onChange={e => update(rule.id, { severity: e.target.value === 'error' ? 'error' : 'warning' })}
                    className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white"
                  >
                    <option value="warning">Warning (amber — advisory)</option>
                    <option value="error">Error (red — blocks sign-off)</option>
                  </select>
                </div>
              </div>

              {/* Expression */}
              <div className="mb-2">
                <label className="block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-0.5">
                  Expression <span className="text-slate-400 normal-case">(truthy = violation)</span>
                </label>
                <input
                  type="text"
                  value={rule.expression}
                  onChange={e => update(rule.id, { expression: e.target.value })}
                  placeholder="e.g. PERCENT(audit_fee, total_fees) &lt; 25"
                  className="w-full text-xs font-mono border border-slate-200 rounded px-2 py-1.5"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Uses the formula engine. Identifiers are question slugs on the target schedule (e.g. <code>audit_fee</code>).
                  Functions: <code>PERCENT(num, den)</code>, <code>SUM</code>, <code>AVG</code>, <code>MIN</code>, <code>MAX</code>,
                  <code>ABS</code>, <code>IF</code>, <code>AND</code>, <code>OR</code>. Comparisons: <code>&lt;</code>, <code>&gt;</code>,
                  <code>&lt;=</code>, <code>&gt;=</code>, <code>=</code>, <code>!=</code>.
                </p>
              </div>

              {/* Message */}
              <div className="mb-2">
                <label className="block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-0.5">Message shown to the auditor</label>
                <textarea
                  value={rule.message}
                  onChange={e => update(rule.id, { message: e.target.value })}
                  placeholder="Audit fees are below 25% of total fees — consider whether this reflects an appropriate allocation of effort."
                  rows={2}
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1.5"
                />
              </div>

              {/* Tester */}
              {testing && (
                <div className="mt-3 border-t border-dashed border-slate-200 pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-semibold text-slate-700 flex items-center gap-1">
                      <FlaskConical className="h-3 w-3 text-indigo-500" /> Test this rule
                    </span>
                    <button onClick={() => setTestOpenFor(null)} className="text-slate-400 hover:text-slate-600">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-500 mb-2">
                    Type mock values below — the tester evaluates the expression live and tells you whether the rule would fire.
                    Identifiers are picked up automatically from the expression.
                  </p>
                  <RuleTester
                    expression={rule.expression}
                    values={testVals}
                    onChange={(k, v) => setTestValues(prev => ({ ...prev, [rule.id]: { ...(prev[rule.id] || {}), [k]: v } }))}
                  />
                  {testEval && (
                    <div className={`mt-2 text-[11px] p-2 rounded ${
                      testEval.error ? 'bg-orange-50 text-orange-700 border border-orange-200'
                      : testEval.violated ? 'bg-red-50 text-red-700 border border-red-200'
                      : 'bg-green-50 text-green-700 border border-green-200'
                    }`}>
                      {testEval.error
                        ? <>⚠ Expression error: {testEval.error}</>
                        : testEval.violated
                          ? <>🔔 Rule FIRES with these values — auditor would see the banner.</>
                          : <>✓ Rule does not fire — expression evaluated to falsy.</>}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Extract bare identifiers from an expression so the tester can
 *  offer an input for each. Naive — matches the identifier regex
 *  [A-Za-z_][A-Za-z0-9_]* and filters out known function names and
 *  boolean keywords. Good enough to surface the right fields for
 *  manual testing. */
const FUNCTION_NAMES = new Set(['IF', 'SUM', 'ROUND', 'OR', 'AND', 'TRUE', 'FALSE', 'INDEX', 'MATCH', 'AVG', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'ABS', 'PERCENT', 'PCT']);
function extractIdentifiers(expr: string): string[] {
  const found = new Set<string>();
  const re = /[A-Za-z_][A-Za-z0-9_]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    const tok = m[0];
    if (FUNCTION_NAMES.has(tok.toUpperCase())) continue;
    found.add(tok);
  }
  return Array.from(found);
}
function mapStringValues(obj: Record<string, string>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === '') { out[k] = null; continue; }
    const n = Number(v);
    if (Number.isFinite(n) && String(n) === v.trim()) out[k] = n;
    else if (v.toLowerCase() === 'true') out[k] = true;
    else if (v.toLowerCase() === 'false') out[k] = false;
    else out[k] = v;
  }
  return out;
}

function RuleTester({ expression, values, onChange }: { expression: string; values: Record<string, string>; onChange: (k: string, v: string) => void }) {
  const ids = extractIdentifiers(expression);
  if (ids.length === 0) {
    return <span className="text-[10px] text-slate-400 italic">No identifiers in expression — nothing to vary.</span>;
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {ids.map(id => (
        <label key={id} className="flex items-center gap-1.5 text-[11px]">
          <span className="w-24 truncate text-slate-600 font-mono" title={id}>{id}</span>
          <input
            type="text"
            value={values[id] ?? ''}
            onChange={e => onChange(id, e.target.value)}
            placeholder="value"
            className="flex-1 text-[11px] border border-slate-200 rounded px-1.5 py-0.5"
          />
        </label>
      ))}
    </div>
  );
}
