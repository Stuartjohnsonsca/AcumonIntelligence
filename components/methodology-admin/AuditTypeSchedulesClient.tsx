'use client';

import { useState } from 'react';
import { ChevronUp, ChevronDown, Plus, X, Save, Loader2, Copy, GripVertical, Eye } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface MasterSchedule {
  key: string;
  label: string;
  defaultStage?: 'planning' | 'fieldwork' | 'completion';
  // legacy field (pre Part E)
  stage?: 'planning' | 'fieldwork' | 'completion';
}

type ScheduleVisibility = {
  requiresListed?: boolean;
  requiresEQR?: boolean;
  requiresPriorPeriod?: boolean;
  /** Only show if this IS a first-year audit. Mutually exclusive with requiresPriorPeriod. */
  requiresFirstYear?: boolean;
};

type StageKeyedMapping = {
  planning: string[];
  fieldwork: string[];
  completion: string[];
  conditions: Record<string, ScheduleVisibility>;
};

type Stage = 'planning' | 'fieldwork' | 'completion';

interface Props {
  firmId: string;
  initialMappings: Record<string, string[]>;
  initialStageKeyedMappings?: Record<string, StageKeyedMapping>;
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

const STAGES: Array<{ key: Stage; label: string; colour: string; bg: string }> = [
  { key: 'planning', label: 'Planning', colour: 'text-blue-700 border-blue-200', bg: 'bg-blue-50' },
  { key: 'fieldwork', label: 'Fieldwork', colour: 'text-amber-700 border-amber-200', bg: 'bg-amber-50' },
  { key: 'completion', label: 'Completion', colour: 'text-green-700 border-green-200', bg: 'bg-green-50' },
];

const DEFAULT_FRAMEWORKS = ['IFRS', 'FRS102'];

function toKey(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function emptyMapping(): StageKeyedMapping {
  return { planning: [], fieldwork: [], completion: [], conditions: {} };
}

// Normalise: accept either pre-existing stage-keyed or flat list
function normaliseToStageKeyed(
  auditType: string,
  stageKeyedIn: Record<string, StageKeyedMapping> | undefined,
  flatIn: Record<string, string[]>,
  master: MasterSchedule[],
): StageKeyedMapping {
  if (stageKeyedIn && stageKeyedIn[auditType]) return stageKeyedIn[auditType];
  const flat = flatIn[auditType];
  if (flat && flat.length > 0) {
    const out = emptyMapping();
    for (const k of flat) {
      const m = master.find(s => s.key === k);
      const stage = (m?.defaultStage || m?.stage || 'planning') as Stage;
      out[stage].push(k);
    }
    return out;
  }
  // Default — populate from master by defaultStage
  const out = emptyMapping();
  for (const s of master) {
    const stage = (s.defaultStage || s.stage || 'planning') as Stage;
    out[stage].push(s.key);
  }
  return out;
}

// ═════ Sortable card ═════

function ScheduleCard({
  id,
  label,
  conditions,
  onToggleCondition,
  onRemove,
  isDragging,
}: {
  id: string;
  label: string;
  conditions: ScheduleVisibility;
  onToggleCondition: (key: keyof ScheduleVisibility) => void;
  onRemove: () => void;
  isDragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging: sortableDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: sortableDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-white border border-slate-200 rounded-md px-2 py-1.5 mb-1.5 flex items-center gap-1.5 text-[11px] ${
        isDragging ? 'shadow-lg' : ''
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="text-slate-400 hover:text-slate-600 cursor-grab active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-3 w-3" />
      </button>
      <span className="flex-1 font-medium text-slate-700 truncate">{label}</span>
      {/* Visibility condition toggles */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => onToggleCondition('requiresListed')}
          title="Only show for Listed clients"
          className={`text-[8px] font-semibold uppercase px-1 py-0.5 rounded ${
            conditions.requiresListed ? 'bg-amber-100 text-amber-700 border border-amber-300' : 'bg-slate-50 text-slate-400 border border-slate-200 hover:bg-slate-100'
          }`}
        >
          LST
        </button>
        <button
          onClick={() => onToggleCondition('requiresEQR')}
          title="Only show when EQR is on the team"
          className={`text-[8px] font-semibold uppercase px-1 py-0.5 rounded ${
            conditions.requiresEQR ? 'bg-purple-100 text-purple-700 border border-purple-300' : 'bg-slate-50 text-slate-400 border border-slate-200 hover:bg-slate-100'
          }`}
        >
          EQR
        </button>
        <button
          onClick={() => onToggleCondition('requiresPriorPeriod')}
          title="Only show when this client has a prior-period engagement (continuing audit)"
          className={`text-[8px] font-semibold uppercase px-1 py-0.5 rounded ${
            conditions.requiresPriorPeriod ? 'bg-cyan-100 text-cyan-700 border border-cyan-300' : 'bg-slate-50 text-slate-400 border border-slate-200 hover:bg-slate-100'
          }`}
        >
          PP
        </button>
        <button
          onClick={() => onToggleCondition('requiresFirstYear')}
          title="Only show when this is a first-year audit (no prior-period engagement)"
          className={`text-[8px] font-semibold uppercase px-1 py-0.5 rounded ${
            conditions.requiresFirstYear ? 'bg-emerald-100 text-emerald-700 border border-emerald-300' : 'bg-slate-50 text-slate-400 border border-slate-200 hover:bg-slate-100'
          }`}
        >
          FY
        </button>
      </div>
      <button
        onClick={onRemove}
        className="text-slate-400 hover:text-red-500"
        aria-label="Remove"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function StageColumn({
  stage,
  keys,
  masterSchedules,
  conditions,
  onToggleCondition,
  onRemoveKey,
}: {
  stage: typeof STAGES[number];
  keys: string[];
  masterSchedules: MasterSchedule[];
  conditions: Record<string, ScheduleVisibility>;
  onToggleCondition: (key: string, cond: keyof ScheduleVisibility) => void;
  onRemoveKey: (key: string) => void;
}) {
  return (
    <div className={`rounded-lg border ${stage.colour} ${stage.bg} p-2 min-h-[300px]`}>
      <h3 className={`text-xs font-bold uppercase tracking-wide ${stage.colour} mb-2 text-center`}>
        {stage.label}
      </h3>
      <SortableContext items={keys} strategy={verticalListSortingStrategy}>
        {keys.length === 0 && (
          <div className="text-[10px] text-slate-400 text-center py-4 italic">Drop schedules here</div>
        )}
        {keys.map(k => {
          const label = masterSchedules.find(s => s.key === k)?.label || k;
          return (
            <ScheduleCard
              key={k}
              id={k}
              label={label}
              conditions={conditions[k] || {}}
              onToggleCondition={(cond) => onToggleCondition(k, cond)}
              onRemove={() => onRemoveKey(k)}
            />
          );
        })}
      </SortableContext>
    </div>
  );
}

// ═════ Main component ═════

export function AuditTypeSchedulesClient({
  firmId,
  initialMappings,
  initialStageKeyedMappings,
  initialFrameworks = {},
  initialFrameworkOptions,
  initialMasterSchedules,
}: Props) {
  const [masterSchedules, setMasterSchedules] = useState<MasterSchedule[]>(
    Array.isArray(initialMasterSchedules) && initialMasterSchedules.length > 0 ? initialMasterSchedules : []
  );

  const [stageMappings, setStageMappings] = useState<Record<string, StageKeyedMapping>>(() => {
    const m: Record<string, StageKeyedMapping> = {};
    for (const at of AUDIT_TYPES) {
      m[at.key] = normaliseToStageKeyed(at.key, initialStageKeyedMappings, initialMappings, masterSchedules);
    }
    return m;
  });

  const [activeAuditType, setActiveAuditType] = useState(AUDIT_TYPES[0].key);
  const [copyFrom, setCopyFrom] = useState<string>('');

  // Frameworks
  const [frameworks, setFrameworks] = useState<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    for (const at of AUDIT_TYPES) f[at.key] = initialFrameworks[at.key] || '';
    return f;
  });
  const [frameworkOptions, setFrameworkOptions] = useState<string[]>(initialFrameworkOptions || DEFAULT_FRAMEWORKS);
  const [newFramework, setNewFramework] = useState('');

  // Master editor
  const [showMasterEditor, setShowMasterEditor] = useState(false);
  const [newScheduleLabel, setNewScheduleLabel] = useState('');
  const [newScheduleStage, setNewScheduleStage] = useState<Stage>('planning');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savingMaster, setSavingMaster] = useState(false);

  // Drag state
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const activeMapping = stageMappings[activeAuditType] || emptyMapping();

  // ── Derived: schedules NOT yet in the active audit type (available drawer) ──
  const assignedSet = new Set<string>([
    ...activeMapping.planning,
    ...activeMapping.fieldwork,
    ...activeMapping.completion,
  ]);
  const availableSchedules = masterSchedules.filter(s => !assignedSet.has(s.key));

  // ── Find which stage a key belongs to inside active mapping ──
  function findStage(key: string): Stage | null {
    if (activeMapping.planning.includes(key)) return 'planning';
    if (activeMapping.fieldwork.includes(key)) return 'fieldwork';
    if (activeMapping.completion.includes(key)) return 'completion';
    return null;
  }

  // ── DnD handlers ──
  function handleDragStart(event: DragStartEvent) {
    setActiveDragId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    setStageMappings(prev => {
      const next = { ...prev };
      const am = { ...next[activeAuditType] };
      const pl = [...am.planning];
      const fw = [...am.fieldwork];
      const co = [...am.completion];
      const lookup: Record<Stage, string[]> = { planning: pl, fieldwork: fw, completion: co };

      // Find source stage
      let sourceStage: Stage | null = null;
      for (const s of STAGES) {
        if (lookup[s.key].includes(activeId)) {
          sourceStage = s.key;
          break;
        }
      }
      if (!sourceStage) return prev;

      // Find target stage (over an item)
      let targetStage: Stage | null = null;
      for (const s of STAGES) {
        if (lookup[s.key].includes(overId)) {
          targetStage = s.key;
          break;
        }
      }
      if (!targetStage) return prev;

      const sourceList = lookup[sourceStage];
      const targetList = lookup[targetStage];

      if (sourceStage === targetStage) {
        const oldIdx = sourceList.indexOf(activeId);
        const newIdx = targetList.indexOf(overId);
        lookup[sourceStage] = arrayMove(sourceList, oldIdx, newIdx);
      } else {
        // Remove from source
        const srcIdx = sourceList.indexOf(activeId);
        sourceList.splice(srcIdx, 1);
        // Insert into target at the over-item position
        const overIdx = targetList.indexOf(overId);
        targetList.splice(overIdx, 0, activeId);
      }

      am.planning = lookup.planning;
      am.fieldwork = lookup.fieldwork;
      am.completion = lookup.completion;
      next[activeAuditType] = am;
      return next;
    });
    setSaved(false);
  }

  // ── Actions ──

  function toggleCondition(key: string, cond: keyof ScheduleVisibility) {
    setStageMappings(prev => {
      const next = { ...prev };
      const am = { ...next[activeAuditType] };
      const conditions = { ...am.conditions };
      const existing = conditions[key] || {};
      const toggled = { ...existing, [cond]: !existing[cond] };
      // Mutual exclusivity: FY and PP cannot both be set on the same schedule
      if (cond === 'requiresFirstYear' && toggled.requiresFirstYear) toggled.requiresPriorPeriod = false;
      if (cond === 'requiresPriorPeriod' && toggled.requiresPriorPeriod) toggled.requiresFirstYear = false;
      conditions[key] = toggled;
      // Clean up empty
      if (!toggled.requiresListed && !toggled.requiresEQR && !toggled.requiresPriorPeriod && !toggled.requiresFirstYear) {
        delete conditions[key];
      }
      am.conditions = conditions;
      next[activeAuditType] = am;
      return next;
    });
    setSaved(false);
  }

  function removeKey(key: string) {
    setStageMappings(prev => {
      const next = { ...prev };
      const am = { ...next[activeAuditType] };
      am.planning = am.planning.filter(k => k !== key);
      am.fieldwork = am.fieldwork.filter(k => k !== key);
      am.completion = am.completion.filter(k => k !== key);
      const cond = { ...am.conditions };
      delete cond[key];
      am.conditions = cond;
      next[activeAuditType] = am;
      return next;
    });
    setSaved(false);
  }

  function addKeyToStage(key: string, stage: Stage) {
    setStageMappings(prev => {
      const next = { ...prev };
      const am = { ...next[activeAuditType] };
      if (!am[stage].includes(key)) {
        am[stage] = [...am[stage], key];
      }
      next[activeAuditType] = am;
      return next;
    });
    setSaved(false);
  }

  async function copyFromAuditType() {
    if (!copyFrom || copyFrom === activeAuditType) return;
    setStageMappings(prev => {
      const source = prev[copyFrom];
      if (!source) return prev;
      const copied: StageKeyedMapping = {
        planning: [...source.planning],
        fieldwork: [...source.fieldwork],
        completion: [...source.completion],
        conditions: JSON.parse(JSON.stringify(source.conditions || {})),
      };
      return { ...prev, [activeAuditType]: copied };
    });
    setSaved(false);
    setCopyFrom('');
  }

  // ── Master editor handlers ──

  function addMasterSchedule() {
    const label = newScheduleLabel.trim();
    if (!label) return;
    const key = toKey(label);
    if (masterSchedules.some(s => s.key === key)) return;
    setMasterSchedules(prev => [...prev, { key, label, defaultStage: newScheduleStage }]);
    setNewScheduleLabel('');
  }

  function removeMasterSchedule(key: string) {
    setMasterSchedules(prev => prev.filter(s => s.key !== key));
    setStageMappings(prev => {
      const next = { ...prev };
      for (const at of AUDIT_TYPES) {
        const am = { ...next[at.key] };
        am.planning = am.planning.filter(k => k !== key);
        am.fieldwork = am.fieldwork.filter(k => k !== key);
        am.completion = am.completion.filter(k => k !== key);
        const cond = { ...am.conditions };
        delete cond[key];
        am.conditions = cond;
        next[at.key] = am;
      }
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

  async function saveAll() {
    setSaving(true);
    try {
      // Save master list
      await fetch('/api/methodology-admin/audit-type-schedules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_master', schedules: masterSchedules }),
      });

      // Save each audit type's stage-keyed mapping + framework
      for (const at of AUDIT_TYPES) {
        await fetch('/api/methodology-admin/audit-type-schedules', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            auditType: at.key,
            stageKeyed: stageMappings[at.key] || emptyMapping(),
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

  // ── Render ──

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
          <div className="p-4 space-y-3">
            <p className="text-[10px] text-slate-400">
              Defines all available schedules. Each audit type picks from this master list and drags them
              into Planning / Fieldwork / Completion columns below.
            </p>

            <div className="space-y-1">
              {masterSchedules.map(s => (
                <div key={s.key} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 text-slate-700">{s.label}</span>
                  <span className="text-[9px] text-slate-400 uppercase">{s.defaultStage || s.stage}</span>
                  <button onClick={() => removeMasterSchedule(s.key)} className="text-slate-400 hover:text-red-500">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-end gap-2 pt-2 border-t border-slate-100">
              <div className="flex-1">
                <label className="text-[10px] text-slate-500">New schedule label</label>
                <input
                  type="text"
                  value={newScheduleLabel}
                  onChange={e => setNewScheduleLabel(e.target.value)}
                  placeholder="e.g. Fraud Risk Assessment"
                  className="w-full text-xs border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500">Default stage</label>
                <select
                  value={newScheduleStage}
                  onChange={e => setNewScheduleStage(e.target.value as Stage)}
                  className="text-xs border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:border-blue-400"
                >
                  {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <button
                onClick={addMasterSchedule}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                <Plus className="h-3 w-3" /> Add
              </button>
              <button
                onClick={saveMasterSchedules}
                disabled={savingMaster}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-slate-600 text-white rounded hover:bg-slate-700 disabled:opacity-50"
              >
                {savingMaster ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Save
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ═══ Audit type selector ═══ */}
      <div className="flex items-center gap-2 overflow-x-auto">
        {AUDIT_TYPES.map(at => (
          <button
            key={at.key}
            onClick={() => setActiveAuditType(at.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
              activeAuditType === at.key
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {at.label}
          </button>
        ))}

        <div className="flex-1" />

        {/* Copy from */}
        <div className="flex items-center gap-1">
          <select
            value={copyFrom}
            onChange={e => setCopyFrom(e.target.value)}
            className="text-xs border border-slate-300 rounded px-2 py-1 focus:outline-none"
          >
            <option value="">Copy from…</option>
            {AUDIT_TYPES.filter(at => at.key !== activeAuditType).map(at => (
              <option key={at.key} value={at.key}>{at.label}</option>
            ))}
          </select>
          <button
            onClick={copyFromAuditType}
            disabled={!copyFrom}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-slate-100 text-slate-700 border border-slate-300 rounded hover:bg-slate-200 disabled:opacity-50"
          >
            <Copy className="h-3 w-3" /> Copy
          </button>
        </div>
      </div>

      {/* ═══ Framework + Save All ═══ */}
      <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg">
        <label className="text-xs text-slate-600">Framework:</label>
        <select
          value={frameworks[activeAuditType] || ''}
          onChange={e => { setFrameworks(prev => ({ ...prev, [activeAuditType]: e.target.value })); setSaved(false); }}
          className="text-xs border border-slate-300 rounded px-2 py-1 focus:outline-none"
        >
          <option value="">— None —</option>
          {frameworkOptions.map(fw => <option key={fw} value={fw}>{fw}</option>)}
        </select>

        <div className="flex-1" />

        <input
          type="text"
          value={newFramework}
          onChange={e => setNewFramework(e.target.value)}
          placeholder="New framework"
          className="text-xs border border-slate-300 rounded px-2 py-1 focus:outline-none w-32"
        />
        <button onClick={addFramework} className="text-xs px-2 py-1 bg-slate-200 rounded hover:bg-slate-300">Add</button>
        {frameworkOptions.map(fw => (
          <button key={fw} onClick={() => removeFramework(fw)} className="text-[10px] text-slate-400 hover:text-red-500">
            {fw} ×
          </button>
        ))}

        <button
          onClick={saveAll}
          disabled={saving}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save All
        </button>
        {saved && <span className="text-xs text-green-600 font-medium">Saved ✓</span>}
      </div>

      {/* ═══ Drag-drop 3-column grid ═══ */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-3 gap-4">
          {STAGES.map(stage => (
            <StageColumn
              key={stage.key}
              stage={stage}
              keys={activeMapping[stage.key]}
              masterSchedules={masterSchedules}
              conditions={activeMapping.conditions}
              onToggleCondition={toggleCondition}
              onRemoveKey={removeKey}
            />
          ))}
        </div>
        <DragOverlay>
          {activeDragId ? (
            <div className="bg-white border border-blue-400 shadow-lg rounded-md px-2 py-1.5 text-[11px] font-medium text-slate-700">
              {masterSchedules.find(s => s.key === activeDragId)?.label || activeDragId}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* ═══ Available schedules drawer ═══ */}
      {availableSchedules.length > 0 && (
        <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/40">
          <div className="flex items-center gap-2 mb-2">
            <Eye className="h-3 w-3 text-slate-400" />
            <h3 className="text-xs font-semibold text-slate-600">Available Schedules (not yet assigned)</h3>
            <span className="text-[10px] text-slate-400">{availableSchedules.length}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {availableSchedules.map(s => {
              const stage = (s.defaultStage || s.stage || 'planning') as Stage;
              return (
                <button
                  key={s.key}
                  onClick={() => addKeyToStage(s.key, stage)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-white border border-slate-300 rounded hover:bg-blue-50 hover:border-blue-300"
                >
                  <Plus className="h-2.5 w-2.5" />
                  {s.label}
                  <span className="text-[8px] text-slate-400 uppercase">{stage.slice(0, 4)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
