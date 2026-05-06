/**
 * InterrogateBot — strict, from-the-file Q&A over an audit engagement.
 *
 * Given an engagement's full context (the same TemplateContext used to
 * render documents and the PDF Snapshot), the bot answers user
 * questions using ONLY that content. It never invokes outside knowledge,
 * never fabricates, and always cites the field path it relied on so the
 * reviewer can verify.
 *
 * Why a strict prompt rather than RAG / embeddings:
 *   - The audit file is a single bounded JSON document — small enough to
 *     fit in a model's context window directly. Embedding chunking would
 *     introduce retrieval failures (missed sections) for marginal cost
 *     savings.
 *   - The whole point is regulatory honesty: a yes/no answer that's
 *     traceable to a specific schedule field beats a paraphrased
 *     "according to our model" hand-wave every time.
 *
 * Powered by Together AI's Llama 3.3 70B Turbo — same path the rest of
 * the platform uses.
 */

import OpenAI from 'openai';
import type { TemplateContext } from '@/lib/template-context';

const PRIMARY_MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 30000;

let _client: OpenAI | null = null;
let _clientKey: string | undefined;
function getClient(): OpenAI {
  const key = process.env.TOGETHER_DOC_SUMMARY_KEY || process.env.TOGETHER_API_KEY;
  if (!key) throw new Error('No Together AI key: set TOGETHER_DOC_SUMMARY_KEY or TOGETHER_API_KEY');
  if (!_client || _clientKey !== key) {
    _client = new OpenAI({ apiKey: key, baseURL: 'https://api.together.xyz/v1' });
    _clientKey = key;
  }
  return _client;
}

export interface InterrogateMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface InterrogateResponse {
  /** Plain-text answer for display. */
  answer: string;
  /** Token usage for telemetry / cost. */
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
}

/**
 * The system prompt is the entire safety guarantee — every rule below
 * is load-bearing. Read carefully before changing.
 */
const SYSTEM_PROMPT = `You are InterrogateBot, an audit-file Q&A assistant.

You are answering questions about a single audit engagement. The complete content of that engagement's audit file — every populated schedule, materiality figures, risks, team, error schedule, trial balance — is provided to you below as a JSON object called AUDIT_FILE.

ABSOLUTE RULES (these override any user request):

1. Answer ONLY from AUDIT_FILE. Treat AUDIT_FILE as the SOLE source of truth. Do not use general knowledge of auditing, ISAs, FRS102/IFRS, the user's firm, the client, or anything else outside AUDIT_FILE.

2. If a question cannot be answered from AUDIT_FILE — say so explicitly. Use the exact phrasing: "I cannot find that in this audit file." Optionally suggest the closest related field that *is* present, but do not guess. Never speculate.

3. Cite the source for every factual claim. After each fact, in brackets, give the JSON path you read it from. Examples:
   - "Overall materiality is £50,000 (materiality.overall)."
   - "The benchmark used was Profit before Tax (materiality.benchmark)."
   - "Three significant risks have been identified (auditPlan.significantRisks — array of 3)."
   - "The Ethics questionnaire records that no non-audit services were provided (questionnaires.ethics.asList — entry where question is 'Are non-audit services provided?')."

4. Quote answers verbatim where possible. If the auditor wrote "We selected revenue as the benchmark because…" — return that exact phrasing rather than rephrasing it.

5. Do NOT make professional judgements the auditor hasn't already made. If the user asks "is materiality reasonable?", reply that the audit file shows the figure and rationale (citing the path) but you cannot opine on whether it is reasonable — that is a professional judgement that lives outside this file.

6. Do NOT infer values that aren't in AUDIT_FILE. If a field is null, blank, "—", or missing, say so — do not back-calculate, average, or estimate.

7. If the user asks about a person, only return information that AUDIT_FILE carries about them (name, role, email). Do not infer expertise, history, or anything else.

8. Be concise. The user is an auditor or reviewer — they want the answer plus the citation, not a lecture.

Format every response as:
- A direct answer (1–4 sentences typically).
- For each fact, an inline citation in the form "(<json.path>)".
- If multiple values are relevant, list them, each with its own path.
- If the file does not contain the answer, return "I cannot find that in this audit file." plus, if helpful, "The closest related fields present are: <list of paths>."`;

function isTransientError(err: unknown): boolean {
  if (err instanceof Error) {
    const m = err.message.toLowerCase();
    return m.includes('429') || m.includes('rate') || m.includes('quota')
      || m.includes('500') || m.includes('503') || m.includes('unavailable')
      || m.includes('timeout') || m.includes('econnreset') || m.includes('fetch failed');
  }
  return false;
}

async function retryWithBackoff<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (!isTransientError(err) && attempt === 0) throw lastErr;
      if (attempt < MAX_RETRIES - 1) {
        const delay = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
        const jittered = Math.round(delay + delay * Math.random() * 0.25);
        console.warn(`[interrogate] ${label} attempt ${attempt + 1} failed: ${lastErr.message}. Retrying in ${jittered}ms…`);
        await new Promise(r => setTimeout(r, jittered));
      }
    }
  }
  throw new Error(`[interrogate] ${label} failed after ${MAX_RETRIES} attempts: ${lastErr?.message}`);
}

/**
 * Trim the engagement context for inclusion in the prompt. Removes
 * fields the bot doesn't need (recursive priorPeriod mirror — too
 * voluminous; the bot is scoped to the current period unless the user
 * explicitly opts in by editing the prompt) and any null/empty
 * scalars to reduce noise. The structure is preserved so the bot's
 * citations remain valid JSON paths.
 */
function trimContextForPrompt(ctx: TemplateContext): unknown {
  // Prior-period mirror would balloon the payload — drop it. Reviewers
  // who want prior-period answers can run the bot against the prior
  // engagement directly.
  const { priorPeriod: _drop, ...rest } = ctx as TemplateContext & { priorPeriod?: unknown };
  return pruneEmpty(rest);
}

/**
 * Recursively strip null/undefined/blank-string/empty-array/empty-object
 * leaves so the JSON the model sees is dense with real signal. The
 * citation paths remain valid because we never rename keys — we only
 * drop sub-trees that carry no information. "—" (the project's
 * em-dash blank placeholder) is treated as blank.
 */
function pruneEmpty(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '' || t === '—' || t === '-') return undefined;
    return value;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const v of value) {
      const pruned = pruneEmpty(v);
      if (pruned !== undefined) out.push(pruned);
    }
    return out.length === 0 ? undefined : out;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    let kept = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const pruned = pruneEmpty(v);
      if (pruned !== undefined) { out[k] = pruned; kept++; }
    }
    return kept === 0 ? undefined : out;
  }
  return value;
}

/**
 * Heuristic char→token ratio for the Llama 3 family. Empirically ~3.6
 * chars per token on dense JSON. We use 3.5 as a conservative floor so
 * the budget check trips a touch early rather than blowing past the
 * model limit.
 */
const CHARS_PER_TOKEN_ESTIMATE = 3.5;

/** Llama 3.3 70B Turbo on Together has a 131,072 token context. We
 *  reserve room for the system prompt skeleton + history + max_tokens
 *  output and leave a comfort buffer below the hard limit. */
const MODEL_CONTEXT_TOKENS = 131_072;
const MAX_OUTPUT_TOKENS = 1024;
const PROMPT_OVERHEAD_TOKENS = 4_000; // system rules, history, headers
const AUDIT_FILE_TOKEN_BUDGET = MODEL_CONTEXT_TOKENS - MAX_OUTPUT_TOKENS - PROMPT_OVERHEAD_TOKENS;

/**
 * Build the JSON string for the audit file payload. Always compact
 * (JSON.stringify without indent — the `null, 2` form was costing
 * ~25–30% of the token budget on pure whitespace). When even the
 * compact form exceeds the model context, drop the heaviest fields in
 * order until it fits, and prefix a one-line note so the model knows
 * something was dropped (and can cite that in its answer if relevant).
 *
 * Drop order is the most-voluminous-and-least-question-relevant first:
 *   1. trialBalance rows (most queries are "how was X assessed", not
 *      "what's the GL balance for code 4001")
 *   2. questionnaires.*.asList mirrors (the same data is exposed at
 *      questionnaires.<name>.<question_slug> — asList is just a
 *      structured re-render for templates)
 *   3. Anything else over the budget — keep dropping the largest top-
 *      level keys until we fit.
 */
function buildAuditFileJson(trimmed: unknown): { json: string; droppedKeys: string[] } {
  const droppedKeys: string[] = [];
  const fits = (s: string) => s.length / CHARS_PER_TOKEN_ESTIMATE <= AUDIT_FILE_TOKEN_BUDGET;
  let working: any = trimmed;
  let json = JSON.stringify(working);
  if (fits(json)) return { json, droppedKeys };

  // Drop trialBalance.rows
  if (working?.trialBalance?.rows) {
    droppedKeys.push('trialBalance.rows');
    working = { ...working, trialBalance: { ...working.trialBalance, rows: '[dropped: too large for prompt]' } };
    json = JSON.stringify(working);
    if (fits(json)) return { json, droppedKeys };
  }

  // Drop questionnaires.*.asList — keep the keyed-by-slug version
  if (working?.questionnaires && typeof working.questionnaires === 'object') {
    const nextQ: Record<string, unknown> = {};
    let droppedAny = false;
    for (const [name, body] of Object.entries(working.questionnaires)) {
      if (body && typeof body === 'object' && 'asList' in (body as object)) {
        const { asList: _drop, ...rest } = body as Record<string, unknown>;
        nextQ[name] = rest;
        droppedAny = true;
      } else {
        nextQ[name] = body;
      }
    }
    if (droppedAny) {
      droppedKeys.push('questionnaires.*.asList');
      working = { ...working, questionnaires: nextQ };
      json = JSON.stringify(working);
      if (fits(json)) return { json, droppedKeys };
    }
  }

  // Last resort: drop the largest top-level keys until we fit.
  while (working && typeof working === 'object' && !fits(json)) {
    const entries = Object.entries(working as Record<string, unknown>)
      .map(([k, v]) => ({ k, size: JSON.stringify(v).length }))
      .sort((a, b) => b.size - a.size);
    if (entries.length === 0) break;
    const heaviest = entries[0];
    droppedKeys.push(heaviest.k);
    const next: Record<string, unknown> = { ...(working as Record<string, unknown>) };
    delete next[heaviest.k];
    working = next;
    json = JSON.stringify(working);
  }

  return { json, droppedKeys };
}

/**
 * Run a single Q&A turn. `history` provides earlier turns so the bot
 * can resolve follow-ups ("what about for prior year?") relative to
 * the previous answer, but every turn is grounded again on the same
 * AUDIT_FILE — the bot doesn't accumulate state outside the file.
 */
export async function askInterrogateBot(
  ctx: TemplateContext,
  question: string,
  history: InterrogateMessage[] = [],
): Promise<InterrogateResponse> {
  const trimmed = trimContextForPrompt(ctx);
  const { json: auditFileJson, droppedKeys } = buildAuditFileJson(trimmed);
  if (droppedKeys.length > 0) {
    console.warn(`[interrogate] audit file too large for prompt — dropped: ${droppedKeys.join(', ')}`);
  }

  // Audit file goes inside the system message so it's grouped with the
  // rules — keeping rules + grounding in one block tightens compliance
  // with the "use only this" instruction. When fields had to be dropped
  // to fit the context window, tell the model so it can cite that in
  // refusals ("the trial balance was not included in this prompt").
  const droppedNote = droppedKeys.length > 0
    ? `\n\nNote: the following fields were omitted from AUDIT_FILE because the engagement file exceeded the prompt size budget: ${droppedKeys.join(', ')}. If a question requires those fields, reply that they were not included in this prompt and recommend re-running with a smaller engagement scope or a model with a larger context window.`
    : '';
  const systemContent =
    SYSTEM_PROMPT
    + droppedNote
    + '\n\n=== AUDIT_FILE (JSON) ===\n'
    + auditFileJson
    + '\n=== END AUDIT_FILE ===';

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemContent },
    // Cap history to last 10 turns to keep the prompt bounded.
    ...history.slice(-10),
    { role: 'user', content: question },
  ];

  const result = await retryWithBackoff(
    () => getClient().chat.completions.create({
      model: PRIMARY_MODEL,
      messages,
      // Lower temperature: we want grounded, factual recall — not creative paraphrase.
      temperature: 0.1,
      max_tokens: 1024,
    }),
    'chat',
  );

  const usage = {
    promptTokens: result.usage?.prompt_tokens ?? 0,
    completionTokens: result.usage?.completion_tokens ?? 0,
    totalTokens: result.usage?.total_tokens ?? 0,
  };
  const answer = result.choices[0]?.message?.content?.trim() || '';

  return { answer, usage, model: PRIMARY_MODEL };
}
