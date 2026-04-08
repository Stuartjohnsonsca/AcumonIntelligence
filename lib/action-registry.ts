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
 * Supports: "$prev.<field>", "$step.<index>.<field>", "$ctx.<path>", "{{template}}"
 */
export function resolveBindingValue(
  value: any,
  pipelineState: Record<number, Record<string, any>>,
  currentStepIndex: number,
  ctx: Record<string, any>,
): any {
  if (typeof value !== 'string') return value;

  // $prev.<field>
  if (value.startsWith('$prev.')) {
    const field = value.slice(6);
    const prev = pipelineState[currentStepIndex - 1];
    return prev?.[field] ?? null;
  }

  // $step.<index>.<field>
  if (value.startsWith('$step.')) {
    const parts = value.slice(6).split('.');
    const stepIdx = parseInt(parts[0], 10);
    const field = parts.slice(1).join('.');
    return pipelineState[stepIdx]?.[field] ?? null;
  }

  // $ctx.<path>
  if (value.startsWith('$ctx.')) {
    const path = value.slice(5).split('.');
    let current: any = ctx;
    for (const key of path) {
      if (current == null) return null;
      current = current[key];
    }
    return current ?? null;
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
