'use client';

import { useState } from 'react';
import { ChevronUp, ChevronDown, Plus, X, Save, Loader2 } from 'lucide-react';

interface MasterSchedule {
  key: string;
  label: string;
  stage: 'planning' | 'fieldwork' | 'completion';
}

interface Props {
  firmId: string;
  initialMappings: Record<string, string[]>;
  initialFrameworks?: Record<string, string>;
  initialFrameworkOptions?: string[];
  initialMasterSchedules?: MasterSchedule[];
}

const AUDIT_TYPES = [
  { key: 'SME', label: 'Statutory Audit' },
  { key: 'PIE', label: 'PIE Audit' },
  { key: 'SME_CONTROLS', label: 'Statutory Controls Based Audit' },
  { key: 'PIE_CONTROLS', label: 'PIE Controls Based Audit' },
  { key: 'GROUP', label: 'Group' },
];

const STAGES = [
  { key: 'planning' as const, label: 'Planning', colour: 'bg-blue-50 text-blue-700 border-blue-200' },
  { key: 'fieldwork' as const, label: 'Fieldwork', colour: 'bg-amber-50 text-amber-700 border-amber-200' },
  { key: 'completion' as const, label: 'Completion', colour: 'bg-green-50 text-green-700 border-green-200' },
];

const DEFAULT_MASTER: MasterSchedule[] = [
  { key: 'permanent_file_questions', label: 'Permanent File', stage: 'planning' },
  { key: 'ethics_questions', label: 'Ethics', stage: 'planning' },
  { key: 'continuance_questions', label: 'Continuance', stage: 'planning' },
  { key: 'new_client_takeon_questions', label: 'New Client Take-On', stage: 'planning' },
  { key: 'prior_period', label: 'Prior Period', stage: 'planning' },
  { key: 'trial_balance', label: 'TBCYvPY', stage: 'planning' },
  { key: 'materiality_questions', label: 'Materiality', stage: 'planning' },
  { key: 'par', label: 'PAR', stage: 'fieldwork' },
  { key: 'walkthroughs', label: 'Walkthroughs', stage: 'fieldwork' },
  { key: 'rmm', label: 'Identifying & Assessing RMM', stage: 'fieldwork' },
  { key: 'documents', label: 'Documents', stage: 'fieldwork' },
  { key: 'communication', label: 'Communication', stage: 'fieldwork' },
  { key: 'outstanding', label: 'Outstanding', stage: 'completion' },
  { key: 'portal', label: 'Portal', stage: 'completion' },
  { key: 'subsequent_events_questions', label: 'Subsequent Events', stage: 'completion' },
  { key: 'tax_technical_categories', label: 'Tax Technical', stage: 'completion' },
];

const DEFAULT_FRAMEWORKS = ['IFRS', 'FRS102'];

function toKey(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function AuditTypeSchedulesClient({
  firmId,
  initialMappings,
  initialFrameworks = {},
  initialFrameworkOptions,
  initialMasterSchedules,
}: Props) {
  // Master schedule list
  const [masterSchedules, setMasterSchedules] = useState<MasterSchedule[]>(
    Array.isArray(initialMasterSchedules) && initialMasterSchedules.length > 0
      ? initialMasterSchedules
      : DEFAULT_MASTER
  );
  const [showMasterEditor, setShowMasterEditor] = useState(false);
  const [newScheduleLabel, setNewScheduleLabel] = useState('');
  const [newScheduleStage, setNewScheduleStage] = useState<'planning' | 'fieldwork' | 'completion'>('planning');

  // Per-audit-type ordered schedule lists
  const [orderedMappings, setOrderedMappings] = useState<Record<string, string[]>>(() => {
    const m: Record<string, string[]> = {};
    for (const at of AUDIT_TYPES) {
      if (initialMappings[at.key] && initialMappings[at.key].length > 0) {
        m[at.key] = initialMappings[at.key];
      } else {
        // Default: all master schedules in master order
        m[at.key] = masterSchedules.map(s => s.key);
      }
    }
    return m;
  });

  // Active audit type for ordering panel
  const [activeAuditType, setActiveAuditType] = useState(AUDIT_TYPES[0].key);

  // Frameworks
  const [frameworks, setFrameworks] = useState<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    for (const at of AUDIT_TYPES) f[at.key] = initialFrameworks[at.key] || '';
    return f;
  });
  const [frameworkOptions, setFrameworkOptions] = useState<string[]>(initialFrameworkOptions || DEFAULT_FRAMEWORKS);
  const [newFramework, setNewFramework] = useState('');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savingMaster, setSavingMaster] = useState(false);

  // ── Master schedule management ──

  function addMasterSchedule() {
    const label = newScheduleLabel.trim();
    if (!label) return;
    const key = toKey(label);
    if (masterSchedules.some(s => s.key === key)) return;
    setMasterSchedules(prev => [...prev, { key, label, stage: newScheduleStage }]);
    setNewScheduleLabel('');
  }

  function removeMasterSchedule(key: string) {
    setMasterSchedules(prev => prev.filter(s => s.key !== key));
    // Also remove from all audit type mappings
    setOrderedMappings(prev => {
      const next = { ...prev };
      for (const at of AUDIT_TYPES) {
        next[at.key] = (next[at.key] || []).filter(k => k !== key);
      }
      return next;
    });
  }

  function updateMasterSchedule(key: string, field: 'label' | 'stage', value: string) {
    setMasterSchedules(prev => prev.map(s => s.key === key ? { ...s, [field]: value } : s));
  }

  function moveMasterSchedule(key: string, direction: -1 | 1) {
    setMasterSchedules(prev => {
      const idx = prev.findIndex(s => s.key === key);
      if (idx < 0) return prev;
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  }

  async function saveMasterSchedules() {
    setSavingMaster(true);
    try {
      await fetch('/api/methodology-admin/audit-type-schedules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_master', schedules: masterSchedules }),
      });
    } catch {}
    setSavingMaster(false);
  }

  // ── Per-audit-type ordering ──

  function toggleSchedule(auditType: string, scheduleKey: string) {
    setOrderedMappings(prev => {
      const next = { ...prev };
      const list = [...(next[auditType] || [])];
      const idx = list.indexOf(scheduleKey);
      if (idx >= 0) {
        list.splice(idx, 1);
      } else {
        // Insert in master order position
        const masterIdx = masterSchedules.findIndex(s => s.key === scheduleKey);
        let insertIdx = list.length;
        for (let i = 0; i < list.length; i++) {
          const mi = masterSchedules.findIndex(s => s.key === list[i]);
          if (mi > masterIdx) { insertIdx = i; break; }
        }
        list.splice(insertIdx, 0, scheduleKey);
      }
      next[auditType] = list;
      return next;
    });
    setSaved(false);
  }

  function moveSchedule(auditType: string, scheduleKey: string, direction: -1 | 1) {
    setOrderedMappings(prev => {
      const next = { ...prev };
      const list = [...(next[auditType] || [])];
      const idx = list.indexOf(scheduleKey);
      if (idx < 0) return prev;
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= list.length) return prev;
      [list[idx], list[newIdx]] = [list[newIdx], list[idx]];
      next[auditType] = list;
      return next;
    });
    setSaved(false);
  }

  function toggleAll(auditType: string) {
    setOrderedMappings(prev => {
      const next = { ...prev };
      if ((next[auditType] || []).length === masterSchedules.length) {
        next[auditType] = [];
      } else {
        next[auditType] = masterSchedules.map(s => s.key);
      }
      return next;
    });
    setSaved(false);
  }

  // ── Framework management ──

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
    setFrameworks(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (next[key] === fw) next[key] = '';
      }
      return next;
    });
    setSaved(false);
  }

  // ── Save all ──

  async function saveAll() {
    setSaving(true);
    try {
      // Save master schedules
      await fetch('/api/methodology-admin/audit-type-schedules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_master', schedules: masterSchedules }),
      });

      // Save per-audit-type mappings + frameworks
      for (const at of AUDIT_TYPES) {
        await fetch('/api/methodology-admin/audit-type-schedules', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            auditType: at.key,
            schedules: orderedMappings[at.key] || [],
            framework: frameworks[at.key] || null,
          }),
        });
      }

      // Save framework options
      await fetch('/api/methodology-admin/audit-type-schedules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auditType: '__framework_options', schedules: frameworkOptions }),
      });

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  }

  // ── Helpers ──

  const getMaster = (key: string) => masterSchedules.find(s => s.key === key);
  const getStageColour = (stage: string) => STAGES.find(s => s.key === stage)?.colour || 'bg-slate-50 text-slate-600';
  const activeList = orderedMappings[activeAuditType] || [];
  const activeEnabled = new Set(activeList);

  // Group master schedules by stage for the master editor
  const masterByStage = STAGES.map(stage => ({
    ...stage,
    schedules: masterSchedules.filter(s => s.stage === stage.key),
  }));

  return (
    <div className="space-y-6">
      {/* ═══ Master Schedule List ═══ */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <button
          onClick={() => setShowMasterEditor(!showMasterEditor)}
          className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
        >
          <h2 className="text-sm font-semibold text-slate-800">
            Master Schedule List <span className="text-xs font-normal text-slate-400 ml-1">{masterSchedules.length} schedules</span>
          </h2>
          {showMasterEditor ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </button>

        {showMasterEditor && (
          <div className="p-4 space-y-4">
            <p className="text-[10px] text-slate-400">
              Define all available schedules. Each audit type selects from this master list.
              Use arrows to reorder. Stage determines grouping in the engagement view.
            </p>

            {masterByStage.map(stageGroup => (
              <div key={stageGroup.key}>
                <div className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded border mb-2 ${stageGroup.colour}`}>
                  {stageGroup.label}
                </div>
                <div className="border rounded-lg divide-y">
                  {stageGroup.schedules.map((schedule, idx) => {
                    const globalIdx = masterSchedules.findIndex(s => s.key === schedule.key);
                    return (
                      <div key={schedule.key} className="flex items-center gap-2 px-3 py-1.5">
                        <div className="flex flex-col">
                          <button onClick={() => moveMasterSchedule(schedule.key, -1)} disabled={globalIdx === 0}
                            className="text-slate-400 hover:text-slate-600 disabled:opacity-20">
                            <ChevronUp className="h-3 w-3" />
                          </button>
                          <button onClick={() => moveMasterSchedule(schedule.key, 1)} disabled={globalIdx === masterSchedules.length - 1}
                            className="text-slate-400 hover:text-slate-600 disabled:opacity-20">
                            <ChevronDown className="h-3 w-3" />
                          </button>
                        </div>
                        <input type="text" value={schedule.label}
                          onChange={e => updateMasterSchedule(schedule.key, 'label', e.target.value)}
                          className="flex-1 border rounded px-2 py-1 text-sm" />
                        <span className="text-[9px] text-slate-400 font-mono w-40 truncate">{schedule.key}</span>
                        <select value={schedule.stage}
                          onChange={e => updateMasterSchedule(schedule.key, 'stage', e.target.value)}
                          className="border rounded px-2 py-1 text-xs">
                          {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                        </select>
                        <button onClick={() => removeMasterSchedule(schedule.key)}
                          className="text-red-400 hover:text-red-600">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                  {stageGroup.schedules.length === 0 && (
                    <div className="px-3 py-2 text-[10px] text-slate-400 italic">No schedules in this stage</div>
                  )}
                </div>
              </div>
            ))}

            {/* Add new schedule */}
            <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
              <input type="text" value={newScheduleLabel} onChange={e => setNewScheduleLabel(e.target.value)}
                placeholder="New schedule name..." className="flex-1 border rounded px-2 py-1.5 text-sm"
                onKeyDown={e => e.key === 'Enter' && addMasterSchedule()} />
              <select value={newScheduleStage} onChange={e => setNewScheduleStage(e.target.value as any)}
                className="border rounded px-2 py-1.5 text-xs">
                {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <button onClick={addMasterSchedule}
                className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 font-medium">
                <Plus className="h-3 w-3 inline mr-1" />Add
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ═══ Accounting Frameworks ═══ */}
      <div className="border border-slate-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Accounting Frameworks</h3>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {frameworkOptions.map(fw => (
            <span key={fw} className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full border border-blue-200">
              {fw}
              <button onClick={() => removeFramework(fw)} className="text-blue-400 hover:text-red-500 text-xs">&times;</button>
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

      {/* ═══ Save Button ═══ */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Select schedules per audit type and drag to reorder. Order determines tab sequence in engagements.
        </p>
        <button onClick={saveAll} disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save All Changes'}
        </button>
      </div>

      {/* ═══ Per-Audit-Type Configuration ═══ */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        {/* Audit type tab bar */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 border-b border-slate-200">
          {AUDIT_TYPES.map(at => (
            <button key={at.key} onClick={() => setActiveAuditType(at.key)}
              className={`px-4 py-2 text-xs font-medium rounded-md transition-colors ${
                activeAuditType === at.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {at.label}
            </button>
          ))}
        </div>

        <div className="p-4">
          {/* Framework selector */}
          <div className="flex items-center gap-3 mb-4 pb-3 border-b border-slate-200">
            <span className="text-sm text-slate-600 font-medium">Accounting Framework:</span>
            <select value={frameworks[activeAuditType] || ''}
              onChange={e => { setFrameworks(prev => ({ ...prev, [activeAuditType]: e.target.value })); setSaved(false); }}
              className="border border-slate-200 rounded px-3 py-1.5 text-sm bg-white">
              <option value="">Select...</option>
              {frameworkOptions.map(fw => <option key={fw} value={fw}>{fw}</option>)}
            </select>
            <div className="flex-1" />
            <button onClick={() => toggleAll(activeAuditType)}
              className="text-[10px] text-blue-500 hover:text-blue-700">
              {activeEnabled.size === masterSchedules.length ? 'Deselect all' : 'Select all'}
            </button>
          </div>

          {/* Ordered schedule list grouped by stage */}
          <div className="space-y-4">
            {STAGES.map(stage => {
              const stageSchedules = masterSchedules.filter(s => s.stage === stage.key);
              if (stageSchedules.length === 0) return null;

              // Get enabled schedules in this stage, in their configured order
              const enabledInStage = activeList.filter(k => {
                const m = getMaster(k);
                return m && m.stage === stage.key;
              });
              // Get disabled schedules in this stage (in master order)
              const disabledInStage = stageSchedules.filter(s => !activeEnabled.has(s.key));

              return (
                <div key={stage.key}>
                  <div className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded border mb-2 ${stage.colour}`}>
                    {stage.label} <span className="font-normal">({enabledInStage.length}/{stageSchedules.length})</span>
                  </div>

                  <div className="border rounded-lg divide-y">
                    {/* Enabled schedules (in configured order) */}
                    {enabledInStage.map((key, idx) => {
                      const schedule = getMaster(key);
                      if (!schedule) return null;
                      const globalIdx = activeList.indexOf(key);
                      return (
                        <div key={key} className="flex items-center gap-3 px-3 py-2 bg-white">
                          <button onClick={() => toggleSchedule(activeAuditType, key)}
                            className="w-5 h-5 rounded border-2 bg-blue-500 border-blue-500 text-white flex items-center justify-center text-xs flex-shrink-0">
                            &#10003;
                          </button>
                          <span className="text-sm text-slate-700 flex-1">{schedule.label}</span>
                          <span className="text-[9px] text-slate-300 font-mono">{idx + 1}</span>
                          <div className="flex items-center gap-0.5">
                            <button onClick={() => moveSchedule(activeAuditType, key, -1)} disabled={globalIdx === 0}
                              className="p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-20">
                              <ChevronUp className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => moveSchedule(activeAuditType, key, 1)} disabled={globalIdx === activeList.length - 1}
                              className="p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-20">
                              <ChevronDown className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {/* Disabled schedules (available to add) */}
                    {disabledInStage.map(schedule => (
                      <div key={schedule.key} className="flex items-center gap-3 px-3 py-2 bg-slate-50/50 opacity-60">
                        <button onClick={() => toggleSchedule(activeAuditType, schedule.key)}
                          className="w-5 h-5 rounded border-2 bg-white border-slate-300 hover:border-blue-400 flex-shrink-0" />
                        <span className="text-sm text-slate-500 flex-1">{schedule.label}</span>
                      </div>
                    ))}

                    {stageSchedules.length === 0 && (
                      <div className="px-3 py-2 text-[10px] text-slate-400 italic">No schedules</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="text-xs text-slate-400">
        Changes only affect new engagements. Existing engagements retain their current configuration.
      </div>
    </div>
  );
}
