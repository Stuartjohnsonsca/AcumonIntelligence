/**
 * The 5-stage audit-test pipeline.
 *
 * Every audit test in the firm's Test Bank moves through these stages
 * in order:
 *
 *   1. Obtain Population — pull the raw data the test will sample
 *      from. Either ingested from the GL or requested from the
 *      client, and checked against the expected balance.
 *   2. Sampling — feed the population into the sampling calculator,
 *      apply preset sampling parameters where the test has them, and
 *      pick the items to test.
 *   3. Request & Extract — request the selected sample's evidence
 *      and ingest the returned data into the workspace.
 *   4. Analyse — compare the ingested evidence against the expected
 *      population values; surface mismatches.
 *   5. Conclude — record errors, follow-up actions, and the test's
 *      overall conclusion.
 *
 * Steps in a TestActionStep store their stage on
 * `inputBindings.__stage`. Storing on the existing JSON field
 * sidesteps a schema migration; the executor and admin UI both treat
 * `__stage` as a metadata-only key (never sent into action handlers).
 *
 * Every ActionDefinition has a `category` field; the STAGE_CATEGORIES
 * mapping below records which categories naturally fit which stage so
 * the admin UI can surface stage-appropriate suggestions when the
 * user picks an action for a given stage.
 */

export const TEST_PIPELINE_STAGES = [
  { key: 'obtain_population',  order: 1, label: 'Obtain Population',  description: 'Pull raw data and agree to the expected balance' },
  { key: 'sampling',           order: 2, label: 'Sampling',           description: 'Run the sampling calculator with the population' },
  { key: 'request_and_extract', order: 3, label: 'Request & Extract',  description: 'Request the sample and ingest the returned evidence' },
  { key: 'analyse',            order: 4, label: 'Analyse',            description: 'Compare evidence against expected population values' },
  { key: 'conclude',           order: 5, label: 'Conclude',           description: 'Identify errors and record actions / conclusion' },
] as const;

export type TestPipelineStage = typeof TEST_PIPELINE_STAGES[number]['key'];
export const TEST_PIPELINE_STAGE_KEYS: readonly TestPipelineStage[] = TEST_PIPELINE_STAGES.map(s => s.key);

// Per-stage colour tokens for the admin UI. Tailwind classes are
// expanded on the consuming side (these strings are pre-resolved so
// the JIT picks them up).
export const TEST_PIPELINE_STAGE_THEME: Record<TestPipelineStage, { headerBg: string; headerText: string; pillBg: string; pillText: string; border: string }> = {
  obtain_population:    { headerBg: 'bg-blue-50',    headerText: 'text-blue-800',    pillBg: 'bg-blue-100',    pillText: 'text-blue-700',    border: 'border-blue-200' },
  sampling:             { headerBg: 'bg-purple-50',  headerText: 'text-purple-800',  pillBg: 'bg-purple-100',  pillText: 'text-purple-700',  border: 'border-purple-200' },
  request_and_extract:  { headerBg: 'bg-amber-50',   headerText: 'text-amber-800',   pillBg: 'bg-amber-100',   pillText: 'text-amber-700',   border: 'border-amber-200' },
  analyse:              { headerBg: 'bg-indigo-50',  headerText: 'text-indigo-800',  pillBg: 'bg-indigo-100',  pillText: 'text-indigo-700',  border: 'border-indigo-200' },
  conclude:             { headerBg: 'bg-green-50',   headerText: 'text-green-800',   pillBg: 'bg-green-100',   pillText: 'text-green-700',   border: 'border-green-200' },
};

/**
 * Which ActionDefinition.category values naturally belong to each
 * stage. Used by the admin pipeline editor to filter the action
 * picker so each stage's "Add action" button only shows actions that
 * make sense at that stage. Categories that aren't listed (or that
 * are listed under multiple stages) appear under every stage's
 * picker.
 */
export const STAGE_CATEGORIES: Record<TestPipelineStage, string[]> = {
  obtain_population:   ['population', 'data', 'evidence', 'general'],
  sampling:            ['sampling',   'general'],
  request_and_extract: ['evidence',   'data',  'general'],
  analyse:             ['analysis',   'verification', 'general'],
  conclude:            ['reporting',  'verification', 'general'],
};

export function isStageKey(s: unknown): s is TestPipelineStage {
  return typeof s === 'string' && (TEST_PIPELINE_STAGE_KEYS as readonly string[]).includes(s);
}

/**
 * Read a step's stage from its inputBindings blob. Defaults to
 * 'obtain_population' (stage 1) for legacy steps that pre-date the
 * 5-stage model, so they continue to render in a sensible bucket.
 */
export function readStepStage(inputBindings: unknown): TestPipelineStage {
  if (inputBindings && typeof inputBindings === 'object') {
    const s = (inputBindings as Record<string, unknown>).__stage;
    if (isStageKey(s)) return s;
  }
  return 'obtain_population';
}

/** Persist the stage marker into a step's inputBindings blob. */
export function withStepStage<T extends Record<string, unknown>>(inputBindings: T | null | undefined, stage: TestPipelineStage): T & { __stage: TestPipelineStage } {
  return { ...(inputBindings || {} as T), __stage: stage };
}

/** Strip __stage out of a bindings blob before sending to an action
 *  handler — keeps the metadata key from leaking into runtime
 *  inputs. */
export function withoutStageMeta<T extends Record<string, unknown>>(inputBindings: T | null | undefined): Omit<T, '__stage'> {
  if (!inputBindings) return {} as Omit<T, '__stage'>;
  const { __stage, ...rest } = inputBindings as Record<string, unknown> & { __stage?: unknown };
  return rest as Omit<T, '__stage'>;
}
