import OpenAI from 'openai';
import type {
  StaffMember,
  ResourceJobView,
  Allocation,
  OptimizationResult,
  OptimizationScope,
  AllocationChange,
  OptimizationViolation,
  ProposedAllocation,
} from './types';
import { BREAKABLE_CONSTRAINTS, DEFAULT_CONSTRAINT_ORDER } from './optimizer-constraints';
import { countWorkingDays } from './date-utils';

// ─── AI Client ───────────────────────────────────────────────────────────────

let _client: OpenAI | null = null;
let _clientKey: string | undefined;

function getClient(): OpenAI {
  const key = process.env.TOGETHER_API_KEY || process.env.TOGETHER_DOC_SUMMARY_KEY;
  if (!key) throw new Error('No Together AI key configured — set TOGETHER_API_KEY');
  if (!_client || _clientKey !== key) {
    _client = new OpenAI({ apiKey: key, baseURL: 'https://api.together.xyz/v1' });
    _clientKey = key;
  }
  return _client;
}

const PRIMARY_MODEL = 'meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo';
const FALLBACK_MODEL = 'Qwen/Qwen2.5-72B-Instruct-Turbo';

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 30000;

// ─── Retry helpers (identical pattern to doc-summary-ai.ts) ──────────────────

function isTransientError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('429') ||
      msg.includes('rate') ||
      msg.includes('quota') ||
      msg.includes('500') ||
      msg.includes('503') ||
      msg.includes('unavailable') ||
      msg.includes('timeout') ||
      msg.includes('econnreset') ||
      msg.includes('fetch failed')
    );
  }
  return false;
}

function isModelUnavailableError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      (msg.includes('404') && (msg.includes('model') || msg.includes('unable to access'))) ||
      msg.includes('model not found') ||
      msg.includes('does not exist')
    );
  }
  return false;
}

function parseRetryDelay(message: string): number | null {
  const m = message.match(/retry\s+(?:in\s+)?(\d+(?:\.\d+)?)\s*s/i);
  if (m) return Math.ceil(parseFloat(m[1]) * 1000);
  const ms = message.match(/retry\s+(?:in\s+)?(\d+)\s*ms/i);
  if (ms) return parseInt(ms[1], 10);
  return null;
}

function addJitter(ms: number): number {
  return Math.round(ms + ms * Math.random() * 0.25);
}

async function retryWithBackoff<T>(fn: () => Promise<T>, context: string): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (!isTransientError(err) && attempt === 0) throw new Error(`[${context}] ${lastError.message}`);
      if (attempt < MAX_RETRIES - 1) {
        const hint = parseRetryDelay(lastError.message);
        const exp = BASE_BACKOFF_MS * Math.pow(2, attempt);
        const delay = addJitter(Math.min(Math.max(hint ?? exp, BASE_BACKOFF_MS), MAX_BACKOFF_MS));
        console.warn(`[${context}] Attempt ${attempt + 1} failed. Retrying in ${delay}ms…`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw new Error(`[${context}] Failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

// ─── Date utilities ───────────────────────────────────────────────────────────

function fmtDate(d: Date | string): string {
  return new Date(d).toISOString().split('T')[0];
}

// ─── Prompt Builder ──────────────────────────────────────────────────────────

export function buildOptimizerPrompt(
  jobs: ResourceJobView[],
  staff: StaffMember[],
  allocations: Allocation[],
  constraintOrder: string[],
  scope: OptimizationScope,
  today: string,
): string {
  // Build ordered constraint list for prompt
  const order = constraintOrder.length > 0 ? constraintOrder : DEFAULT_CONSTRAINT_ORDER;
  const constraintLines = order.map((id, i) => {
    const def = BREAKABLE_CONSTRAINTS.find((c) => c.id === id);
    return `${i + 1}. [${id}] ${def?.description ?? id}`;
  });

  // Compact staff representation
  const staffData = staff
    .filter((s) => s.isActive && s.resourceSetting)
    .map((s) => {
      const rs = s.resourceSetting!;
      const roles: { role: string; limit: number }[] = [];
      if (rs.specialistJobLimit != null && rs.specialistJobLimit > 0) roles.push({ role: 'Specialist', limit: rs.specialistJobLimit });
      if (rs.preparerJobLimit != null && rs.preparerJobLimit > 0) roles.push({ role: 'Preparer', limit: rs.preparerJobLimit });
      if (rs.reviewerJobLimit != null && rs.reviewerJobLimit > 0) roles.push({ role: 'Reviewer', limit: rs.reviewerJobLimit });
      if (rs.riJobLimit != null && rs.riJobLimit > 0) roles.push({ role: 'RI', limit: rs.riJobLimit });
      if (roles.length === 0) roles.push({ role: rs.resourceRole, limit: rs.concurrentJobLimit });

      // Specialist sub-roles (Ethics, EQR, Technical etc.)
      const specialistSubRoles: string[] = [];
      if (rs.specialistJobLimit != null && rs.specialistJobLimit > 0) {
        // The resourceRole acts as sub-role identifier for specialists
        if (['Ethics', 'EQR', 'Technical'].includes(rs.resourceRole)) {
          specialistSubRoles.push(rs.resourceRole);
        }
      }

      return {
        id: s.id,
        name: s.name,
        weeklyHrs: rs.weeklyCapacityHrs,
        overtimeHrs: rs.overtimeHrs,
        isRI: rs.isRI,
        roles,
        ...(specialistSubRoles.length > 0 ? { specialistSubRoles } : {}),
      };
    });

  // Compact job representation
  const today_date = new Date(today);
  const jobData = jobs.map((j) => {
    const jobAllocs = allocations.filter((a) => a.engagementId === j.id);
    const hasStarted = jobAllocs.some((a) => new Date(a.startDate) < today_date);
    return {
      id: j.id,
      client: j.clientName,
      auditType: j.auditType,
      periodEnd: fmtDate(j.periodEnd),
      targetDate: fmtDate(j.targetCompletion),
      ...(j.customDeadline ? { customDeadline: fmtDate(j.customDeadline) } : {}),
      budgetHrs: {
        Spec: j.budgetHoursSpecialist,
        RI: j.budgetHoursRI,
        Rev: j.budgetHoursReviewer,
        Prep: j.budgetHoursPreparer,
      },
      locked: j.isScheduleLocked,
      status: j.schedulingStatus,
      hasStarted,
    };
  });

  // Compact allocation representation
  const allocData = allocations
    .filter((a) => jobs.some((j) => j.id === a.engagementId))
    .map((a) => ({
      id: a.id,
      jobId: a.engagementId,
      userId: a.userId,
      role: a.role,
      startDate: fmtDate(a.startDate),
      endDate: fmtDate(a.endDate),
      hoursPerDay: a.hoursPerDay,
    }));

  return `You are an expert resource scheduler for an audit and assurance firm.
Your task is to produce the optimal schedule for the jobs provided.

TODAY: ${today}
SCOPE: ${scope === 'all' ? 'ALL non-locked jobs (may replace existing allocations)' : 'UNSCHEDULED jobs only (no existing allocations)'}

=== HARD CONSTRAINTS (must NEVER be violated) ===
1. [no-specialist-on-team] Staff listed as Ethics, EQR, or Technical specialists (see specialistSubRoles) on a job cannot also be assigned Preparer, Reviewer, or RI on that same job.
2. [one-ri-per-job] Every job must have exactly 1 RI allocation.
3. [exact-role-hours] hoursPerDay × countWorkingDays(startDate, endDate) must equal the budget hours for that role EXACTLY. Working days = Mon-Fri only.

=== BREAKABLE CONSTRAINTS (avoid breaking; lower number = more important) ===
${constraintLines.join('\n')}

=== STAFF (${staffData.length} members) ===
${JSON.stringify(staffData)}

=== JOBS IN SCOPE (${jobData.length} jobs) ===
${JSON.stringify(jobData)}

=== EXISTING ALLOCATIONS ===
${JSON.stringify(allocData)}

=== SCHEDULING RULES ===
- For each job in scope, output a COMPLETE list of allocations (this REPLACES all existing non-locked allocations for that job).
- Start dates MUST be Mondays. End dates MUST be Fridays.
- Working days count is Mon-Fri inclusive (no weekends, ignore public holidays for simplicity).
- To satisfy exact-role-hours: choose startDate (Monday) and endDate (Friday) such that countWorkingDays(start,end) × hoursPerDay = budget hours. hoursPerDay must be between 0.5 and 10.
- Example: 40 budget hours → 8 days at 5h/day, or 10 days at 4h/day. End date must be the Friday of the last work week.
- The job's work must be completed by targetDate (or customDeadline if provided). endDate must be ≤ that date.
- Do not output allocations for jobs with locked=true (leave them unchanged).
- If you cannot schedule a job without breaking constraint priority 1 or 2 AND no staff are available, add that jobId to "unschedulable".
- List every constraint violation you were forced to make in "violations".

Respond with a single JSON object ONLY (no markdown, no explanation outside the JSON):
{
  "schedule": [
    {
      "jobId": "string",
      "allocations": [
        { "userId": "string", "role": "Preparer|Reviewer|RI|Specialist", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "hoursPerDay": number }
      ]
    }
  ],
  "violations": [
    { "constraintId": "string", "priority": number, "jobId": "string", "userId": "string", "description": "string" }
  ],
  "unschedulable": ["jobId1"],
  "reasoning": "2-3 sentence plain English summary of the schedule and any compromises made"
}`;
}

// ─── JSON extraction ─────────────────────────────────────────────────────────
// Handles:
//  • Markdown fences  ```json ... ``` or ``` ... ```
//  • Thinking model output  <think>...</think> prefix
//  • Leading/trailing whitespace and prose before/after the JSON object

function extractJson(raw: string): string {
  // Strip <think>...</think> blocks (Qwen, DeepSeek reasoning models)
  let s = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Strip markdown code fences
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) return fenceMatch[1].trim();

  // If there's no fence, find the first { and last } to extract the JSON object
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) return s.slice(start, end + 1);

  return s;
}

// ─── AI Call ─────────────────────────────────────────────────────────────────

export interface OptimizerRawResult {
  json: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export async function runOptimizer(prompt: string): Promise<OptimizerRawResult> {
  const client = getClient();
  let usedModel = PRIMARY_MODEL;

  const callModel = async (model: string): Promise<OptimizerRawResult> => {
    return retryWithBackoff(async () => {
      const resp = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 8192,
      });

      const content = extractJson(resp.choices[0]?.message?.content ?? '{}');
      return {
        json: content,
        model,
        promptTokens: resp.usage?.prompt_tokens ?? 0,
        completionTokens: resp.usage?.completion_tokens ?? 0,
      };
    }, `optimizer:${model}`);
  };

  try {
    return await callModel(PRIMARY_MODEL);
  } catch (err) {
    if (isModelUnavailableError(err)) {
      console.warn('[optimizer] Primary model unavailable, falling back to', FALLBACK_MODEL);
      usedModel = FALLBACK_MODEL;
      return callModel(FALLBACK_MODEL);
    }
    throw err;
  }
}

// ─── Response Parser ──────────────────────────────────────────────────────────

export function parseOptimizerResponse(
  raw: string,
  jobs: ResourceJobView[],
  staff: StaffMember[],
  existingAllocations: Allocation[],
  constraintOrder: string[],
): OptimizationResult {
  const order = constraintOrder.length > 0 ? constraintOrder : DEFAULT_CONSTRAINT_ORDER;
  const staffMap = new Map(staff.map((s) => [s.id, s.name]));
  const jobMap = new Map(jobs.map((j) => [j.id, j]));

  let parsed: any = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('[optimizer] Failed to parse AI response JSON:', raw.slice(0, 500));
    return {
      schedule: [],
      violations: [{ constraintId: 'parse-error', priority: 0, description: 'AI returned invalid JSON — please retry.' }],
      unschedulable: [],
      reasoning: 'Failed to parse optimizer response.',
      changes: [],
    };
  }

  // Build schedule
  const schedule: { jobId: string; allocations: ProposedAllocation[] }[] = [];
  for (const entry of (parsed.schedule ?? [])) {
    if (!entry?.jobId) continue;
    const job = jobMap.get(entry.jobId);
    const allocs: ProposedAllocation[] = (entry.allocations ?? []).map((a: any) => ({
      userId: a.userId ?? '',
      userName: staffMap.get(a.userId) ?? a.userId ?? '',
      role: a.role,
      startDate: a.startDate,
      endDate: a.endDate,
      hoursPerDay: a.hoursPerDay,
      totalHours: a.hoursPerDay * countWorkingDays(new Date(a.startDate), new Date(a.endDate)),
      availabilityScore: 0,
      familiarityScore: 0,
    }));
    schedule.push({ jobId: entry.jobId, allocations: allocs });
  }

  // Build violations with priority from constraint order
  const violations: OptimizationViolation[] = (parsed.violations ?? []).map((v: any) => ({
    constraintId: v.constraintId ?? '',
    priority: order.indexOf(v.constraintId) + 1 || v.priority || 99,
    jobId: v.jobId,
    userId: v.userId,
    description: v.description ?? '',
  })).sort((a: OptimizationViolation, b: OptimizationViolation) => a.priority - b.priority);

  // Compute AllocationChange[] — diff proposed schedule vs existing allocations
  const changes: AllocationChange[] = [];

  for (const entry of schedule) {
    const job = jobMap.get(entry.jobId);
    if (!job) continue;

    // All existing allocations for this job
    const existing = existingAllocations.filter((a) => a.engagementId === entry.jobId);

    // Mark all existing as delete (unless exact match found in proposals)
    for (const ea of existing) {
      const matched = entry.allocations.find(
        (pa) =>
          pa.userId === ea.userId &&
          pa.role === ea.role &&
          pa.startDate.slice(0, 10) === ea.startDate.slice(0, 10) &&
          pa.endDate.slice(0, 10) === ea.endDate.slice(0, 10) &&
          Math.abs(pa.hoursPerDay - ea.hoursPerDay) < 0.01,
      );
      if (!matched) {
        changes.push({
          action: 'delete',
          existingId: ea.id,
          jobId: job.id,
          clientName: job.clientName,
          auditType: job.auditType,
          userId: ea.userId,
          userName: ea.userName,
          role: ea.role,
          startDate: ea.startDate.slice(0, 10),
          endDate: ea.endDate.slice(0, 10),
          hoursPerDay: ea.hoursPerDay,
        });
      }
    }

    // Mark proposed as create (unless exact match exists)
    for (const pa of entry.allocations) {
      const matched = existing.find(
        (ea) =>
          ea.userId === pa.userId &&
          ea.role === pa.role &&
          ea.startDate.slice(0, 10) === pa.startDate.slice(0, 10) &&
          ea.endDate.slice(0, 10) === pa.endDate.slice(0, 10) &&
          Math.abs(ea.hoursPerDay - pa.hoursPerDay) < 0.01,
      );
      if (!matched) {
        changes.push({
          action: 'create',
          jobId: job.id,
          clientName: job.clientName,
          auditType: job.auditType,
          userId: pa.userId,
          userName: staffMap.get(pa.userId) ?? pa.userId,
          role: pa.role,
          startDate: pa.startDate.slice(0, 10),
          endDate: pa.endDate.slice(0, 10),
          hoursPerDay: pa.hoursPerDay,
        });
      }
    }
  }

  return {
    schedule,
    violations,
    unschedulable: parsed.unschedulable ?? [],
    reasoning: parsed.reasoning ?? '',
    changes,
  };
}
