'use client';

import { useState } from 'react';

interface Props {
  firmId: string;
  initialMappings: Record<string, string[]>;
  initialFrameworks?: Record<string, string>; // auditType → selected framework
  initialFrameworkOptions?: string[]; // available frameworks
}

const AUDIT_TYPES = [
  { key: 'SME', label: 'Statutory Audit' },
  { key: 'PIE', label: 'PIE Audit' },
  { key: 'SME_CONTROLS', label: 'Statutory Controls Based Audit' },
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

const DEFAULT_FRAMEWORKS = ['IFRS', 'FRS102'];

function getDefaults(): Record<string, Set<string>> {
  const d: Record<string, Set<string>> = {};
  for (const at of AUDIT_TYPES) {
    d[at.key] = new Set(SCHEDULES.map(s => s.key));
  }
  return d;
}

export function AuditTypeSchedulesClient({ firmId, initialMappings, initialFrameworks = {}, initialFrameworkOptions }: Props) {
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

  const [frameworks, setFrameworks] = useState<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    for (const at of AUDIT_TYPES) f[at.key] = initialFrameworks[at.key] || '';
    return f;
  });

  const [frameworkOptions, setFrameworkOptions] = useState<string[]>(initialFrameworkOptions || DEFAULT_FRAMEWORKS);
  const [newFramework, setNewFramework] = useState('');
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
      if (next[auditType].size === SCHEDULES.length) next[auditType] = new Set();
      else next[auditType] = new Set(SCHEDULES.map(s => s.key));
      return next;
    });
    setSaved(false);
  }

  function addFramework() {
    const fw = newFramework.trim();
    if (fw && !frameworkOptions.includes(fw)) {
      setFrameworkOptions(prev => [...prev, fw]);
      setNewFramework('');
      setSaved(false);
    }
  }

  function removeFramework(fw: string) {
    setFrameworkOptions(prev => prev.filter(f => f !== fw));
    // Clear from any audit types using it
    setFrameworks(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (next[key] === fw) next[key] = '';
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
            framework: frameworks[at.key] || null,
          }),
        });
      }
      // Save framework options
      await fetch('/api/methodology-admin/audit-type-schedules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auditType: '__framework_options',
          schedules: frameworkOptions,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Accounting Frameworks Management */}
      <div className="border border-slate-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Accounting Frameworks</h3>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {frameworkOptions.map(fw => (
            <span key={fw} className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full border border-blue-200">
              {fw}
              <button onClick={() => removeFramework(fw)} className="text-blue-400 hover:text-red-500 text-xs">×</button>
            </span>
          ))}
          <div className="flex items-center gap-1">
            <input type="text" value={newFramework} onChange={e => setNewFramework(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addFramework()}
              placeholder="Add framework..."
              className="border border-slate-200 rounded px-2 py-1 text-sm w-36 focus:outline-none focus:ring-1 focus:ring-blue-400" />
            <button onClick={addFramework} className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100">+ Add</button>
          </div>
        </div>
        <p className="text-[10px] text-slate-400">These frameworks are available for selection per audit type below and in the Test Bank.</p>
      </div>

      {/* Save button */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Check the schedules and select the accounting framework for each audit type.
        </p>
        <button onClick={save} disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Changes'}
        </button>
      </div>

      {/* Matrix table */}
      <div className="border border-slate-200 rounded-lg overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-200">
              <th className="text-left px-4 py-3 text-slate-600 font-semibold w-48"></th>
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
            {/* Accounting Framework row */}
            <tr className="border-b border-slate-200 bg-blue-50/30">
              <td className="px-4 py-2.5 text-slate-700 font-semibold">Accounting Framework</td>
              {AUDIT_TYPES.map(at => (
                <td key={at.key} className="text-center px-2 py-2.5">
                  <select value={frameworks[at.key] || ''}
                    onChange={e => { setFrameworks(prev => ({ ...prev, [at.key]: e.target.value })); setSaved(false); }}
                    className="border border-slate-200 rounded px-2 py-1 text-xs bg-white w-full max-w-[140px]">
                    <option value="">Select...</option>
                    {frameworkOptions.map(fw => <option key={fw} value={fw}>{fw}</option>)}
                  </select>
                </td>
              ))}
            </tr>

            {/* Schedule rows */}
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

      <div className="text-xs text-slate-400">
        Changes only affect new engagements. Existing engagements retain their current configuration.
      </div>
    </div>
  );
}
