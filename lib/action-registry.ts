// ─── Action Pipeline Types & Utilities ─────────────────────────────────────

export type InputFieldType =
  | 'text' | 'textarea' | 'select' | 'multiselect'
  | 'number' | 'boolean' | 'date' | 'json_table' | 'file';

export type OutputFieldType =
  | 'file_array' | 'data_table' | 'text' | 'json' | 'pass_fail' | 'number';

export interface InputFieldDef {
  code: string;
  label: string;
  type: InputFieldType;
  required: boolean;
  defaultValue?: any;
  options?: { value: string; label: string }[];
  source: 'user' | 'auto';
  autoMapFrom?: string;       // e.g. "$prev.data_table"
  description?: string;
  group?: string;
}

export interface OutputFieldDef {
  code: string;
  label: string;
  type: OutputFieldType;
  description?: string;
}

export interface ActionDefinitionData {
  code: string;
  name: string;
  description: string;
  category: string;
  inputSchema: InputFieldDef[];
  outputSchema: OutputFieldDef[];
  handlerName?: string;
  icon?: string;
  color?: string;
  isSystem: boolean;
}

export type ActionCategory = 'evidence' | 'sampling' | 'analysis' | 'verification' | 'reporting';

export const ACTION_CATEGORIES: { value: ActionCategory; label: string; color: string }[] = [
  { value: 'evidence',     label: 'Evidence',      color: 'bg-blue-100 text-blue-700' },
  { value: 'sampling',     label: 'Sampling',       color: 'bg-amber-100 text-amber-700' },
  { value: 'analysis',     label: 'Analysis',       color: 'bg-purple-100 text-purple-700' },
  { value: 'verification', label: 'Verification',   color: 'bg-green-100 text-green-700' },
  { value: 'reporting',    label: 'Reporting',      color: 'bg-slate-100 text-slate-700' },
];

export function getCategoryStyle(category: string): string {
  return ACTION_CATEGORIES.find(c => c.value === category)?.color || 'bg-slate-100 text-slate-600';
}

// ─── Input Binding Resolution ──────────────────────────────────────────────

/**
 * Resolve binding references in a single value.
 *
 * Supports dot-paths with array-index segments so a binding can drill
 * into a specific row of a schedule:
 *
 *   $prev.total                       → 250000
 *   $prev.data_table.0.amount         → 80000   (first row's amount)
 *   $step.2.tb_rows.5.current_year    → 12345
 *   $step.0.breakdown.1.contribution  → -50000
 *   $ctx.engagement.periodEnd         → '2024-12-31'
 *
 * Numeric path segments are interpreted as array indices when the
 * current value is an array; otherwise they're treated as object
 * keys (so a key literally called "0" still works on an object).
 *
 * Returns `null` whenever any path segment misses, keeping handlers'
 * downstream null-checks simple.
 */
function readPath(root: any, path: string[]): any {
  let current = root;
  for (const key of path) {
    if (current == null) return null;
    if (Array.isArray(current) && /^-?\d+$/.test(key)) {
      const idx = parseInt(key, 10);
      current = idx < 0 ? current[current.length + idx] : current[idx];
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[key];
    } else {
      return null;
    }
  }
  return current ?? null;
}

export function resolveBindingValue(
  value: any,
  pipelineState: Record<number, Record<string, any>>,
  currentStepIndex: number,
  ctx: Record<string, any>,
): any {
  if (typeof value !== 'string') return value;

  // $prev.<field>[.<deeper>...]
  if (value.startsWith('$prev.')) {
    const path = value.slice(6).split('.');
    return readPath(pipelineState[currentStepIndex - 1], path);
  }

  // $step.<index>.<field>[.<deeper>...]
  if (value.startsWith('$step.')) {
    const parts = value.slice(6).split('.');
    const stepIdx = parseInt(parts[0], 10);
    return readPath(pipelineState[stepIdx], parts.slice(1));
  }

  // $ctx.<path>
  if (value.startsWith('$ctx.')) {
    return readPath(ctx, value.slice(5).split('.'));
  }

  return value;
}

/**
 * Resolve all input bindings for a pipeline step.
 */
export function resolveActionInputs(
  inputSchema: InputFieldDef[],
  inputBindings: Record<string, any>,
  pipelineState: Record<number, Record<string, any>>,
  currentStepIndex: number,
  ctx: Record<string, any>,
): Record<string, any> {
  const resolved: Record<string, any> = {};

  for (const field of inputSchema) {
    const binding = inputBindings[field.code];
    if (binding !== undefined) {
      resolved[field.code] = resolveBindingValue(binding, pipelineState, currentStepIndex, ctx);
    } else if (field.autoMapFrom) {
      resolved[field.code] = resolveBindingValue(field.autoMapFrom, pipelineState, currentStepIndex, ctx);
    } else if (field.defaultValue !== undefined) {
      resolved[field.code] = field.defaultValue;
    }
  }

  return resolved;
}

// ─── Branch Rules ──────────────────────────────────────────────────────────

export type BranchMode = 'continue' | 'goto' | 'skip' | 'conditional';
export interface BranchRules {
  mode: BranchMode;
  target?: number; // stepOrder; -1 = end of pipeline
  rules?: { when: string; target: number }[];
  default?: number;
}

/**
 * Evaluate a branch-rule `when` expression. Supported shapes:
 *   $prev.foo == "bar"
 *   $step.2.count > 0
 *   $ctx.engagement.framework != "FRS105"
 *   $prev.pass_fail
 *   true / false / null literals
 *
 * Operators: == != === !== <= >= < >
 * RHS literals: quoted strings, numbers, true / false / null
 *
 * Anything we can't parse evaluates to false. Keep this evaluator
 * deliberately narrow — branch rules ship to client-defined audit
 * tests, so the surface area must be safe.
 */
export function evaluateBranchExpression(
  expression: string,
  pipelineState: Record<number, Record<string, any>>,
  currentStepIndex: number,
  ctx: Record<string, any>,
): boolean {
  const expr = (expression || '').trim();
  if (!expr) return false;

  // No operator → truthiness check on the resolved binding.
  const opMatch = expr.match(/^(.+?)\s*(===|!==|==|!=|<=|>=|<|>)\s*(.+)$/);
  if (!opMatch) {
    const lhs = resolveBindingValue(expr, pipelineState, currentStepIndex, ctx);
    return Boolean(lhs);
  }

  const [, rawLhs, op, rawRhs] = opMatch;
  const lhs = resolveBindingValue(rawLhs.trim(), pipelineState, currentStepIndex, ctx);
  const rhs = parseLiteralOrBinding(rawRhs.trim(), pipelineState, currentStepIndex, ctx);

  switch (op) {
    case '==':
    case '===': return lhs == rhs; // eslint-disable-line eqeqeq
    case '!=':
    case '!==': return lhs != rhs; // eslint-disable-line eqeqeq
    case '<':   return Number(lhs) <  Number(rhs);
    case '>':   return Number(lhs) >  Number(rhs);
    case '<=':  return Number(lhs) <= Number(rhs);
    case '>=':  return Number(lhs) >= Number(rhs);
    default:    return false;
  }
}

function parseLiteralOrBinding(
  raw: string,
  pipelineState: Record<number, Record<string, any>>,
  currentStepIndex: number,
  ctx: Record<string, any>,
): any {
  // Quoted strings
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  // Booleans / null
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null' || raw === 'undefined') return null;
  // Numbers
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  // Bindings or bare identifier
  return resolveBindingValue(raw, pipelineState, currentStepIndex, ctx);
}

/**
 * Decide the next step index after the current step finishes. Returns
 * `currentStepIndex + 1` for linear flow, the rule's target for
 * branches, or `Infinity` to terminate the pipeline early.
 *
 * `Infinity` is the agreed sentinel for "go to end" — the runtime
 * checks `nextIndex >= steps.length` to mark the execution complete,
 * so any out-of-range value works.
 */
export function nextStepIndex(
  branchRules: BranchRules | null | undefined,
  currentStepIndex: number,
  totalSteps: number,
  pipelineState: Record<number, Record<string, any>>,
  ctx: Record<string, any>,
): number {
  const fallback = currentStepIndex + 1;
  if (!branchRules || branchRules.mode === 'continue') return fallback;

  const resolveTarget = (t: number | undefined): number => {
    if (t === undefined || t === null) return fallback;
    if (t < 0) return Infinity; // -1 = end
    return t;
  };

  if (branchRules.mode === 'goto') {
    return resolveTarget(branchRules.target);
  }
  if (branchRules.mode === 'skip') {
    return currentStepIndex + 1 + Math.max(1, branchRules.target ?? 1);
  }
  if (branchRules.mode === 'conditional') {
    for (const rule of branchRules.rules || []) {
      if (evaluateBranchExpression(rule.when, pipelineState, currentStepIndex, ctx)) {
        return resolveTarget(rule.target);
      }
    }
    return resolveTarget(branchRules.default);
  }
  return fallback;
}

// ─── Pipeline Validation ───────────────────────────────────────────────────

export interface ValidationError {
  stepIndex: number;
  fieldCode: string;
  message: string;
}

export function validatePipeline(
  steps: { actionDefinitionId: string; inputBindings: Record<string, any> }[],
  definitions: { id: string; inputSchema: InputFieldDef[] }[],
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const def = definitions.find(d => d.id === step.actionDefinitionId);
    if (!def) {
      errors.push({ stepIndex: i, fieldCode: '_action', message: 'Action definition not found' });
      continue;
    }
    for (const field of def.inputSchema as InputFieldDef[]) {
      if (field.required && field.source === 'user') {
        const val = step.inputBindings[field.code];
        if (val === undefined || val === null || val === '') {
          errors.push({ stepIndex: i, fieldCode: field.code, message: `${field.label} is required` });
        }
      }
    }
  }

  return errors;
}
