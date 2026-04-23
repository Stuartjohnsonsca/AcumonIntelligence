'use client';

import { useState } from 'react';
import { Plus, Save, Trash2, Loader2, Check } from 'lucide-react';
import type { IndependenceRefreshDaysRule } from '@/lib/independence';
import { AUDIT_TYPE_LABELS } from '@/types/methodology';

/**
 * Firm-Wide Independence re-confirmation cadence.
 *
 * The "All Audit Types [except below]" row is permanent and cannot be
 * deleted — if the admin removes every override, the ALL default still
 * applies. Audit-type-specific overrides can be added and removed.
 *
 * When a team member opens an engagement, the server compares their last
 * confirmation date to the resolved days-for-this-audit-type — if the
 * gap is greater, the popup re-fires.
 */

interface Props {
  initialRules: IndependenceRefreshDaysRule[];
}

const ALL_AUDIT_TYPES: Array<{ value: string; label: string }> = Object.entries(AUDIT_TYPE_LABELS)
  .map(([value, label]) => ({ value, label }));

export function IndependenceRefreshDaysClient({ initialRules }: Props) {
  const [rules, setRules] = useState<IndependenceRefreshDaysRule[]>(() => {
    // Ensure the ALL default row is first and present
    const hasAll = initialRules.some(r => r.auditType === 'ALL');
    return hasAll ? initialRules : [{ auditType: 'ALL', days: 30 }, ...initialRules];
  });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const usedAuditTypes = new Set(rules.map(r => r.auditType));
  const availableToAdd = ALL_AUDIT_TYPES.filter(a => !usedAuditTypes.has(a.value));

  function updateDays(auditType: string, days: number) {
    setRules(prev => prev.map(r => r.auditType === auditType ? { ...r, days: Math.max(1, Math.floor(days || 1)) } : r));
  }
  function addOverride(auditType: string) {
    if (!auditType || usedAuditTypes.has(auditType)) return;
    // Seed a new override with the current ALL default as the starting value.
    const allRule = rules.find(r => r.auditType === 'ALL');
    setRules(prev => [...prev, { auditType, days: allRule?.days ?? 30 }]);
  }
  function removeOverride(auditType: string) {
    if (auditType === 'ALL') return; // permanent default
    setRules(prev => prev.filter(r => r.auditType !== auditType));
  }

  async function saveAll() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/methodology-admin/independence-refresh-days', {
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
      setTimeout(() => setSavedAt(null), 2500);
    } catch (err: any) {
      setError(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white mb-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-800">Re-confirmation cadence (days)</h3>
        <div className="flex items-center gap-2">
          {savedAt && <span className="text-xs text-green-600 flex items-center gap-1"><Check className="h-3 w-3" /> Saved</span>}
          {error && <span className="text-xs text-red-600">{error}</span>}
          <button onClick={saveAll} disabled={saving} className="inline-flex items-center gap-1.5 text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium">
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save cadence
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-600 mb-3">
        How many days after a team member&rsquo;s last Independence confirmation on an engagement before we ask them
        again. The <strong>All Audit Types</strong> row is the permanent default — audit-type overrides below take
        precedence where they exist.
      </p>

      <div className="space-y-2">
        {rules.map(r => {
          const isDefault = r.auditType === 'ALL';
          const label = isDefault ? 'All Audit Types [except below]' : (AUDIT_TYPE_LABELS[r.auditType as keyof typeof AUDIT_TYPE_LABELS] || r.auditType);
          return (
            <div key={r.auditType} className={`grid grid-cols-[1fr_110px_40px] items-center gap-2 px-3 py-2 border rounded ${isDefault ? 'bg-slate-50 border-slate-300' : 'bg-white border-slate-200'}`}>
              <div className="text-sm text-slate-800">
                {isDefault ? <strong>{label}</strong> : label}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={r.days}
                  onChange={e => updateDays(r.auditType, Number(e.target.value))}
                  className="w-20 text-sm border border-slate-200 rounded px-2 py-1"
                />
                <span className="text-xs text-slate-500">days</span>
              </div>
              <div>
                {!isDefault && (
                  <button onClick={() => removeOverride(r.auditType)} className="p-1 text-slate-400 hover:text-red-600" title="Remove override">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {availableToAdd.length > 0 && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
          <span className="text-xs text-slate-500 mr-1">Add override:</span>
          <select
            value=""
            onChange={e => { if (e.target.value) { addOverride(e.target.value); e.currentTarget.value = ''; } }}
            className="text-xs border border-slate-200 rounded px-2 py-1 bg-white"
          >
            <option value="">— pick audit type —</option>
            {availableToAdd.map(a => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
          <Plus className="h-3.5 w-3.5 text-slate-400" />
        </div>
      )}
    </div>
  );
}
