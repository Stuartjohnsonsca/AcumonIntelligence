/**
 * Portal AI Search — natural-language query → structured filter.
 *
 * The portal dashboards previously had a dumb substring-over-question
 * search box. This module upgrades it to an LLM-interpreted query
 * that returns the same structured filter shape the dashboards
 * already use (status / FS Lines / TB codes / assignee / text).
 *
 * Grounded: the prompt is given the engagement's actual FS Line
 * names, TB codes, staff names, and status values so the model can
 * only emit IDs/codes that exist — nothing hallucinated.
 *
 * Interpretation cache: the returned `interpretedFilters` object is
 * persisted on PortalSearchLog so that saving + re-running a search
 * doesn't cost a second AI call.
 */

import { prisma } from '@/lib/db';

export type ChartType   = 'bar' | 'line' | 'pie' | 'none';
export type ChartGroupBy = 'assignee' | 'fsLine' | 'status' | 'escalationLevel' | 'day' | 'tbCode' | 'returnedForMore';
export type ChartMetric  = 'count' | 'avgResponseHours' | 'overdueCount' | 'medianResponseHours';

/**
 * Optional chart spec the AI may emit alongside the filter. The
 * dashboard aggregates the filtered request list client-side
 * against this spec and renders a simple SVG visualisation — no
 * extra data round-trip needed. `type: 'none'` means the query
 * isn't a good fit for a chart (e.g. a narrow lookup like "the
 * audit query about bank statements") and nothing renders.
 */
export interface ChartSpec {
  type: ChartType;
  groupBy: ChartGroupBy | null;
  metric: ChartMetric;
  title: string;
}

export interface InterpretedFilters {
  status: 'outstanding' | 'responded' | 'escalated' | 'overdue' | null;
  fsLineIds: string[];
  tbAccountCodes: string[];
  assigneeIds: string[];
  textMatch: string | null;
  /** Human-readable explanation so the UI can render "Interpreted as…". */
  reasoning: string;
  /** Optional chart spec — see ChartSpec. */
  chart: ChartSpec | null;
}

export interface AiSearchContext {
  engagementIds: string[];
  fsLines: Array<{ id: string; name: string }>;
  tbCodes: Array<{ accountCode: string; description: string; fsLineName?: string }>;
  staff: Array<{ id: string; name: string }>;
}

const SYSTEM = `You are a filter-builder AND chart-suggester for a portal dashboard listing client-audit requests.
Convert the user's natural-language query into a structured JSON filter + optional chart spec.

STRICT rules:
- Return ONLY JSON matching the schema. No prose, no markdown fences.
- Only use FS Line IDs, TB account codes and staff IDs that appear in the provided catalogue.
  Never invent IDs or codes.
- status must be exactly one of: "outstanding", "responded", "escalated", "overdue", or null.
- textMatch is a case-insensitive substring used when the user wants to match words in the
  request text that AREN'T captured by FS Line / TB / staff — e.g. "bank statements",
  "right-to-work evidence". Null when the query is fully handled by the structured fields.
- reasoning is ONE short sentence explaining what you interpreted (shown to the user).

CHART spec guidance:
- Set chart.type = "none" when the user clearly wants a LOOKUP (e.g. "find the request about bank
  statements") — no chart makes sense. When the user asks for analysis, counts, patterns, comparisons,
  or uses words like "how many", "show me", "compare", "by", "over time", pick the right chart:
    - "bar"  — comparing counts across categorical groups (assignee, status, FS Line, TB code)
    - "line" — time-series, "over time", "trend", "last 30 days"
    - "pie"  — proportions of a total (status mix, escalation level mix)
- chart.groupBy must be one of:
    "assignee" | "fsLine" | "status" | "escalationLevel" | "day" | "tbCode" | "returnedForMore"
  or null when chart.type is "none".
- chart.metric is one of:
    "count"              — how many requests per group (default)
    "avgResponseHours"   — mean response time per group
    "medianResponseHours"— median response time
    "overdueCount"       — overdue requests per group
- chart.title is a short phrase the dashboard renders above the chart (under 60 chars).

Schema:
{
  "status": string | null,
  "fsLineIds": [string],
  "tbAccountCodes": [string],
  "assigneeIds": [string],
  "textMatch": string | null,
  "reasoning": string,
  "chart": {
    "type":   "bar" | "line" | "pie" | "none",
    "groupBy": "assignee" | "fsLine" | "status" | "escalationLevel" | "day" | "tbCode" | "returnedForMore" | null,
    "metric": "count" | "avgResponseHours" | "medianResponseHours" | "overdueCount",
    "title":  string
  } | null
}

If the query is vague, prefer a broader match (empty arrays, textMatch, chart: null) over a narrow guess.`;

function buildUserPrompt(query: string, ctx: AiSearchContext): string {
  const fsBlock = ctx.fsLines.length === 0
    ? 'No FS Lines available.'
    : ctx.fsLines.map(f => `  - ${f.id}  →  ${f.name}`).join('\n');
  const tbBlock = ctx.tbCodes.length === 0
    ? 'No TB codes available.'
    // Cap at 200 codes in the prompt to keep tokens manageable.
    : ctx.tbCodes.slice(0, 200).map(c => `  - ${c.accountCode}  →  ${c.description}${c.fsLineName ? `  (${c.fsLineName})` : ''}`).join('\n')
      + (ctx.tbCodes.length > 200 ? `\n  ... (+${ctx.tbCodes.length - 200} more truncated)` : '');
  const staffBlock = ctx.staff.length === 0
    ? 'No staff available.'
    : ctx.staff.map(s => `  - ${s.id}  →  ${s.name}`).join('\n');

  return `User query:
"""
${query.slice(0, 1000)}
"""

Catalogue (use IDs / codes EXACTLY as shown — no invented values):

FS Lines:
${fsBlock}

TB codes (accountCode → description):
${tbBlock}

Staff (assignee IDs):
${staffBlock}

Produce the filter JSON.`;
}

/**
 * Interpret a free-text query against the given engagement catalogue.
 * Returns structured filters the dashboard can apply directly. AI
 * failure falls back to a textMatch-only filter (i.e. degrades to
 * the old substring search), so a model outage can never break the
 * search box completely.
 */
export async function interpretSearchQuery(query: string, ctx: AiSearchContext): Promise<InterpretedFilters> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    // No AI key configured — fall back to substring match.
    return fallback(query);
  }

  try {
    const res = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user',   content: buildUserPrompt(query, ctx) },
        ],
        max_tokens: 600,
        temperature: 0.1,
      }),
    });
    if (!res.ok) throw new Error(`AI returned ${res.status}`);
    const data = await res.json();
    const text = (data.choices?.[0]?.message?.content || '').trim();
    const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/) || cleaned.match(/(\{[\s\S]*\})/);
    const json = JSON.parse(match ? match[1] : cleaned);

    // Post-validate against the catalogue — never trust the model
    // with stringly-typed IDs. Drop any ID that isn't in the
    // provided catalogue, and clamp status to the allowed set.
    const fsAllowed = new Set(ctx.fsLines.map(f => f.id));
    const tbAllowed = new Set(ctx.tbCodes.map(c => c.accountCode));
    const staffAllowed = new Set(ctx.staff.map(s => s.id));
    const allowedStatus = new Set(['outstanding', 'responded', 'escalated', 'overdue']);
    const status = typeof json.status === 'string' && allowedStatus.has(json.status) ? json.status : null;
    // Post-validate the chart spec — strict allow-lists on every
    // field so a hallucinated groupBy / metric can never reach the
    // client. type="none" is the safe default when anything looks off.
    const allowedTypes: ChartType[] = ['bar', 'line', 'pie', 'none'];
    const allowedGroupBy: ChartGroupBy[] = ['assignee', 'fsLine', 'status', 'escalationLevel', 'day', 'tbCode', 'returnedForMore'];
    const allowedMetrics: ChartMetric[] = ['count', 'avgResponseHours', 'overdueCount', 'medianResponseHours'];
    let chart: ChartSpec | null = null;
    if (json.chart && typeof json.chart === 'object') {
      const t = json.chart.type;
      if (allowedTypes.includes(t)) {
        const gb = allowedGroupBy.includes(json.chart.groupBy) ? json.chart.groupBy : null;
        const m  = allowedMetrics.includes(json.chart.metric)  ? json.chart.metric  : 'count';
        chart = {
          type: t as ChartType,
          groupBy: t === 'none' ? null : gb,
          metric: m,
          title: typeof json.chart.title === 'string' ? String(json.chart.title).slice(0, 60) : '',
        };
        // Enforce coherence: if groupBy is null but type isn't 'none',
        // bump to 'none' rather than render a broken chart.
        if (chart.type !== 'none' && !chart.groupBy) chart.type = 'none';
      }
    }

    return {
      status: (status || null) as InterpretedFilters['status'],
      fsLineIds: Array.isArray(json.fsLineIds) ? json.fsLineIds.filter((x: any) => typeof x === 'string' && fsAllowed.has(x)) : [],
      tbAccountCodes: Array.isArray(json.tbAccountCodes) ? json.tbAccountCodes.filter((x: any) => typeof x === 'string' && tbAllowed.has(x)) : [],
      assigneeIds: Array.isArray(json.assigneeIds) ? json.assigneeIds.filter((x: any) => typeof x === 'string' && staffAllowed.has(x)) : [],
      textMatch: typeof json.textMatch === 'string' && json.textMatch.trim() ? String(json.textMatch).trim().slice(0, 200) : null,
      reasoning: typeof json.reasoning === 'string' ? String(json.reasoning).slice(0, 300) : '',
      chart,
    };
  } catch (err) {
    console.error('[portal-ai-search] interpretSearchQuery failed, falling back to substring:', (err as any)?.message || err);
    return fallback(query);
  }
}

function fallback(query: string): InterpretedFilters {
  return {
    status: null,
    fsLineIds: [],
    tbAccountCodes: [],
    assigneeIds: [],
    textMatch: query.trim().slice(0, 200),
    reasoning: 'AI unavailable — using plain substring match over question text.',
    chart: null,
  };
}

/**
 * Persist a search run to PortalSearchLog. Returns the created row's
 * id so the client can reference it when the user clicks "Save".
 */
export async function logPortalSearch(input: {
  firmId: string;
  engagementId: string | null;
  clientId: string | null;
  portalUserId: string | null;
  firmUserId: string | null;
  query: string;
  resultCount: number;
  interpretedFilters: InterpretedFilters | null;
}): Promise<string | null> {
  try {
    const row = await prisma.portalSearchLog.create({
      data: {
        firmId: input.firmId,
        engagementId: input.engagementId,
        clientId: input.clientId,
        portalUserId: input.portalUserId,
        firmUserId: input.firmUserId,
        query: input.query.slice(0, 1000),
        queryNormalised: input.query.trim().toLowerCase().slice(0, 1000),
        resultCount: input.resultCount,
        interpretedFilters: (input.interpretedFilters as any) ?? null,
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    console.error('[portal-ai-search] logPortalSearch failed:', (err as any)?.message || err);
    return null;
  }
}
