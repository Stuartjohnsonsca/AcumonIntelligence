'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuditTypes } from '@/hooks/useAuditTypes';
import { ChevronUp, ChevronDown, Plus, X, Save, Loader2, Copy, GripVertical, Eye, Zap, Trash2 } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  DragOverlay,
  useDroppable,
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
import {
  pairKey,
  parsePairKey,
  DEFAULT_FRAMEWORK,
  FRAMEWORK_OPTIONS_KEY,
} from '@/lib/audit-type-framework-key';

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
  /** Mappings keyed by composite `<auditType>::<framework>` so each
   *  pair can carry its own schedule list. Pre-migration data (legacy
   *  bare `<auditType>` rows) is normalised to `<auditType>::FRS102`
   *  on the server before the page renders. */
  initialMappings: Record<string, string[]>;
  initialStageKeyedMappings?: Record<string, StageKeyedMapping>;
  /** Helper: per-audit-type "primary" framework — used only to choose
   *  which framework slot the editor should land on first. */
  initialFrameworkByAuditType?: Record<string, string>;
  initialFrameworkOptions?: string[];
  initialMasterSchedules?: MasterSchedule[];
}

// Default fallback audit-type list. Used during the initial render
// before useAuditTypes() loads the firm's configured catalogue, and
// as a safety net if the API fails. The component reads the dynamic
// list inside the function body via useAuditTypes() and falls back
// to this constant only when no items have loaded yet.
const FALLBACK_AUDIT_TYPES = [
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

/** Cached question shape used by the Q&A trigger editor to decide which kind of
 *  expected-answer input to render (dropdown vs text). */
interface CachedQuestion {
  id: string;
  questionText: string;
  inputType?: string;
  dropdownOptions?: string[];
}

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

/** Normalise incoming server data into a StageKeyedMapping with a triggers array.
 *  Lookup key is the composite `<auditType>::<framework>` value. When no
 *  mapping exists for the given composite key we return an empty mapping
 *  rather than seeding with master defaults — empty signals "this pair
 *  hasn't been configured yet" so the admin sees a blank editor and
 *  composes the list themselves. (Previously seeding from master defaults
 *  was helpful for the legacy 5 audit types; with framework pairs there
 *  are many more slots and the master-default seed obscured which pairs
 *  the admin has actually configured.) */
function normaliseToStageKeyed(
  composite: string,
  stageKeyedIn: Record<string, StageKeyedMapping> | undefined,
  flatIn: Record<string, string[]>,
  master: MasterSchedule[],
): StageKeyedMapping {
  const incoming = stageKeyedIn?.[composite];
  if (incoming) {
    const migrated = migrateOldToTriggers({
      planning: incoming.planning || [],
      fieldwork: incoming.fieldwork || [],
      completion: incoming.completion || [],
      triggers: Array.isArray(incoming.triggers) ? incoming.triggers : [],
      conditions: incoming.conditions,
    });
    return { ...migrated, conditions: undefined };
  }
  const flat = flatIn[composite];
  if (flat && flat.length > 0) {
    const out = emptyMapping();
    for (const k of flat) {
      const m = master.find(s => s.key === k);
      const stage = (m?.defaultStage || m?.stage || 'planning') as Stage;
      out[stage].push(k);
    }
    return out;
  }
  return emptyMapping();
}

// ═════ Sortable schedule card ═════

/** Static-condition kinds exposed on each schedule card as quick-toggle buttons. */
type QuickKind = 'listed' | 'eqr' | 'priorPeriod' | 'firstYear';
const QUICK_BUTTONS: Array<{ kind: QuickKind; label: string; onClass: string }> = [
  { kind: 'listed',      label: 'LST', onClass: 'bg-amber-100 text-amber-700 border-amber-300' },
  { kind: 'eqr',         label: 'EQR', onClass: 'bg-purple-100 text-purple-700 border-purple-300' },
  { kind: 'priorPeriod', label: 'PP',  onClass: 'bg-cyan-100 text-cyan-700 border-cyan-300' },
  { kind: 'firstYear',   label: 'FY',  onClass: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
];
const QUICK_TOOLTIPS: Record<QuickKind, string> = {
  listed:      'Only show on Listed clients (creates a single-member trigger)',
  eqr:         'Only show when an EQR is on the team',
  priorPeriod: 'Only show on returning clients (has a prior-period engagement)',
  firstYear:   'Only show on first-year audits (no prior-period engagement)',
};

/**
 * Compose a stage-scoped sortable id so the same schedule key can live in
 * multiple stages without colliding in dnd-kit's id registry. Format:
 *   card:<stage>:<scheduleKey>
 * A separate format `stage:<stage>` is used by empty stage-column droppables,
 * and the two are kept distinguishable by the `card:` prefix.
 */
function sortableIdFor(stage: Stage, scheduleKey: string): string {
  return `card:${stage}:${scheduleKey}`;
}

/**
 * Parse a sortable id back into (stage, scheduleKey). Returns null for non-
 * card ids (e.g. the stage column droppable `stage:<key>`).
 */
function parseSortableId(id: string): { stage: Stage; key: string } | null {
  if (!id.startsWith('card:')) return null;
  const rest = id.slice('card:'.length);
  const firstColon = rest.indexOf(':');
  if (firstColon === -1) return null;
  const stage = rest.slice(0, firstColon) as Stage;
  const key = rest.slice(firstColon + 1);
  if (stage !== 'planning' && stage !== 'fieldwork' && stage !== 'completion') return null;
  return { stage, key };
}

function ScheduleCard({
  id,
  scheduleKey,
  label,
  stagePresence,
  onTogglePresence,
  triggersContainingMe,
  allTriggers,
  quickStates,
  onToggleQuick,
  onAddToTrigger,
  onRemoveFromTrigger,
  onRemove,
}: {
  /**
   * Stage-namespaced sortable id, e.g. card:fieldwork:par. Required so
   * dnd-kit treats the same schedule key in different stages as distinct
   * drag targets — a single schedule can now persist across multiple
   * stages and each stage renders its own ScheduleCard instance sharing
   * the same underlying schedule identity.
   */
  id: string;
  /** Raw schedule key (without stage namespace) — used for stage presence
   *  callbacks below. */
  scheduleKey: string;
  label: string;
  /** Which stages this schedule is currently in for the active audit type.
   *  Drives the P/F/C presence pills on the card. */
  stagePresence: { planning: boolean; fieldwork: boolean; completion: boolean };
  /** Click-to-toggle presence in a given stage. Called with the raw schedule
   *  key and target stage. This is the preferred way to make a schedule
   *  persist across multiple stages — no drag modifiers required. */
  onTogglePresence: (key: string, stage: Stage) => void;
  /** Triggers (in the current audit type) whose members list contains this schedule */
  triggersContainingMe: Trigger[];
  /** All triggers — used to populate the "+ trigger" dropdown */
  allTriggers: Trigger[];
  /** Which of the 4 quick-toggles are currently active for this schedule (true = schedule is
   *  a member of a matching trigger, not necessarily single-member). */
  quickStates: Record<QuickKind, boolean>;
  /** Toggle a quick-kind on/off for this schedule. The main component handles creating or
   *  removing the backing trigger. */
  onToggleQuick: (kind: QuickKind) => void;
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

  // For the "+ trigger" dropdown, only offer non-quick triggers (always / questionAnswer /
  // named multi-member triggers). The quick static conditions are already exposed as buttons.
  const quickKinds: QuickKind[] = ['listed', 'eqr', 'priorPeriod', 'firstYear'];
  const nonQuickTriggers = allTriggers.filter(t => !quickKinds.includes(t.condition.kind as QuickKind));
  const nonQuickContainingMe = triggersContainingMe.filter(t => !quickKinds.includes(t.condition.kind as QuickKind));
  const candidateTriggers = nonQuickTriggers.filter(t => !nonQuickContainingMe.some(m => m.id === t.id));

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
        {/* Quick-toggle buttons: clicking creates or removes a single-member trigger */}
        <div className="flex items-center gap-0.5">
          {QUICK_BUTTONS.map(b => {
            const on = quickStates[b.kind];
            return (
              <button
                key={b.kind}
                onClick={() => onToggleQuick(b.kind)}
                title={QUICK_TOOLTIPS[b.kind]}
                className={`text-[8px] font-semibold uppercase px-1 py-0.5 rounded border ${
                  on ? b.onClass : 'bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {b.label}
              </button>
            );
          })}
        </div>
        <button
          onClick={onRemove}
          className="text-slate-400 hover:text-red-500 ml-0.5"
          aria-label="Remove from this audit type"
          title="Remove from this audit type (stays in master list)"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/*
        Stage presence pills — the bullet-proof alternative to drag-drop.
        Click P / F / C to toggle this schedule's presence in Planning /
        Fieldwork / Completion. A schedule can be in any combination of
        stages simultaneously (one underlying schedule key shared across
        multiple stage lists). This avoids all drag-modifier timing issues.
      */}
      <div className="flex items-center gap-1 mt-1">
        <span className="text-[9px] uppercase tracking-wide text-slate-400 font-semibold mr-0.5">Stages:</span>
        {(['planning', 'fieldwork', 'completion'] as const).map(s => {
          const on = stagePresence[s];
          const letter = s === 'planning' ? 'P' : s === 'fieldwork' ? 'F' : 'C';
          const activeClass =
            s === 'planning' ? 'bg-blue-600 border-blue-700 text-white' :
            s === 'fieldwork' ? 'bg-amber-600 border-amber-700 text-white' :
            'bg-green-600 border-green-700 text-white';
          return (
            <button
              key={s}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTogglePresence(scheduleKey, s);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              title={on
                ? `In ${s} — click to remove from ${s}`
                : `Not in ${s} — click to add to ${s}`}
              className={`inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold rounded border transition-colors ${
                on ? activeClass : 'bg-white border-slate-300 text-slate-400 hover:border-slate-500 hover:text-slate-600'
              }`}
              aria-pressed={on}
              aria-label={`Toggle ${s} stage for ${label}`}
            >
              {letter}
            </button>
          );
        })}
      </div>

      {/* Non-quick trigger badges (custom / Q&A / multi-member). Quick ones are already shown
          above as buttons. */}
      {(nonQuickContainingMe.length > 0 || candidateTriggers.length > 0) && (
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          {nonQuickContainingMe.map(t => (
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
                title="Add this schedule to a custom trigger"
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
  stagePresenceByKey,
  onTogglePresence,
  onToggleQuick,
  onAddKeyToTrigger,
  onRemoveKeyFromTrigger,
  onRemoveKey,
}: {
  stage: typeof STAGES[number];
  keys: string[];
  masterSchedules: MasterSchedule[];
  triggers: Trigger[];
  /** Map of scheduleKey → which stages it's present in for the active audit type */
  stagePresenceByKey: Record<string, { planning: boolean; fieldwork: boolean; completion: boolean }>;
  onTogglePresence: (scheduleKey: string, stage: Stage) => void;
  onToggleQuick: (scheduleKey: string, kind: QuickKind) => void;
  onAddKeyToTrigger: (key: string, triggerId: string) => void;
  onRemoveKeyFromTrigger: (key: string, triggerId: string) => void;
  onRemoveKey: (key: string) => void;
}) {
  // Make the whole column a droppable target, with a well-known id that
  // handleDragEnd recognises. This is what lets users drop into an empty
  // Fieldwork column — without it, dnd-kit only fires onDragEnd when the
  // pointer is over an existing sortable item, so empty columns silently
  // rejected drops.
  const { isOver, setNodeRef } = useDroppable({ id: `stage:${stage.key}` });
  const isFieldwork = stage.key === 'fieldwork';
  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border ${stage.colour} ${stage.bg} p-2 min-h-[300px] transition-colors ${isOver ? 'ring-2 ring-blue-400' : ''}`}
    >
      <h3 className={`text-xs font-bold uppercase tracking-wide ${stage.colour} mb-2 text-center`}>
        {stage.label}
      </h3>
      {/*
        Fieldwork has a mandatory auto-populated FS-level tab section that
        the engagement derives from the trial balance. It's not something
        admins manage here — they can only reorder or restage the customised
        schedules that follow. A "|" divider makes the split explicit.
      */}
      {isFieldwork && (
        <>
          <div className="bg-white/70 border border-amber-200 rounded px-2 py-1.5 mb-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">
              FS Level tabs
            </div>
            <div className="text-[10px] text-slate-500 leading-tight">
              Auto-populated from the engagement's trial balance (Revenue, Cost of Sales, etc.). Not editable here.
            </div>
          </div>
          <div className="flex items-center gap-2 my-2">
            <div className="flex-1 border-t border-amber-300" />
            <span className="text-sm font-bold text-amber-700 select-none" aria-hidden>|</span>
            <div className="flex-1 border-t border-amber-300" />
          </div>
          <div className="text-[9px] uppercase tracking-wide text-slate-500 mb-1 font-semibold">
            Customised schedules
          </div>
        </>
      )}
      {/*
        Each card's sortable id is namespaced by stage via sortableIdFor so
        the same schedule key can appear in multiple stages without dnd-kit
        id collisions. React keys are namespaced for the same reason.
      */}
      <SortableContext items={keys.map(k => sortableIdFor(stage.key, k))} strategy={verticalListSortingStrategy}>
        {keys.length === 0 && (
          <div className="text-[10px] text-slate-400 text-center py-4 italic border border-dashed border-slate-300 rounded">
            Drop schedules here
          </div>
        )}
        {keys.map(k => {
          const label = masterSchedules.find(s => s.key === k)?.label || k;
          const containing = triggers.filter(t => t.members.includes(k));
          // A quick-toggle is "on" if this schedule is a member of ANY trigger whose
          // condition.kind matches — whether that trigger is single-member or multi-member.
          const quickStates: Record<QuickKind, boolean> = {
            listed:      containing.some(t => t.condition.kind === 'listed'),
            eqr:         containing.some(t => t.condition.kind === 'eqr'),
            priorPeriod: containing.some(t => t.condition.kind === 'priorPeriod'),
            firstYear:   containing.some(t => t.condition.kind === 'firstYear'),
          };
          const scopedId = sortableIdFor(stage.key, k);
          const presence = stagePresenceByKey[k] || { planning: false, fieldwork: false, completion: false };
          return (
            <ScheduleCard
              key={scopedId}
              id={scopedId}
              scheduleKey={k}
              label={label}
              stagePresence={presence}
              onTogglePresence={onTogglePresence}
              triggersContainingMe={containing}
              allTriggers={triggers}
              quickStates={quickStates}
              onToggleQuick={(kind) => onToggleQuick(k, kind)}
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
  questionsCache: Record<string, CachedQuestion[]>;
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
                      {(() => {
                        const question = questionsCache[cond.scheduleKey]?.find(q => q.id === cond.questionId);
                        const isDropdown = question?.inputType === 'dropdown' && Array.isArray(question.dropdownOptions) && question.dropdownOptions.length > 0;
                        if (isDropdown) {
                          return (
                            <select
                              value={cond.expectedAnswer}
                              onChange={(e) => onUpdateTrigger(t.id, {
                                condition: { ...cond, expectedAnswer: e.target.value, useAIFuzzyMatch: false },
                              })}
                              className="w-full mt-0.5 text-[10px] border border-slate-300 rounded px-1.5 py-1 focus:outline-none focus:border-indigo-400"
                            >
                              <option value="">— Pick answer —</option>
                              {question!.dropdownOptions!.map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          );
                        }
                        // Free-text (or unknown) question → text input + optional AI fuzzy toggle
                        return (
                          <>
                            <input
                              type="text"
                              value={cond.expectedAnswer}
                              onChange={(e) => onUpdateTrigger(t.id, {
                                condition: { ...cond, expectedAnswer: e.target.value },
                              })}
                              placeholder="e.g. Yes"
                              className="w-full mt-0.5 text-[10px] border border-slate-300 rounded px-1.5 py-1 focus:outline-none focus:border-indigo-400"
                            />
                            {cond.questionId && (
                              <label className="flex items-center gap-1 text-[9px] text-slate-500 mt-1 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={!!cond.useAIFuzzyMatch}
                                  onChange={(e) => onUpdateTrigger(t.id, {
                                    condition: { ...cond, useAIFuzzyMatch: e.target.checked },
                                  })}
                                  className="h-2.5 w-2.5"
                                />
                                AI fuzzy match (semantic equivalence)
                              </label>
                            )}
                          </>
                        );
                      })()}
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
  initialFrameworkByAuditType = {},
  initialFrameworkOptions,
  initialMasterSchedules,
}: Props) {
  // Pull the firm's configurable audit-type catalogue.
  const dynamicAuditTypes = useAuditTypes();
  const AUDIT_TYPES = useMemo(() => {
    const active = dynamicAuditTypes.filter(a => a.isActive);
    if (active.length > 0) return active.map(a => ({ key: a.code, label: a.label }));
    return FALLBACK_AUDIT_TYPES;
  }, [dynamicAuditTypes]);

  const [masterSchedules, setMasterSchedules] = useState<MasterSchedule[]>(
    Array.isArray(initialMasterSchedules) && initialMasterSchedules.length > 0 ? initialMasterSchedules : []
  );

  const [frameworkOptions, setFrameworkOptions] = useState<string[]>(initialFrameworkOptions || DEFAULT_FRAMEWORKS);
  const [newFramework, setNewFramework] = useState('');

  // Mappings are keyed internally by composite `<auditType>::<framework>`
  // so each pair can carry an independent schedule list. Initial state
  // is whatever the server returned — pairs the admin hasn't configured
  // simply don't have an entry, and lazily get an empty mapping when
  // the user navigates to them (see ensurePair below).
  const [stageMappings, setStageMappings] = useState<Record<string, StageKeyedMapping>>(() => {
    const m: Record<string, StageKeyedMapping> = {};
    if (initialStageKeyedMappings) {
      for (const composite of Object.keys(initialStageKeyedMappings)) {
        m[composite] = normaliseToStageKeyed(composite, initialStageKeyedMappings, initialMappings, masterSchedules);
      }
    }
    for (const composite of Object.keys(initialMappings)) {
      if (!m[composite]) {
        m[composite] = normaliseToStageKeyed(composite, initialStageKeyedMappings, initialMappings, masterSchedules);
      }
    }
    return m;
  });

  // Active selection is two dimensions: audit type (top-level tabs) and
  // framework (sub-tabs within an audit type). The composite key is
  // derived for storage / lookup.
  const [activeAuditType, setActiveAuditType] = useState(AUDIT_TYPES[0]?.key || FALLBACK_AUDIT_TYPES[0].key);
  const [activeFramework, setActiveFramework] = useState<string>(() => {
    const at = AUDIT_TYPES[0]?.key || FALLBACK_AUDIT_TYPES[0].key;
    return initialFrameworkByAuditType[at] || frameworkOptions[0] || DEFAULT_FRAMEWORK;
  });

  const activeKey = pairKey(activeAuditType, activeFramework);

  // If the active audit type references a code that no longer exists
  // (admin removed a custom type), fall back to the first available one.
  useEffect(() => {
    if (!AUDIT_TYPES.some(a => a.key === activeAuditType) && AUDIT_TYPES.length > 0) {
      setActiveAuditType(AUDIT_TYPES[0].key);
    }
  }, [AUDIT_TYPES, activeAuditType]);

  // If the active framework was removed from the firm's framework list,
  // fall back to the first available one.
  useEffect(() => {
    if (frameworkOptions.length > 0 && !frameworkOptions.includes(activeFramework)) {
      setActiveFramework(frameworkOptions[0]);
    }
  }, [frameworkOptions, activeFramework]);

  // When the admin switches audit type, jump to that audit type's
  // primary framework if it has one configured — saves a click.
  useEffect(() => {
    const primary = initialFrameworkByAuditType[activeAuditType];
    if (primary && frameworkOptions.includes(primary) && primary !== activeFramework) {
      setActiveFramework(primary);
    }
    // intentionally not depending on activeFramework — we only want to
    // re-snap when the audit type changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAuditType]);

  // Lazily initialise an empty mapping for the active pair when the
  // admin navigates to a slot that has never been configured.
  useEffect(() => {
    setStageMappings(prev => {
      if (prev[activeKey]) return prev;
      return { ...prev, [activeKey]: emptyMapping() };
    });
  }, [activeKey]);

  // Source pair for "Copy from" — composite key string.
  const [copyFrom, setCopyFrom] = useState<string>('');

  // Master editor
  const [showMasterEditor, setShowMasterEditor] = useState(false);
  const [newScheduleLabel, setNewScheduleLabel] = useState('');
  const [newScheduleStage, setNewScheduleStage] = useState<Stage>('planning');

  // Question cache for Q&A trigger editor: { [scheduleKey]: [{id, questionText}] }
  const [questionsCache, setQuestionsCache] = useState<Record<string, CachedQuestion[]>>({});

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savingMaster, setSavingMaster] = useState(false);
  const [masterSaved, setMasterSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Drag state
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  // Note: an earlier Shift+drop / Copy Mode approach was removed. Keyboard
  // modifier timing during drags is too unreliable to build a stable UX on.
  // Multi-stage presence is now controlled by click-to-toggle P/F/C pills
  // on each ScheduleCard (see togglePresenceInStage below). Drags remain
  // for plain move/reorder.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const activeMapping = stageMappings[activeKey] || emptyMapping();

  // Collect usage info across ALL configured (auditType, framework) pairs
  // (for orphan recovery + "used in" badges). Each entry maps schedule
  // key → Set of composite keys it's currently in.
  const usageByKey = new Map<string, Set<string>>();
  for (const composite of Object.keys(stageMappings)) {
    const mapping = stageMappings[composite];
    if (!mapping) continue;
    const allKeys = [...mapping.planning, ...mapping.fieldwork, ...mapping.completion];
    for (const k of allKeys) {
      if (!usageByKey.has(k)) usageByKey.set(k, new Set());
      usageByKey.get(k)!.add(composite);
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
      // "Used in" labels are pair labels — e.g. "Statutory Audit · FRS102".
      const usedIn = Array.from(usageByKey.get(k) || []).filter(c => c !== activeKey);
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

    // Drags are always moves. Multi-stage persistence is handled by the
    // click-to-toggle P/F/C pills on each card, not by drag modifiers.
    const persistAcross = false;

    // Source is always a card (sortable id format: card:<stage>:<key>).
    const activeParsed = parseSortableId(activeId);
    if (!activeParsed) return;
    const sourceStage = activeParsed.stage;
    const sourceKey = activeParsed.key;

    // Target can be either another card or a stage column droppable.
    let targetStage: Stage | null = null;
    let targetKey: string | null = null;
    let appendToEnd = false;
    const overParsed = parseSortableId(overId);
    if (overParsed) {
      targetStage = overParsed.stage;
      targetKey = overParsed.key;
    } else if (overId.startsWith('stage:')) {
      const stageName = overId.slice('stage:'.length) as Stage;
      if (STAGES.some(s => s.key === stageName)) {
        targetStage = stageName;
        appendToEnd = true;
      }
    }
    if (!targetStage) return;

    setStageMappings(prev => {
      const next = { ...prev };
      const am = { ...(next[activeKey] || emptyMapping()) };
      const lookup: Record<Stage, string[]> = {
        planning: [...am.planning],
        fieldwork: [...am.fieldwork],
        completion: [...am.completion],
      };

      const sourceList = lookup[sourceStage];
      const targetList = lookup[targetStage!];

      if (sourceStage === targetStage) {
        const oldIdx = sourceList.indexOf(sourceKey);
        if (oldIdx === -1) return prev;
        if (appendToEnd) {
          lookup[sourceStage] = arrayMove(sourceList, oldIdx, sourceList.length - 1);
        } else if (targetKey) {
          const newIdx = sourceList.indexOf(targetKey);
          if (newIdx === -1) return prev;
          lookup[sourceStage] = arrayMove(sourceList, oldIdx, newIdx);
        }
      } else {
        const alreadyInTarget = targetList.includes(sourceKey);

        if (persistAcross) {
          if (!alreadyInTarget) {
            if (appendToEnd || !targetKey) {
              targetList.push(sourceKey);
            } else {
              const overIdx = targetList.indexOf(targetKey);
              targetList.splice(overIdx >= 0 ? overIdx : targetList.length, 0, sourceKey);
            }
          }
        } else {
          const srcIdx = sourceList.indexOf(sourceKey);
          if (srcIdx !== -1) sourceList.splice(srcIdx, 1);
          if (!alreadyInTarget) {
            if (appendToEnd || !targetKey) {
              targetList.push(sourceKey);
            } else {
              const overIdx = targetList.indexOf(targetKey);
              targetList.splice(overIdx >= 0 ? overIdx : targetList.length, 0, sourceKey);
            }
          }
        }
      }

      am.planning = lookup.planning;
      am.fieldwork = lookup.fieldwork;
      am.completion = lookup.completion;
      next[activeKey] = am;
      return next;
    });
    setSaved(false);
  }

  // ── Trigger handlers ──

  function addTrigger() {
    setStageMappings(prev => {
      const next = { ...prev };
      const am = { ...(next[activeKey] || emptyMapping()) };
      const newT: Trigger = {
        id: newTriggerId(),
        name: `Trigger ${am.triggers.length + 1}`,
        condition: { kind: 'always' },
        members: [],
      };
      am.triggers = [...am.triggers, newT];
      next[activeKey] = am;
      return next;
    });
    setSaved(false);
  }

  function updateTrigger(id: string, patch: Partial<Trigger>) {
    setStageMappings(prev => {
      const next = { ...prev };
      const am = { ...(next[activeKey] || emptyMapping()) };
      am.triggers = am.triggers.map(t => t.id === id ? { ...t, ...patch } : t);
      next[activeKey] = am;
      return next;
    });
    setSaved(false);
  }

  function deleteTrigger(id: string) {
    setStageMappings(prev => {
      const next = { ...prev };
      const am = { ...(next[activeKey] || emptyMapping()) };
      am.triggers = am.triggers.filter(t => t.id !== id);
      next[activeKey] = am;
      return next;
    });
    setSaved(false);
  }

  function addKeyToTrigger(scheduleKey: string, triggerId: string) {
    setStageMappings(prev => {
      const next = { ...prev };
      const am = { ...(next[activeKey] || emptyMapping()) };
      am.triggers = am.triggers.map(t => {
        if (t.id !== triggerId) return t;
        if (t.members.includes(scheduleKey)) return t;
        return { ...t, members: [...t.members, scheduleKey] };
      });
      next[activeKey] = am;
      return next;
    });
    setSaved(false);
  }

  function removeKeyFromTrigger(scheduleKey: string, triggerId: string) {
    setStageMappings(prev => {
      const next = { ...prev };
      const am = { ...(next[activeKey] || emptyMapping()) };
      am.triggers = am.triggers.map(t => {
        if (t.id !== triggerId) return t;
        return { ...t, members: t.members.filter(m => m !== scheduleKey) };
      });
      next[activeKey] = am;
      return next;
    });
    setSaved(false);
  }

  /**
   * Quick-toggle for one of the 4 static-condition buttons (LST/EQR/PP/FY) on a schedule card.
   * Adds or removes the schedule from a backing trigger. If adding and no matching trigger
   * exists for that condition kind, create a single-member one. If removing leaves a
   * single-member trigger empty, delete it. Multi-member triggers are never deleted — we
   * just remove this schedule from their members list.
   */
  function toggleQuickCondition(scheduleKey: string, kind: QuickKind) {
    setStageMappings(prev => {
      const next = { ...prev };
      const am = { ...(next[activeKey] || emptyMapping()) };
      let triggers = [...am.triggers];

      // Find triggers with the matching kind that contain this schedule
      const containing = triggers.filter(t => t.condition.kind === kind && t.members.includes(scheduleKey));

      if (containing.length > 0) {
        // Currently ON → remove this schedule from every matching trigger
        triggers = triggers
          .map(t => {
            if (t.condition.kind !== kind || !t.members.includes(scheduleKey)) return t;
            return { ...t, members: t.members.filter(m => m !== scheduleKey) };
          })
          // Drop any trigger that's now empty
          .filter(t => t.members.length > 0);
      } else {
        // Currently OFF → find an existing trigger of this kind we can add the schedule to,
        // preferring a single-member one (keeps the "one trigger per schedule per kind" feel).
        // If none exist, create a new single-member trigger for this schedule.
        const existing = triggers.find(t => t.condition.kind === kind);
        if (existing) {
          triggers = triggers.map(t => t.id === existing.id
            ? { ...t, members: [...t.members, scheduleKey] }
            : t);
        } else {
          // Mutual exclusivity hint: flipping FY on a schedule that has PP on (or vice
          // versa) would be contradictory, but we don't enforce it here — admin can set both
          // via the Triggers panel if they really want to.
          const label = masterSchedules.find(s => s.key === scheduleKey)?.label || scheduleKey;
          const kindLabel = CONDITION_KINDS.find(c => c.value === kind)?.label || kind;
          triggers = [
            ...triggers,
            {
              id: newTriggerId(),
              name: `${label} — ${kindLabel}`,
              condition: { kind } as TriggerCondition,
              members: [scheduleKey],
            },
          ];
        }
      }

      am.triggers = triggers;
      next[activeKey] = am;
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
          const mapped: CachedQuestion[] = questions
            .map((q: any) => ({
              id: String(q.id || ''),
              questionText: String(q.questionText || q.text || ''),
              inputType: typeof q.inputType === 'string' ? q.inputType : undefined,
              dropdownOptions: Array.isArray(q.dropdownOptions) ? q.dropdownOptions.map((o: unknown) => String(o)) : undefined,
            }))
            .filter((q: CachedQuestion) => q.id);
          setQuestionsCache(prev => ({ ...prev, [scheduleKey]: mapped }));
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
      const am = { ...(next[activeKey] || emptyMapping()) };
      am.planning = am.planning.filter(k => k !== key);
      am.fieldwork = am.fieldwork.filter(k => k !== key);
      am.completion = am.completion.filter(k => k !== key);
      // Also remove from any triggers in this audit type
      am.triggers = am.triggers.map(t => ({ ...t, members: t.members.filter(m => m !== key) }));
      next[activeKey] = am;
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
      const am = { ...(next[activeKey] || emptyMapping()) };
      if (!am[stage].includes(key)) {
        am[stage] = [...am[stage], key];
      }
      next[activeKey] = am;
      return next;
    });
    setSaved(false);
  }

  /**
   * Toggle a schedule's presence in a given stage for the active audit type.
   * This is the bullet-proof alternative to drag-drop for the "same schedule
   * in multiple stages" use case — clicking a P/F/C pill on a card adds it
   * to that stage if it's not there, or removes it if it is. At least one
   * stage must remain — if clicking would remove the last stage, we keep
   * it and show a browser confirm for explicit removal via the × button.
   */
  function togglePresenceInStage(key: string, stage: Stage) {
    setStageMappings(prev => {
      const next = { ...prev };
      const am = { ...(next[activeKey] || emptyMapping()) };
      const currentlyIn = am[stage].includes(key);
      const totalPresence =
        (am.planning.includes(key) ? 1 : 0) +
        (am.fieldwork.includes(key) ? 1 : 0) +
        (am.completion.includes(key) ? 1 : 0);
      if (currentlyIn) {
        // Removing — but refuse to remove the last one. Direct users to the
        // × button on the card for full removal.
        if (totalPresence <= 1) return prev;
        am[stage] = am[stage].filter(k => k !== key);
      } else {
        am[stage] = [...am[stage], key];
      }
      next[activeKey] = am;
      return next;
    });
    setSaved(false);
  }

  async function copyFromAuditType() {
    // copyFrom is a composite key — `<auditType>::<framework>`.
    if (!copyFrom || copyFrom === activeKey) return;
    setStageMappings(prev => {
      const source = prev[copyFrom];
      if (!source) return prev;
      // Deep copy triggers with new ids so they don't collide across pairs.
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
      return { ...prev, [activeKey]: copied };
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
      // Strip the schedule from every (auditType, framework) pair we have configured.
      for (const composite of Object.keys(next)) {
        const am = { ...next[composite] };
        if (!am.planning) continue; // skip undefined entries
        am.planning = am.planning.filter(k => k !== key);
        am.fieldwork = am.fieldwork.filter(k => k !== key);
        am.completion = am.completion.filter(k => k !== key);
        am.triggers = (am.triggers || []).map(t => ({ ...t, members: t.members.filter(m => m !== key) }));
        next[composite] = am;
      }
      return next;
    });
  }

  async function saveMasterSchedules() {
    setSavingMaster(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/methodology-admin/audit-type-schedules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_master', schedules: masterSchedules }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const msg = errData?.error || `Save failed (HTTP ${res.status})`;
        setSaveError(`Master Schedule List — ${msg}${res.status === 403 ? ' (Methodology Admin or Super Admin required.)' : ''}`);
        return;
      }
      setMasterSaved(true);
      setTimeout(() => setMasterSaved(false), 3000);
    } catch (err: any) {
      setSaveError(`Master Schedule List — network error: ${err?.message || 'unknown'}`);
    } finally {
      setSavingMaster(false);
    }
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
    // If the active framework just disappeared, jump to whatever's left.
    if (fw === activeFramework) {
      const remaining = frameworkOptions.filter(f => f !== fw);
      if (remaining.length > 0) setActiveFramework(remaining[0]);
    }
    setSaved(false);
  }

  async function saveAll() {
    setSaving(true);
    setSaveError(null);
    const failures: string[] = [];

    async function doPut(label: string, body: unknown) {
      try {
        const res = await fetch('/api/methodology-admin/audit-type-schedules', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const msg = errData?.error || `HTTP ${res.status}`;
          failures.push(`${label}: ${msg}${res.status === 403 ? ' (Methodology Admin or Super Admin required.)' : ''}`);
        }
      } catch (err: any) {
        failures.push(`${label}: ${err?.message || 'network error'}`);
      }
    }

    try {
      await doPut('Master Schedule List', { action: 'save_master', schedules: masterSchedules });
      // One PUT per configured (auditType, framework) pair.
      for (const composite of Object.keys(stageMappings)) {
        const parsed = parsePairKey(composite);
        if (!parsed) continue; // defensive — should always parse
        const auditTypeLabel = AUDIT_TYPES.find(a => a.key === parsed.auditType)?.label || parsed.auditType;
        await doPut(`${auditTypeLabel} · ${parsed.framework}`, {
          auditType: parsed.auditType,
          framework: parsed.framework,
          stageKeyed: stageMappings[composite] || emptyMapping(),
        });
      }
      await doPut('Framework Options', { auditType: FRAMEWORK_OPTIONS_KEY, schedules: frameworkOptions });

      if (failures.length === 0) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        setSaveError(`${failures.length} item(s) failed to save:\n${failures.join('\n')}`);
      }
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
  }, [activeKey, activeMapping.triggers]);

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
                Save Master List
              </button>
              {masterSaved && (
                <span className="text-[10px] font-medium text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">
                  ✓ Saved
                </span>
              )}
            </div>

            {saveError && (
              <div className="mt-2 text-[10px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 whitespace-pre-wrap">
                <strong>Save error:</strong> {saveError}
              </div>
            )}

            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-2">
              <strong>Note:</strong> Adding a schedule above only updates the form. You must click <strong>Save Master List</strong>
              (or <strong>Save All Changes</strong> at the bottom) for the change to persist.
            </p>
          </div>
        )}
      </div>

      {/* ═══ Audit type selector (top-level tabs) ═══ */}
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

        {/* Copy from another (auditType, framework) pair */}
        <div className="flex items-center gap-1">
          <select
            value={copyFrom}
            onChange={e => setCopyFrom(e.target.value)}
            className="text-xs border border-slate-300 rounded px-2 py-1 focus:outline-none"
          >
            <option value="">Copy from pair…</option>
            {Object.keys(stageMappings)
              .filter(c => c !== activeKey)
              .sort()
              .map(c => {
                const parsed = parsePairKey(c);
                if (!parsed) return null;
                const at = AUDIT_TYPES.find(a => a.key === parsed.auditType);
                const label = `${at?.label || parsed.auditType} · ${parsed.framework}`;
                return <option key={c} value={c}>{label}</option>;
              })}
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

      {/* ═══ Framework sub-tabs (within the active audit type) ═══ */}
      <div className="p-3 bg-slate-50 rounded-lg space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-600 font-medium">Framework:</span>
          {frameworkOptions.map(fw => {
            const composite = pairKey(activeAuditType, fw);
            const hasMapping = !!stageMappings[composite] && (
              stageMappings[composite].planning.length +
              stageMappings[composite].fieldwork.length +
              stageMappings[composite].completion.length > 0
            );
            return (
              <button
                key={fw}
                onClick={() => setActiveFramework(fw)}
                className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
                  activeFramework === fw
                    ? 'bg-emerald-600 text-white border-emerald-700'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
                title={hasMapping ? 'Configured for this pair' : 'Not yet configured — click to start'}
              >
                {fw}
                {hasMapping && <span className="ml-1 text-[9px] opacity-80">●</span>}
              </button>
            );
          })}
          <button
            onClick={() => removeFramework(activeFramework)}
            disabled={frameworkOptions.length <= 1}
            title={`Remove framework "${activeFramework}" from the firm-wide list (configurations under it will become inaccessible until re-added).`}
            className="text-[10px] text-slate-400 hover:text-red-500 disabled:opacity-30 px-1"
          >
            Remove {activeFramework}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newFramework}
            onChange={e => setNewFramework(e.target.value)}
            placeholder="Add framework (e.g. IFRS)"
            className="text-xs border border-slate-300 rounded px-2 py-1 focus:outline-none w-40"
          />
          <button onClick={addFramework} className="text-xs px-2 py-1 bg-slate-200 rounded hover:bg-slate-300">Add framework</button>

          <div className="flex-1" />

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

        <p className="text-[10px] text-slate-500">
          Editing <strong>{AUDIT_TYPES.find(a => a.key === activeAuditType)?.label}</strong> · <strong>{activeFramework}</strong>.
          Each (Audit Type × Framework) pair has its own list of schedules, triggers, and order. Switch frameworks
          above to configure another pair. The dot (●) marks pairs that have at least one schedule configured.
        </p>
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

      {/* Drag-drop + stage pill usage hint */}
      <div className="p-2 border border-indigo-200 rounded bg-indigo-50/50 text-[11px] text-slate-700 leading-relaxed">
        <strong className="text-indigo-800">Two ways to manage which stages a schedule appears in:</strong>
        <ul className="mt-1 ml-4 list-disc space-y-0.5 text-slate-600">
          <li>
            <strong>Click the P / F / C pills on each card</strong> to toggle presence in Planning, Fieldwork and Completion. A schedule can live in any combination of stages — the same underlying schedule shown in multiple places. This is the reliable way to persist a schedule across stages.
          </li>
          <li>
            <strong>Drag a card</strong> to reorder it within a stage, or move it to a different stage.
          </li>
        </ul>
      </div>

      {/* ═══ Drag-drop 3-column grid (with P/F/C presence pills on cards) ═══ */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-3 gap-4">
          {(() => {
            const stagePresenceByKey: Record<string, { planning: boolean; fieldwork: boolean; completion: boolean }> = {};
            for (const k of [...activeMapping.planning, ...activeMapping.fieldwork, ...activeMapping.completion]) {
              if (!stagePresenceByKey[k]) {
                stagePresenceByKey[k] = {
                  planning: activeMapping.planning.includes(k),
                  fieldwork: activeMapping.fieldwork.includes(k),
                  completion: activeMapping.completion.includes(k),
                };
              }
            }
            return STAGES.map(stage => (
              <StageColumn
                key={stage.key}
                stage={stage}
                keys={activeMapping[stage.key]}
                masterSchedules={masterSchedules}
                triggers={activeMapping.triggers}
                stagePresenceByKey={stagePresenceByKey}
                onTogglePresence={togglePresenceInStage}
                onToggleQuick={toggleQuickCondition}
                onAddKeyToTrigger={addKeyToTrigger}
                onRemoveKeyFromTrigger={removeKeyFromTrigger}
                onRemoveKey={removeKey}
              />
            ));
          })()}
        </div>
        <DragOverlay>
          {activeDragId ? (() => {
            const parsed = parseSortableId(activeDragId);
            const scheduleKey = parsed?.key || activeDragId;
            const label = masterSchedules.find(s => s.key === scheduleKey)?.label || scheduleKey;
            return (
              <div className="bg-white shadow-lg rounded-md px-2 py-1.5 text-[11px] font-medium text-slate-700 border border-blue-400">
                {label}
              </div>
            );
          })() : null}
        </DragOverlay>
      </DndContext>

      {/* ═══ Available schedules drawer ═══ */}
      {availableSchedules.length > 0 && (
        <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/40">
          <div className="flex items-center gap-2 mb-2">
            <Eye className="h-3 w-3 text-slate-400" />
            <h3 className="text-xs font-semibold text-slate-600">
              Available Schedules (not yet assigned to {AUDIT_TYPES.find(a => a.key === activeAuditType)?.label} · {activeFramework})
            </h3>
            <span className="text-[10px] text-slate-400">{availableSchedules.length}</span>
          </div>
          <p className="text-[10px] text-slate-400 mb-2">
            Each row has three green "+" buttons — one for each stage. Click the one you want to add that
            schedule to. Orphans (amber) are not in the master list but still referenced elsewhere; clicking
            any stage button restores them automatically.
          </p>
          <div className="space-y-1">
            {availableSchedules.map(s => {
              const usedInLabels = s.usedIn
                .map(c => {
                  const parsed = parsePairKey(c);
                  if (!parsed) return c;
                  const at = AUDIT_TYPES.find(a => a.key === parsed.auditType);
                  return `${(at?.label || parsed.auditType).replace(/ Audit$/, '')} · ${parsed.framework}`;
                })
                .join(', ');
              return (
                <div
                  key={s.key}
                  className={`flex items-center gap-2 px-2 py-1 rounded border ${
                    s.isOrphan ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-white'
                  }`}
                >
                  <span className="flex-1 text-[11px] font-medium text-slate-700 truncate" title={s.label}>
                    {s.label}
                  </span>
                  {s.isOrphan && (
                    <span className="text-[8px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 border border-amber-300 rounded px-1">
                      orphan
                    </span>
                  )}
                  {!s.isOrphan && s.usedIn.length > 0 && (
                    <span
                      className="text-[8px] font-medium text-slate-500 bg-slate-100 border border-slate-200 rounded px-1"
                      title={`Used in: ${usedInLabels}`}
                    >
                      in {s.usedIn.length}
                    </span>
                  )}
                  <span className="text-[8px] text-slate-400 uppercase">
                    default {s.defaultStage.slice(0, 4)}
                  </span>
                  <div className="flex items-center gap-0.5">
                    {STAGES.map(stage => (
                      <button
                        key={stage.key}
                        onClick={() => {
                          if (s.isOrphan) restoreOrphanToMaster(s.key, s.label, s.defaultStage);
                          addKeyToStage(s.key, stage.key);
                        }}
                        title={`Add "${s.label}" to ${stage.label}`}
                        className={`inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-1 rounded border ${stage.colour} ${stage.bg} hover:brightness-95`}
                      >
                        <Plus className="h-2.5 w-2.5" />
                        {stage.label.slice(0, 4)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
