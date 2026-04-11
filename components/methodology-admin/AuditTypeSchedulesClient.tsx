'use client';

import { useState, useEffect } from 'react';
import { ChevronUp, ChevronDown, Plus, X, Save, Loader2, Copy, GripVertical, Eye, Zap, Trash2 } from 'lucide-react';
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
import {
  migrateOldToTriggers,
  type Trigger,
  type TriggerCondition,
  type StageKeyedMapping as LibStageKeyedMapping,
  type OldCondition,
} from '@/lib/schedule-triggers';

// ═════ Types ═════

interface MasterSchedule {
  key: string;
  label: string;
  defaultStage?: 'planning' | 'fieldwork' | 'completion';
  /** legacy field (pre Part E) */
  stage?: 'planning' | 'fieldwork' | 'completion';
}

type Stage = 'planning' | 'fieldwork' | 'completion';

/** Client-side mapping shape (lib type + optional legacy conditions for back-compat) */
type StageKeyedMapping = LibStageKeyedMapping;

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

const CONDITION_KINDS: Array<{ value: TriggerCondition['kind']; label: string; hint: string }> = [
  { value: 'always',         label: 'Always',            hint: 'Members of this trigger are always shown' },
  { value: 'listed',         label: 'Listed client',     hint: 'Members shown when Client.isListed is true' },
  { value: 'eqr',            label: 'EQR on team',       hint: 'Members shown when an EQR is assigned to the engagement' },
  { value: 'priorPeriod',    label: 'Returning client',  hint: 'Members shown when the engagement has a prior-period record' },
  { value: 'firstYear',      label: 'First-year audit',  hint: 'Members shown when no prior-period engagement exists' },
  { value: 'questionAnswer', label: 'Question answer',   hint: "Members shown when a specific answer is given in another schedule" },
];

// ═════ Helpers ═════

function toKey(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function emptyMapping(): StageKeyedMapping {
  return { planning: [], fieldwork: [], completion: [], triggers: [] };
}

function newTriggerId(): string {
  return `trig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Normalise incoming server data into a StageKeyedMapping with a triggers array. */
function normaliseToStageKeyed(
  auditType: string,
  stageKeyedIn: Record<string, StageKeyedMapping> | undefined,
  flatIn: Record<string, string[]>,
  master: MasterSchedule[],
): StageKeyedMapping {
  const incoming = stageKeyedIn?.[auditType];
  if (incoming) {
    // Server sends triggers + maybe conditions. Migrate any legacy conditions on the fly.
    const migrated = migrateOldToTriggers({
      planning: incoming.planning || [],
      fieldwork: incoming.fieldwork || [],
      completion: incoming.completion || [],
      triggers: Array.isArray(incoming.triggers) ? incoming.triggers : [],
      conditions: incoming.conditions,
    });
    return { ...migrated, conditions: undefined };
  }
  // Fall back to flat list (very old shape) or master defaults
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
  const out = emptyMapping();
  for (const s of master) {
    const stage = (s.defaultStage || s.stage || 'planning') as Stage;
    out[stage].push(s.key);
  }
  return out;
}

// ═════ Sortable schedule card ═════

function ScheduleCard({
  id,
  label,
  triggersContainingMe,
  allTriggers,
  onAddToTrigger,
  onRemoveFromTrigger,
  onRemove,
}: {
  id: string;
  label: string;
  /** Triggers (in the current audit type) whose members list contains this schedule */
  triggersContainingMe: Trigger[];
  /** All triggers — used to populate the "+ trigger" dropdown */
  allTriggers: Trigger[];
  onAddToTrigger: (triggerId: string) => void;
  onRemoveFromTrigger: (triggerId: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const [showAddMenu, setShowAddMenu] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const candidateTriggers = allTriggers.filter(t => !triggersContainingMe.some(m => m.id === t.id));

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-white border border-slate-200 rounded-md px-2 py-1.5 mb-1.5 text-[11px]"
    >
      <div className="flex items-center gap-1.5">
        <button
          {...attributes}
          {...listeners}
          className="text-slate-400 hover:text-slate-600 cursor-grab active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-3 w-3" />
        </button>
        <span className="flex-1 font-medium text-slate-700 truncate" title={label}>{label}</span>
        <button
          onClick={onRemove}
          className="text-slate-400 hover:text-red-500"
          aria-label="Remove from this audit type"
          title="Remove from this audit type (stays in master list)"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Trigger badges */}
      {(triggersContainingMe.length > 0 || candidateTriggers.length > 0) && (
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          {triggersContainingMe.map(t => (
            <span
              key={t.id}
              className="inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase px-1 py-0.5 rounded bg-indigo-100 text-indigo-700 border border-indigo-300"
              title={`In trigger "${t.name}" (${t.condition.kind})`}
            >
              {t.name || t.condition.kind}
              <button
                onClick={() => onRemoveFromTrigger(t.id)}
                className="hover:text-red-600 ml-0.5"
                aria-label={`Remove from trigger ${t.name}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          {candidateTriggers.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowAddMenu(v => !v)}
                className="text-[9px] font-semibold uppercase px-1 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-300 hover:bg-slate-200"
                title="Add this schedule to a trigger"
              >
                + trigger
              </button>
              {showAddMenu && (
                <div className="absolute z-10 top-full left-0 mt-1 bg-white border border-slate-200 rounded shadow-md py-1 min-w-[160px] max-h-[200px] overflow-auto">
                  {candidateTriggers.map(t => (
                    <button
                      key={t.id}
                      onClick={() => { onAddToTrigger(t.id); setShowAddMenu(false); }}
                      className="w-full text-left px-2 py-1 text-[10px] text-slate-700 hover:bg-indigo-50"
                    >
                      {t.name || '(unnamed)'} <span className="text-slate-400 text-[9px]">{t.condition.kind}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═════ Stage column ═════

function StageColumn({
  stage,
  keys,
  masterSchedules,
  triggers,
  onAddKeyToTrigger,
  onRemoveKeyFromTrigger,
  onRemoveKey,
}: {
  stage: typeof STAGES[number];
  keys: string[];
  masterSchedules: MasterSchedule[];
  triggers: Trigger[];
  onAddKeyToTrigger: (key: string, triggerId: string) => void;
  onRemoveKeyFromTrigger: (key: string, triggerId: string) => void;
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
          const containing = triggers.filter(t => t.members.includes(k));
          return (
            <ScheduleCard
              key={k}
              id={k}
              label={label}
              triggersContainingMe={containing}
              allTriggers={triggers}
              onAddToTrigger={(tid) => onAddKeyToTrigger(k, tid)}
              onRemoveFromTrigger={(tid) => onRemoveKeyFromTrigger(k, tid)}
              onRemove={() => onRemoveKey(k)}
            />
          );
        })}
      </SortableContext>
    </div>
  );
}

// ═════ Triggers panel ═════

function TriggersPanel({
  triggers,
  masterSchedules,
  activeStageKeys,
  onAddTrigger,
  onUpdateTrigger,
  onDeleteTrigger,
  questionsCache,
  onLoadQuestions,
}: {
  triggers: Trigger[];
  masterSchedules: MasterSchedule[];
  /** Schedule keys currently in this audit type's stages — used to limit the Q&A source dropdown */
  activeStageKeys: string[];
  onAddTrigger: () => void;
  onUpdateTrigger: (id: string, patch: Partial<Trigger>) => void;
  onDeleteTrigger: (id: string) => void;
  /** Cached questions per schedule key: { [scheduleKey]: [{id, questionText}] } */
  questionsCache: Record<string, Array<{ id: string; questionText: string }>>;
  onLoadQuestions: (scheduleKey: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  function updateCondition(triggerId: string, kind: TriggerCondition['kind']) {
    let newCondition: TriggerCondition;
    switch (kind) {
      case 'always':         newCondition = { kind: 'always' }; break;
      case 'listed':         newCondition = { kind: 'listed' }; break;
      case 'eqr':            newCondition = { kind: 'eqr' }; break;
      case 'priorPeriod':    newCondition = { kind: 'priorPeriod' }; break;
      case 'firstYear':      newCondition = { kind: 'firstYear' }; break;
      case 'questionAnswer': newCondition = { kind: 'questionAnswer', scheduleKey: '', questionId: '', expectedAnswer: '' }; break;
    }
    onUpdateTrigger(triggerId, { condition: newCondition });
  }

  return (
    <div className="border border-indigo-200 rounded-lg bg-indigo-50/30">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-indigo-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-indigo-600" />
          <h2 className="text-sm font-semibold text-slate-800">Triggers</h2>
          <span className="text-xs text-slate-500">{triggers.length}</span>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-3">
          <p className="text-[10px] text-slate-500">
            A trigger is a rule that makes one or more schedules visible together. Schedules not in any trigger
            are always shown. A schedule in multiple triggers shows if <em>any</em> of them fires. Add schedules
            to triggers via the &quot;+ trigger&quot; chip on each schedule card below.
          </p>

          {triggers.length === 0 && (
            <p className="text-xs text-slate-400 italic">No triggers yet. Click &quot;+ Add Trigger&quot; to create one.</p>
          )}

          {triggers.map(t => {
            const cond = t.condition;
            return (
              <div key={t.id} className="bg-white border border-indigo-200 rounded-md p-3 space-y-2">
                {/* Header: name + condition + delete */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={t.name}
                    onChange={(e) => onUpdateTrigger(t.id, { name: e.target.value })}
                    placeholder="Trigger name"
                    className="flex-1 text-xs font-semibold text-slate-800 border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-indigo-400"
                  />
                  <select
                    value={cond.kind}
                    onChange={(e) => updateCondition(t.id, e.target.value as TriggerCondition['kind'])}
                    className="text-xs border border-slate-300 rounded px-2 py-1 focus:outline-none focus:border-indigo-400"
                  >
                    {CONDITION_KINDS.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => onDeleteTrigger(t.id)}
                    className="text-slate-400 hover:text-red-500 p-1"
                    aria-label="Delete trigger"
                    title="Delete this trigger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Condition hint */}
                <p className="text-[10px] text-slate-500 italic">
                  {CONDITION_KINDS.find(c => c.value === cond.kind)?.hint}
                </p>

                {/* Q&A-specific inputs */}
                {cond.kind === 'questionAnswer' && (
                  <div className="grid grid-cols-3 gap-2 p-2 bg-indigo-50/30 rounded border border-indigo-100">
                    <div>
                      <label className="text-[9px] text-slate-500 uppercase tracking-wide font-semibold">Source schedule</label>
                      <select
                        value={cond.scheduleKey}
                        onChange={(e) => {
                          const newKey = e.target.value;
                          onUpdateTrigger(t.id, {
                            condition: { kind: 'questionAnswer', scheduleKey: newKey, questionId: '', expectedAnswer: cond.expectedAnswer },
                          });
                          if (newKey && !questionsCache[newKey]) onLoadQuestions(newKey);
                        }}
                        className="w-full mt-0.5 text-[10px] border border-slate-300 rounded px-1.5 py-1 focus:outline-none focus:border-indigo-400"
                      >
                        <option value="">— Pick schedule —</option>
                        {activeStageKeys.map(k => {
                          const m = masterSchedules.find(s => s.key === k);
                          return <option key={k} value={k}>{m?.label || k}</option>;
                        })}
                      </select>
                    </div>
                    <div>
                      <label className="text-[9px] text-slate-500 uppercase tracking-wide font-semibold">Question</label>
                      <select
                        value={cond.questionId}
                        onChange={(e) => onUpdateTrigger(t.id, {
                          condition: { ...cond, questionId: e.target.value },
                        })}
                        disabled={!cond.scheduleKey}
                        className="w-full mt-0.5 text-[10px] border border-slate-300 rounded px-1.5 py-1 focus:outline-none focus:border-indigo-400 disabled:bg-slate-50"
                      >
                        <option value="">— Pick question —</option>
                        {(questionsCache[cond.scheduleKey] || []).map(q => (
                          <option key={q.id} value={q.id}>
                            {q.questionText.length > 60 ? q.questionText.slice(0, 60) + '…' : q.questionText}
                          </option>
                        ))}
                      </select>
                      {cond.scheduleKey && !questionsCache[cond.scheduleKey] && (
                        <p className="text-[9px] text-slate-400 mt-0.5">Loading questions…</p>
                      )}
                      {cond.scheduleKey && questionsCache[cond.scheduleKey]?.length === 0 && (
                        <p className="text-[9px] text-amber-600 mt-0.5">No questions found in this schedule</p>
                      )}
                    </div>
                    <div>
                      <label className="text-[9px] text-slate-500 uppercase tracking-wide font-semibold">Expected answer</label>
                      <input
                        type="text"
                        value={cond.expectedAnswer}
                        onChange={(e) => onUpdateTrigger(t.id, {
                          condition: { ...cond, expectedAnswer: e.target.value },
                        })}
                        placeholder="e.g. Yes"
                        className="w-full mt-0.5 text-[10px] border border-slate-300 rounded px-1.5 py-1 focus:outline-none focus:border-indigo-400"
                      />
                    </div>
                  </div>
                )}

                {/* Members */}
                <div>
                  <label className="text-[9px] text-slate-500 uppercase tracking-wide font-semibold">Members ({t.members.length})</label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {t.members.length === 0 && (
                      <span className="text-[10px] text-slate-400 italic">No schedules yet — use the &quot;+ trigger&quot; chip on a schedule card below</span>
                    )}
                    {t.members.map(memberKey => {
                      const ms = masterSchedules.find(s => s.key === memberKey);
                      return (
                        <span
                          key={memberKey}
                          className="inline-flex items-center gap-1 text-[10px] bg-slate-100 text-slate-700 border border-slate-200 rounded px-1.5 py-0.5"
                        >
                          {ms?.label || memberKey}
                          <button
                            onClick={() => onUpdateTrigger(t.id, { members: t.members.filter(m => m !== memberKey) })}
                            className="text-slate-400 hover:text-red-500"
                            aria-label={`Remove ${memberKey} from trigger`}
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}

          <button
            onClick={onAddTrigger}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            <Plus className="h-3 w-3" /> Add Trigger
          </button>
        </div>
      )}
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

  // Question cache for Q&A trigger editor: { [scheduleKey]: [{id, questionText}] }
  const [questionsCache, setQuestionsCache] = useState<Record<string, Array<{ id: string; questionText: string }>>>({});

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savingMaster, setSavingMaster] = useState(false);

  // Drag state
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const activeMapping = stageMappings[activeAuditType] || emptyMapping();

  // Collect usage info across ALL audit types (for orphan recovery + used-in badges)
  const usageByKey = new Map<string, Set<string>>();
  for (const at of AUDIT_TYPES) {
    const mapping = stageMappings[at.key];
    if (!mapping) continue;
    const allKeys = [...mapping.planning, ...mapping.fieldwork, ...mapping.completion];
    for (const k of allKeys) {
      if (!usageByKey.has(k)) usageByKey.set(k, new Set());
      usageByKey.get(k)!.add(at.key);
    }
  }

  function deriveLabel(key: string): string {
    return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  type AvailableRow = { key: string; label: string; defaultStage: Stage; isOrphan: boolean; usedIn: string[] };
  const masterKeySet = new Set(masterSchedules.map(s => s.key));
  const assignedSet = new Set<string>([
    ...activeMapping.planning,
    ...activeMapping.fieldwork,
    ...activeMapping.completion,
  ]);
  const candidateKeys = new Set<string>([...masterKeySet, ...usageByKey.keys()]);

  const availableSchedules: AvailableRow[] = Array.from(candidateKeys)
    .filter(k => !assignedSet.has(k))
    .map(k => {
      const master = masterSchedules.find(s => s.key === k);
      const usedIn = Array.from(usageByKey.get(k) || []).filter(at => at !== activeAuditType);
      return {
        key: k,
        label: master?.label || deriveLabel(k),
        defaultStage: (master?.defaultStage || master?.stage || 'planning') as Stage,
        isOrphan: !master,
        usedIn,
      };
    })
    .sort((a, b) => {
      if (a.isOrphan !== b.isOrphan) return a.isOrphan ? 1 : -1;
      return a.label.localeCompare(b.label);
    });

  const activeStageKeys = [...activeMapping.planning, ...activeMapping.fieldwork, ...activeMapping.completion];

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

      let sourceStage: Stage | null = null;
      for (const s of STAGES) {
        if (lookup[s.key].includes(activeId)) { sourceStage = s.key; break; }
      }
      if (!sourceStage) return prev;

      let targetStage: Stage | null = null;
      for (const s of STAGES) {
        if (lookup[s.key].includes(overId)) { targetStage = s.key; break; }
      }
      if (!targetStage) return prev;

      const sourceList = lookup[sourceStage];
      const targetList = lookup[targetStage];

      if (sourceStage === targetStage) {
        const oldIdx = sourceList.indexOf(activeId);
        const newIdx = targetList.indexOf(overId);
        lookup[sourceStage] = arrayMove(sourceList, oldIdx, newIdx);
      } else {
        const srcIdx = sourceList.indexOf(activeId);
        sourceList.splice(srcIdx, 1);
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

  // ── Trigger handlers ──

  function addTrigger() {
    setStageMappings(prev => {
      const next = { ...prev };
      const am = { ...next[activeAuditType] };
      const newT: Trigger = {
        id: newTriggerId(),
        name: `Trigger ${am.triggers.length + 1}`,
        condition: { kind: 'always' },
        members: [],
      };
      am.triggers = [...am.triggers, newT];
      next[activeAuditType] = am;
      return next;
    });
    setSaved(false);
  }

  function updateTrigger(id: string, patch: Partial<Trigger>) {
    setStageMappings(prev => {
      const next = { ...prev };
      const am = { ...next[activeAuditType] };
      am.triggers = am.triggers.map(t => t.id === id ? { ...t, ...patch } : t);
      next[activeAuditType] = am;
      return next;
    });
    setSaved(false);
  }

  function deleteTrigger(id: string) {
    setStageMappings(prev => {
      const next = { ...prev };
      const am = { ...next[activeAuditType] };
      am.triggers = am.triggers.filter(t => t.id !== id);
      next[activeAuditType] = am;
      return next;
    });
    setSaved(false);
  }

  function addKeyToTrigger(scheduleKey: string, triggerId: string) {
    setStageMappings(prev => {
      const next = { ...prev };
      const am = { ...next[activeAuditType] };
      am.triggers = am.triggers.map(t => {
        if (t.id !== triggerId) return t;
        if (t.members.includes(scheduleKey)) return t;
        return { ...t, members: [...t.members, scheduleKey] };
      });
      next[activeAuditType] = am;
      return next;
    });
    setSaved(false);
  }

  function removeKeyFromTrigger(scheduleKey: string, triggerId: string) {
    setStageMappings(prev => {
      const next = { ...prev };
      const am = { ...next[activeAuditType] };
      am.triggers = am.triggers.map(t => {
        if (t.id !== triggerId) return t;
        return { ...t, members: t.members.filter(m => m !== scheduleKey) };
      });
      next[activeAuditType] = am;
      return next;
    });
    setSaved(false);
  }

  // ── Questions loader (for Q&A trigger editor) ──

  async function loadQuestions(scheduleKey: string) {
    if (questionsCache[scheduleKey]) return;
    // Mark as loading (empty array means "no questions")
    setQuestionsCache(prev => ({ ...prev, [scheduleKey]: prev[scheduleKey] ?? [] }));
    try {
      // Try the schedule key as templateType first; fall back to ${key}_questions
      const candidates = [scheduleKey, `${scheduleKey}_questions`];
      for (const tt of candidates) {
        const res = await fetch(`/api/methodology-admin/templates?templateType=${encodeURIComponent(tt)}&auditType=ALL`);
        if (!res.ok) continue;
        const data = await res.json();
        const items = data.template?.items || data.templates?.[0]?.items;
        if (!items) continue;
        const questions = items.questions || (Array.isArray(items) ? items : null);
        if (Array.isArray(questions) && questions.length > 0) {
          setQuestionsCache(prev => ({
            ...prev,
            [scheduleKey]: questions.map((q: any) => ({ id: String(q.id || ''), questionText: String(q.questionText || q.text || '') })).filter((q: { id: string }) => q.id),
          }));
          return;
        }
      }
    } catch {
      // Leave as empty array so the UI shows "no questions"
    }
  }

  // ── Other actions ──

  function removeKey(key: string) {
    setStageMappings(prev => {
      const next = { ...prev };
      const am = { ...next[activeAuditType] };
      am.planning = am.planning.filter(k => k !== key);
      am.fieldwork = am.fieldwork.filter(k => k !== key);
      am.completion = am.completion.filter(k => k !== key);
      // Also remove from any triggers in this audit type
      am.triggers = am.triggers.map(t => ({ ...t, members: t.members.filter(m => m !== key) }));
      next[activeAuditType] = am;
      return next;
    });
    setSaved(false);
  }

  function restoreOrphanToMaster(key: string, label: string, stage: Stage) {
    setMasterSchedules(prev => {
      if (prev.some(s => s.key === key)) return prev;
      return [...prev, { key, label, defaultStage: stage }];
    });
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
      // Deep copy triggers with new ids so they don't collide across audit types
      const copiedTriggers: Trigger[] = (source.triggers || []).map(t => ({
        id: newTriggerId(),
        name: t.name,
        condition: JSON.parse(JSON.stringify(t.condition)),
        members: [...t.members],
      }));
      const copied: StageKeyedMapping = {
        planning: [...source.planning],
        fieldwork: [...source.fieldwork],
        completion: [...source.completion],
        triggers: copiedTriggers,
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
        am.triggers = am.triggers.map(t => ({ ...t, members: t.members.filter(m => m !== key) }));
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
      await fetch('/api/methodology-admin/audit-type-schedules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_master', schedules: masterSchedules }),
      });

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

  // Auto-load questions for any Q&A triggers that reference schedules we haven't fetched yet
  useEffect(() => {
    for (const t of activeMapping.triggers) {
      if (t.condition.kind === 'questionAnswer' && t.condition.scheduleKey && !questionsCache[t.condition.scheduleKey]) {
        loadQuestions(t.condition.scheduleKey);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAuditType, activeMapping.triggers]);

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

      {/* ═══ Triggers panel ═══ */}
      <TriggersPanel
        triggers={activeMapping.triggers}
        masterSchedules={masterSchedules}
        activeStageKeys={activeStageKeys}
        onAddTrigger={addTrigger}
        onUpdateTrigger={updateTrigger}
        onDeleteTrigger={deleteTrigger}
        questionsCache={questionsCache}
        onLoadQuestions={loadQuestions}
      />

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
              triggers={activeMapping.triggers}
              onAddKeyToTrigger={addKeyToTrigger}
              onRemoveKeyFromTrigger={removeKeyFromTrigger}
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
            <h3 className="text-xs font-semibold text-slate-600">Available Schedules (not yet assigned to {AUDIT_TYPES.find(a => a.key === activeAuditType)?.label})</h3>
            <span className="text-[10px] text-slate-400">{availableSchedules.length}</span>
          </div>
          <p className="text-[10px] text-slate-400 mb-2">
            Click any schedule to add it back to this audit type. Orphans (not in master list) are restored
            automatically when clicked.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {availableSchedules.map(s => {
              const usedInLabels = s.usedIn
                .map(at => AUDIT_TYPES.find(a => a.key === at)?.label.replace(/ Audit$/, '') || at)
                .join(', ');
              return (
                <button
                  key={s.key}
                  onClick={() => {
                    if (s.isOrphan) restoreOrphanToMaster(s.key, s.label, s.defaultStage);
                    addKeyToStage(s.key, s.defaultStage);
                  }}
                  className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-white border rounded hover:bg-blue-50 hover:border-blue-300 ${
                    s.isOrphan ? 'border-amber-300 bg-amber-50/40' : 'border-slate-300'
                  }`}
                  title={
                    s.isOrphan
                      ? `Orphan \u2014 not in master list but still used in: ${usedInLabels || '(nowhere)'}. Click to restore.`
                      : s.usedIn.length > 0
                        ? `Also used in: ${usedInLabels}`
                        : 'Click to add to this audit type'
                  }
                >
                  <Plus className="h-2.5 w-2.5" />
                  {s.label}
                  <span className="text-[8px] text-slate-400 uppercase">{s.defaultStage.slice(0, 4)}</span>
                  {s.isOrphan && (
                    <span className="text-[7px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 border border-amber-300 rounded px-1">orphan</span>
                  )}
                  {!s.isOrphan && s.usedIn.length > 0 && (
                    <span className="text-[7px] font-medium text-slate-500 bg-slate-100 border border-slate-200 rounded px-1" title={`Used in: ${usedInLabels}`}>
                      in {s.usedIn.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
