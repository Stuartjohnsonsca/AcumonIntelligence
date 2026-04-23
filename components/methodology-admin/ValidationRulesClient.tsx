'use client';

import { useState } from 'react';
import { Plus, Save, Trash2, AlertTriangle, AlertOctagon, Loader2, Check, FlaskConical, X, Sparkles } from 'lucide-react';
import type { ValidationRule } from '@/lib/validation-rules';
import { evaluateRule, newRuleId, starterRule } from '@/lib/validation-rules';

interface AiSuggestion {
  slug: string;
  label: string;
  description: string;
  source: 'real' | 'ai';
}

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
  // AI Help panel — per-rule state so each rule can have its own open panel.
  const [aiHelpOpenFor, setAiHelpOpenFor] = useState<string | null>(null);
  const [aiHelpLoading, setAiHelpLoading] = useState(false);
  const [aiHelpError, setAiHelpError] = useState<string | null>(null);
  const [aiHelpHint, setAiHelpHint] = useState('');
  const [aiHelpSuggestions, setAiHelpSuggestions] = useState<Record<string, AiSuggestion[]>>({});

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

  async function requestAiHelp(rule: ValidationRule) {
    setAiHelpLoading(true);
    setAiHelpError(null);
    try {
      const scheduleLabel = scheduleKeys.find(s => s.key === rule.scheduleKey)?.label || rule.scheduleKey;
      const res = await fetch('/api/methodology-admin/validation-rules/ai-field-help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleKey: rule.scheduleKey,
          scheduleLabel,
          existingExpression: rule.expression,
          userHint: aiHelpHint,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAiHelpError(data.error || `AI request failed (${res.status})`);
        return;
      }
      const data = await res.json();
      // Server returns { verified: [], proposed: [] } — both tagged with
      // `source: 'real' | 'ai'`. We merge for display but the chip render
      // differentiates them visually so the admin can always tell which
      // suggestions are grounded in their actual schedule questions.
      const merged: AiSuggestion[] = [
        ...(Array.isArray(data.verified) ? data.verified : []),
        ...(Array.isArray(data.proposed) ? data.proposed : []),
      ];
      setAiHelpSuggestions(prev => ({ ...prev, [rule.id]: merged }));
      if ((data.realSlugCount ?? 0) === 0 && merged.length === 0) {
        setAiHelpError('No questions found on this schedule, and the AI had nothing to suggest. Add questions to the schedule first.');
      }
    } catch (err: any) {
      setAiHelpError(err?.message || 'AI request failed');
    } finally {
      setAiHelpLoading(false);
    }
  }

  function insertFieldIntoExpression(rule: ValidationRule, slug: string) {
    // Append the slug at the end of the current expression, separated by a
    // space. Admins can then adjust — cheap UX, and we avoid caret tracking
    // on the input ref.
    const expr = rule.expression ? `${rule.expression.trimEnd()} ${slug}` : slug;
    update(rule.id, { expression: expr });
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
                <div className="flex items-center justify-between mb-0.5">
                  <label className="block text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
                    Expression <span className="text-slate-400 normal-case">(truthy = violation)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const opening = aiHelpOpenFor !== rule.id;
                      setAiHelpOpenFor(opening ? rule.id : null);
                      setAiHelpError(null);
                      if (opening) setAiHelpHint('');
                    }}
                    className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100 font-medium"
                    title="Ask AI to suggest field names for this rule"
                    disabled={!rule.scheduleKey}
                  >
                    <Sparkles className="h-3 w-3" /> AI Help
                  </button>
                </div>
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

                {/* AI Help panel — suggestion chips, hint input, error */}
                {aiHelpOpenFor === rule.id && (
                  <div className="mt-3 border border-indigo-200 bg-indigo-50/40 rounded p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-semibold text-indigo-800 flex items-center gap-1">
                        <Sparkles className="h-3 w-3" /> AI field suggestions
                      </span>
                      <button
                        onClick={() => setAiHelpOpenFor(null)}
                        className="text-slate-400 hover:text-slate-600"
                        title="Close AI Help"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-600 mb-2">
                      The list below comes straight from this schedule&rsquo;s real questions (green = verified). The AI
                      may additionally propose slugs for questions that don&rsquo;t exist yet (amber = proposed). Only
                      green slugs will resolve at evaluation time — amber proposals need a matching question added to
                      the schedule first. The AI is never allowed to tag its own inventions as verified.
                    </p>
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="text"
                        value={aiHelpHint}
                        onChange={e => setAiHelpHint(e.target.value)}
                        placeholder="Optional hint — e.g. 'I want to cap non-audit fees at 30% of audit fees'"
                        className="flex-1 text-[11px] border border-slate-200 rounded px-2 py-1"
                      />
                      <button
                        onClick={() => requestAiHelp(rule)}
                        disabled={aiHelpLoading || !rule.scheduleKey}
                        className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {aiHelpLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        {aiHelpLoading ? 'Thinking...' : 'Suggest'}
                      </button>
                    </div>
                    {aiHelpError && (
                      <div className="text-[11px] text-red-600 mb-2">⚠ {aiHelpError}</div>
                    )}
                    {(aiHelpSuggestions[rule.id] || []).length > 0 && (() => {
                      const all = aiHelpSuggestions[rule.id] || [];
                      const verified = all.filter(s => s.source === 'real');
                      const proposed = all.filter(s => s.source === 'ai');
                      return (
                        <div className="space-y-2">
                          {verified.length > 0 && (
                            <div>
                              <div className="text-[10px] uppercase tracking-wide text-green-700 font-semibold mb-1 flex items-center gap-1">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
                                Verified — exist on this schedule
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {verified.map(s => (
                                  <button
                                    key={s.slug}
                                    onClick={() => insertFieldIntoExpression(rule, s.slug)}
                                    title={(s.description || s.label) + ' — exists on schedule, safe to use'}
                                    className="text-left text-[11px] px-2 py-1 rounded border bg-green-50 border-green-200 text-green-800 hover:bg-green-100 transition-colors"
                                  >
                                    <span className="font-mono">{s.slug}</span>
                                    {s.label && s.label !== s.slug && <span className="text-slate-500 ml-1.5">— {s.label}</span>}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          {proposed.length > 0 && (
                            <div>
                              <div className="text-[10px] uppercase tracking-wide text-amber-700 font-semibold mb-1 flex items-center gap-1">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
                                AI proposed — NOT yet on your schedule
                              </div>
                              <p className="text-[10px] text-amber-700 mb-1">
                                These slugs don&rsquo;t exist on this schedule. Using one in a rule will always evaluate to a missing value until you add a matching question first.
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {proposed.map(s => (
                                  <button
                                    key={s.slug}
                                    onClick={() => insertFieldIntoExpression(rule, s.slug)}
                                    title={(s.description || s.label) + ' — AI suggestion, not yet on schedule'}
                                    className="text-left text-[11px] px-2 py-1 rounded border bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100 transition-colors"
                                  >
                                    <span className="font-mono">{s.slug}</span>
                                    {s.label && s.label !== s.slug && <span className="text-slate-500 ml-1.5">— {s.label}</span>}
                                    <span className="ml-1.5 text-[9px] uppercase tracking-wide text-amber-700">proposed</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {(aiHelpSuggestions[rule.id] || []).length === 0 && !aiHelpLoading && !aiHelpError && (
                      <p className="text-[10px] text-slate-400 italic">
                        Click <strong>Suggest</strong> to see the schedule&rsquo;s real question slugs plus any AI proposals for new fields you might need.
                      </p>
                    )}
                  </div>
                )}
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
