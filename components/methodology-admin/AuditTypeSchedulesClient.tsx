'use client';

import { useState } from 'react';

interface Props {
  firmId: string;
  initialMappings: Record<string, string[]>; // auditType → schedule keys
}

const AUDIT_TYPES = [
  { key: 'SME', label: 'SME Audit' },
  { key: 'PIE', label: 'PIE Audit' },
  { key: 'SME_CONTROLS', label: 'SME Controls Based Audit' },
  { key: 'PIE_CONTROLS', label: 'PIE Controls Based Audit' },
  { key: 'GROUP', label: 'Group' },
];

const SCHEDULES = [
  { key: 'permanent_file_questions', label: 'Permanent File' },
  { key: 'ethics_questions', label: 'Ethics' },
  { key: 'continuance_questions', label: 'Continuance' },
  { key: 'materiality_questions', label: 'Materiality' },
  { key: 'prior_period', label: 'Prior Period' },
  { key: 'trial_balance', label: 'TBCYvPY' },
  { key: 'par', label: 'PAR' },
  { key: 'rmm', label: 'Identifying & Assessing RMM' },
  { key: 'documents', label: 'Documents' },
  { key: 'portal', label: 'Portal' },
];

// Default: all schedules enabled for all audit types
function getDefaults(): Record<string, Set<string>> {
  const d: Record<string, Set<string>> = {};
  for (const at of AUDIT_TYPES) {
    d[at.key] = new Set(SCHEDULES.map(s => s.key));
  }
  return d;
}

export function AuditTypeSchedulesClient({ firmId, initialMappings }: Props) {
  const [mappings, setMappings] = useState<Record<string, Set<string>>>(() => {
    const m: Record<string, Set<string>> = {};
    const defaults = getDefaults();
    for (const at of AUDIT_TYPES) {
      if (initialMappings[at.key] && initialMappings[at.key].length > 0) {
        m[at.key] = new Set(initialMappings[at.key]);
      } else {
        m[at.key] = defaults[at.key];
      }
    }
    return m;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function toggle(auditType: string, scheduleKey: string) {
    setMappings(prev => {
      const next = { ...prev };
      const set = new Set(next[auditType]);
      if (set.has(scheduleKey)) set.delete(scheduleKey);
      else set.add(scheduleKey);
      next[auditType] = set;
      return next;
    });
    setSaved(false);
  }

  function toggleAll(auditType: string) {
    setMappings(prev => {
      const next = { ...prev };
      const current = next[auditType];
      if (current.size === SCHEDULES.length) {
        next[auditType] = new Set();
      } else {
        next[auditType] = new Set(SCHEDULES.map(s => s.key));
      }
      return next;
    });
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    try {
      for (const at of AUDIT_TYPES) {
        await fetch('/api/methodology-admin/audit-type-schedules', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            auditType: at.key,
            schedules: Array.from(mappings[at.key]),
          }),
        });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-slate-500">
          Check the schedules that should be available for each audit type. Unchecked schedules will not appear as tabs.
        </p>
        <button onClick={save} disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Changes'}
        </button>
      </div>

      <div className="border border-slate-200 rounded-lg overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-200">
              <th className="text-left px-4 py-3 text-slate-600 font-semibold w-48">Schedule</th>
              {AUDIT_TYPES.map(at => (
                <th key={at.key} className="text-center px-3 py-3 text-slate-600 font-semibold">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-xs">{at.label}</span>
                    <button onClick={() => toggleAll(at.key)}
                      className="text-[9px] text-blue-500 hover:text-blue-700 font-normal">
                      {mappings[at.key].size === SCHEDULES.length ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SCHEDULES.map((schedule, idx) => (
              <tr key={schedule.key} className={`border-b border-slate-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                <td className="px-4 py-2.5 text-slate-700 font-medium">{schedule.label}</td>
                {AUDIT_TYPES.map(at => {
                  const isChecked = mappings[at.key].has(schedule.key);
                  return (
                    <td key={at.key} className="text-center px-3 py-2.5">
                      <button onClick={() => toggle(at.key, schedule.key)}
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                          isChecked ? 'bg-blue-500 border-blue-500 text-white' : 'bg-white border-slate-300 hover:border-blue-400'
                        }`}>
                        {isChecked && <span className="text-xs">✓</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-xs text-slate-400">
        Changes only affect new engagements. Existing engagements retain their current tab configuration.
      </div>
    </div>
  );
}
