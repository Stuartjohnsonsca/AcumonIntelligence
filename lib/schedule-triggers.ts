/**
 * Schedule Triggers — shared types + runtime evaluation.
 *
 * Replaces the previous per-schedule `conditions` + `linkGroup` model with a
 * first-class list of named "triggers". Each trigger has a condition and a
 * set of member schedule keys. A schedule is visible iff:
 *   - It belongs to NO triggers (default = always visible), OR
 *   - At least one trigger containing it is firing
 *
 * Old configs are automatically migrated to the new shape on load so nothing
 * breaks — see `migrateOldToTriggers`.
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export type Stage = 'planning' | 'fieldwork' | 'completion';

export type TriggerCondition =
  | { kind: 'always' }
  | { kind: 'listed' }
  | { kind: 'eqr' }
  | { kind: 'priorPeriod' }
  | { kind: 'firstYear' }
  | {
      kind: 'questionAnswer';
      /** schedule key whose template holds the source question */
      scheduleKey: string;
      /** question id inside that template */
      questionId: string;
      /** expected answer (case-insensitive match) */
      expectedAnswer: string;
      /**
       * For free-text questions only. When true, a runtime AI fuzzy-match call
       * treats semantically-equivalent answers as a match (e.g. "yes" ~= "affirmative").
       * Dropdown questions ignore this flag — their comparison is always exact.
       */
      useAIFuzzyMatch?: boolean;
    };

export interface Trigger {
  id: string;
  name: string;
  condition: TriggerCondition;
  /** schedule keys that become visible when this trigger fires */
  members: string[];
}

export interface StageKeyedMapping {
  planning: string[];
  fieldwork: string[];
  completion: string[];
  /** New: first-class trigger list */
  triggers: Trigger[];
  /** Legacy — kept for back-compat reads only, not written back */
  conditions?: Record<string, OldCondition>;
}

/** Legacy per-schedule condition shape (pre-trigger refactor) */
export interface OldCondition {
  requiresListed?: boolean;
  requiresEQR?: boolean;
  requiresPriorPeriod?: boolean;
  requiresFirstYear?: boolean;
  linkGroup?: number;
}

// ─── Migration ─────────────────────────────────────────────────────────────

/**
 * Convert an old-shape mapping (conditions + linkGroup per schedule) to the
 * new trigger-list shape. Preserves semantics exactly:
 *   - Per-schedule conditions become single-member triggers with matching kinds
 *   - linkGroup members are duplicated into every trigger they belong to so
 *     that firing any one condition shows the whole group (OR semantics)
 */
export function migrateOldToTriggers(mapping: StageKeyedMapping): StageKeyedMapping {
  if (Array.isArray(mapping.triggers) && mapping.triggers.length > 0) {
    // Already has triggers — assume already migrated
    return { ...mapping, conditions: undefined };
  }

  const conditions = mapping.conditions || {};
  const triggers: Trigger[] = [];

  // Step 1: build one trigger per (schedule, condition kind) pair
  let triggerCounter = 0;
  function nextId(): string {
    triggerCounter += 1;
    return `migrated-${Date.now().toString(36)}-${triggerCounter}`;
  }

  for (const [scheduleKey, cond] of Object.entries(conditions)) {
    if (cond.requiresListed) {
      triggers.push({ id: nextId(), name: `${scheduleKey} — Listed`, condition: { kind: 'listed' }, members: [scheduleKey] });
    }
    if (cond.requiresEQR) {
      triggers.push({ id: nextId(), name: `${scheduleKey} — EQR`, condition: { kind: 'eqr' }, members: [scheduleKey] });
    }
    if (cond.requiresPriorPeriod) {
      triggers.push({ id: nextId(), name: `${scheduleKey} — Prior Period`, condition: { kind: 'priorPeriod' }, members: [scheduleKey] });
    }
    if (cond.requiresFirstYear) {
      triggers.push({ id: nextId(), name: `${scheduleKey} — First Year`, condition: { kind: 'firstYear' }, members: [scheduleKey] });
    }
  }

  // Step 2: for each linkGroup, widen every trigger whose sole member is in that
  // link group so it now contains all the group's members (co-visibility).
  // Preserves old OR semantics: if ANY member's individual condition fires,
  // ALL group members show.
  const linkGroups = new Map<number, string[]>();
  for (const [scheduleKey, cond] of Object.entries(conditions)) {
    if (cond.linkGroup === undefined) continue;
    if (!linkGroups.has(cond.linkGroup)) linkGroups.set(cond.linkGroup, []);
    linkGroups.get(cond.linkGroup)!.push(scheduleKey);
  }

  for (const groupMembers of linkGroups.values()) {
    // Widen every trigger whose only member is in this group
    for (const t of triggers) {
      if (t.members.length === 1 && groupMembers.includes(t.members[0])) {
        // Replace with the full group membership
        t.members = [...groupMembers];
      }
    }

    // Also: if any group member has NO per-schedule conditions at all
    // (so it wouldn't produce any trigger), it was relying on other members'
    // conditions to become visible. The widened triggers above already include
    // it in their members lists, so nothing extra to do. BUT if NO member of
    // the group has any conditions, the group should be always-visible — add
    // an "always" trigger for it.
    const hasAnyCondition = groupMembers.some(m => {
      const c = conditions[m];
      return c && (c.requiresListed || c.requiresEQR || c.requiresPriorPeriod || c.requiresFirstYear);
    });
    if (!hasAnyCondition) {
      triggers.push({
        id: nextId(),
        name: `Link group (${groupMembers.length} schedules)`,
        condition: { kind: 'always' },
        members: [...groupMembers],
      });
    }
  }

  return {
    planning: mapping.planning,
    fieldwork: mapping.fieldwork,
    completion: mapping.completion,
    triggers,
    conditions: undefined,
  };
}

// ─── Runtime evaluation ────────────────────────────────────────────────────

export interface TriggerContext {
  clientIsListed: boolean;
  teamHasEQR: boolean;
  hasPriorPeriodEngagement: boolean;
  /**
   * Engagement's answers to questions inside each source schedule, keyed by
   * schedule key → question id → answer string. Populated by the caller
   * before evaluating Q&A triggers.
   */
  answers: Record<string, Record<string, string>>;
  /**
   * Optional pre-computed AI fuzzy-match results. Keyed by
   * `${questionId}|${expectedAnswer}|${actualAnswer}`. Callers populate this
   * via a batched API call before evaluation; if a key isn't present the
   * runtime treats the fuzzy match as "not yet computed" → not firing.
   */
  aiFuzzyCache?: Record<string, boolean>;
}

/** Build the cache key used by TriggerContext.aiFuzzyCache for a given Q&A pair. */
export function aiFuzzyCacheKey(questionId: string, expected: string, actual: string): string {
  return `${questionId}|${expected.trim().toLowerCase()}|${String(actual).trim().toLowerCase()}`;
}

export function isTriggerFiring(trigger: Trigger, ctx: TriggerContext): boolean {
  const c = trigger.condition;
  switch (c.kind) {
    case 'always':
      return true;
    case 'listed':
      return ctx.clientIsListed;
    case 'eqr':
      return ctx.teamHasEQR;
    case 'priorPeriod':
      return ctx.hasPriorPeriodEngagement;
    case 'firstYear':
      return !ctx.hasPriorPeriodEngagement;
    case 'questionAnswer': {
      const actual = ctx.answers[c.scheduleKey]?.[c.questionId];
      if (actual === undefined || actual === null || actual === '') return false;
      const normalisedActual = String(actual).trim().toLowerCase();
      const normalisedExpected = c.expectedAnswer.trim().toLowerCase();
      if (normalisedActual === normalisedExpected) return true;
      // Fall through to AI fuzzy match if enabled and cached
      if (c.useAIFuzzyMatch && ctx.aiFuzzyCache) {
        const key = aiFuzzyCacheKey(c.questionId, c.expectedAnswer, String(actual));
        return ctx.aiFuzzyCache[key] === true;
      }
      return false;
    }
  }
}

/**
 * Given a set of triggers + an engagement context, return a function that
 * tells you whether a given schedule key should be visible.
 *
 *   - Schedule with no triggers → always visible (default)
 *   - Schedule in one or more triggers → visible iff any of them fires
 */
export function buildVisibilityChecker(triggers: Trigger[], ctx: TriggerContext): (scheduleKey: string) => boolean {
  // Pre-compute: for each schedule key, list of triggers containing it
  const byMember = new Map<string, Trigger[]>();
  for (const t of triggers) {
    for (const m of t.members) {
      if (!byMember.has(m)) byMember.set(m, []);
      byMember.get(m)!.push(t);
    }
  }

  // Pre-compute firing state per trigger
  const firing = new Map<string, boolean>();
  for (const t of triggers) {
    firing.set(t.id, isTriggerFiring(t, ctx));
  }

  return function isVisible(scheduleKey: string): boolean {
    const containing = byMember.get(scheduleKey);
    if (!containing || containing.length === 0) return true; // default: always visible
    return containing.some(t => firing.get(t.id) === true);
  };
}

/**
 * Return the set of unique schedule keys referenced as Q&A trigger sources.
 * The caller uses this to fetch just the templates whose answers are needed.
 */
export function collectQAScheduleKeys(triggers: Trigger[]): string[] {
  const keys = new Set<string>();
  for (const t of triggers) {
    if (t.condition.kind === 'questionAnswer') {
      keys.add(t.condition.scheduleKey);
    }
  }
  return Array.from(keys);
}

// ─── Shape guards ──────────────────────────────────────────────────────────

export function isStageKeyed(obj: unknown): obj is StageKeyedMapping {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const o = obj as Record<string, unknown>;
  return Array.isArray(o.planning) && Array.isArray(o.fieldwork) && Array.isArray(o.completion);
}

export function emptyMapping(): StageKeyedMapping {
  return { planning: [], fieldwork: [], completion: [], triggers: [] };
}
