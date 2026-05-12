/**
 * Tax-computation AI extractor.
 *
 * Given the plain-text contents of a corporation-tax computation
 * (typically a CT600 supporting comp, a tax adviser's PDF/Excel, or an
 * in-house tax schedule), ask the LLM to emit a structured list of
 * adjustment lines that the Tax on Profits panel can apply to the
 * computation grid in one click.
 *
 * Strict no-hallucination rule: the model returns only adjustment
 * lines actually present in the source. Unknown amounts come back as
 * null rather than guessed.
 */

export interface ExtractedTaxCompAdjustment {
  /** Description / narrative for the adjustment as worded in the
   *  source document (e.g. "Depreciation add-back", "Capital
   *  allowances claimed", "Entertaining — non-staff"). */
  description: string;
  /** Adjustment amount in £. Positive means add-back to taxable
   *  profit; negative means deduction. */
  amount: number;
  /** Disallowable element when the source separates it from the
   *  total. Most CT computations bundle disallowable into the
   *  amount, in which case this stays undefined / 0. */
  disallowable?: number;
  /** Free-form note the model couldn't fit elsewhere (e.g. "split
   *  across UK / IE per source"). Optional. */
  note?: string;
}

export interface ExtractedTaxComp {
  /** Adjustment lines pulled from the document. */
  adjustments: ExtractedTaxCompAdjustment[];
  /** Profit before tax the source agrees, when stated. Lets the
   *  panel cross-check against the TB-derived value. */
  accountingProfit?: number;
  /** Tax charge per the P&L / accounts, when stated. */
  taxCharge?: number;
  /** Plain-English summary the auditor sees in the version picker —
   *  "Draft CT comp prepared by ABC Tax LLP for y/e 31 March 2024;
   *   12 adjustments totalling £42k add-back". */
  summary: string;
  /** Anything the model observed but couldn't fit the schema —
   *  surfaced as a banner so the auditor knows there's source data
   *  not represented in the extracted rows. */
  unmappedNotes?: string;
}

export interface ExtractInput {
  /** Concatenated plain-text from the uploaded computation. */
  textContent: string;
  /** Engagement period start ISO. */
  periodStartIso?: string;
  /** Engagement period end ISO. */
  periodEndIso?: string;
}

export interface ExtractResult {
  data: ExtractedTaxComp | null;
  rawAiResponse?: string;
  model?: string;
  /** Set when the model key is missing or the call failed. */
  error?: string;
}

const SYSTEM_PROMPT = `You are extracting structured data from a UK
corporation-tax computation so an auditor can populate a Tax on Profits
working paper.

CRITICAL RULES:
- Output ONLY valid JSON, matching the schema below. No prose, no
  markdown, no commentary outside the JSON.
- DO NOT fabricate values. If the document doesn't say something, omit
  it (or use null). Better to return an empty object than to guess.
- Adjustments are the lines that reconcile accounting profit to
  taxable profit. Typical examples:
  * Depreciation add-back, amortisation add-back, impairment add-back
  * Capital allowances claimed (deduction — emit as a negative amount)
  * Non-trade interest received (often a deduction from trading profits)
  * Disallowable entertaining, gifts, fines & penalties
  * R&D super-deduction / RDEC (deduction — negative amount)
  * Pension contributions paid vs accrued
  * Loss brought forward / utilised
  * Group relief surrendered or claimed
- For amounts, return raw numbers (no currency symbols, no thousands
  separators). Currency is implied to be GBP unless the document states
  otherwise — flag non-GBP currency in unmappedNotes.
- Positive amount = add-back to taxable profit. Negative amount =
  deduction from taxable profit. Mirror the SIGN the source document
  uses; do not flip it.
- If the document separately discloses a "disallowable" portion within
  a line (e.g. £10k motor expenses of which £4k disallowable), put the
  disallowable element in the disallowable field and the FULL amount
  in amount.
- If the source includes "Profit before tax" or "Tax charge per the
  P&L / accounts", capture them in the top-level accountingProfit and
  taxCharge fields. Otherwise leave them null.
- summary: a one-sentence plain-English description of what the
  document is (preparer, period, headline numbers).

Schema:
{
  "adjustments": [
    { "description": "<line narrative>", "amount": <number>,
      "disallowable": <number|null>, "note": "<optional>" }
  ],
  "accountingProfit": <number|null>,
  "taxCharge": <number|null>,
  "summary": "<one-sentence description>",
  "unmappedNotes": "<anything observed but not fitting the schema>"
}`;

export async function aiExtractTaxComp(input: ExtractInput): Promise<ExtractResult> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    return { data: null, model: 'no-key', error: 'TOGETHER_API_KEY not set' };
  }

  const periodLine = input.periodStartIso && input.periodEndIso
    ? `Engagement audit period: ${input.periodStartIso} to ${input.periodEndIso}.`
    : '';
  const userMessage = [
    periodLine,
    '',
    'Source tax computation (plain text):',
    input.textContent.slice(0, 100000),
  ].filter(Boolean).join('\n');

  const model = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
  try {
    const res = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { data: null, rawAiResponse: txt, model, error: `LLM HTTP ${res.status}` };
    }
    const body = await res.json();
    const raw = body?.choices?.[0]?.message?.content || '';
    let parsed: unknown;
    try {
      const trimmed = String(raw).trim().replace(/^```(?:json)?\n?|\n?```$/g, '');
      parsed = JSON.parse(trimmed);
    } catch {
      return { data: null, rawAiResponse: raw, model, error: 'LLM returned non-JSON' };
    }

    const adjustmentsRaw = Array.isArray((parsed as any)?.adjustments) ? (parsed as any).adjustments : [];
    const adjustments: ExtractedTaxCompAdjustment[] = adjustmentsRaw
      .map((a: any) => ({
        description: typeof a?.description === 'string' ? a.description.trim() : '',
        amount: numOrZero(a?.amount),
        disallowable: a?.disallowable === null || a?.disallowable === undefined ? undefined : numOrZero(a.disallowable),
        note: typeof a?.note === 'string' && a.note.trim() ? a.note.trim() : undefined,
      }))
      .filter((a: ExtractedTaxCompAdjustment) => a.description && isFinite(a.amount));

    const data: ExtractedTaxComp = {
      adjustments,
      accountingProfit: typeof (parsed as any)?.accountingProfit === 'number' ? (parsed as any).accountingProfit : undefined,
      taxCharge: typeof (parsed as any)?.taxCharge === 'number' ? (parsed as any).taxCharge : undefined,
      summary: typeof (parsed as any)?.summary === 'string' ? (parsed as any).summary : '',
      unmappedNotes: typeof (parsed as any)?.unmappedNotes === 'string' && (parsed as any).unmappedNotes.trim()
        ? (parsed as any).unmappedNotes.trim()
        : undefined,
    };
    return { data, rawAiResponse: raw, model };
  } catch (e: any) {
    return { data: null, model, error: String(e?.message || e) };
  }
}

function numOrZero(v: unknown): number {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[,£$€\s]/g, '').replace(/^\((.*)\)$/, '-$1');
    const n = parseFloat(cleaned);
    return isFinite(n) ? n : 0;
  }
  return 0;
}
