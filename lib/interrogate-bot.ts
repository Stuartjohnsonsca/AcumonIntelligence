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
  return rest;
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
  const auditFileJson = JSON.stringify(trimContextForPrompt(ctx), null, 2);

  // Audit file goes inside the system message so it's grouped with the
  // rules — keeping rules + grounding in one block tightens compliance
  // with the "use only this" instruction.
  const systemContent =
    SYSTEM_PROMPT
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
