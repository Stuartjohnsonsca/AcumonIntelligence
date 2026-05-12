/**
 * Loan-document AI extractor.
 *
 * Given the plain-text contents of one or more loan-related documents
 * (facility agreement, loan note, drawdown notice, repayment schedule,
 * lender statement, side-letter), ask the LLM to emit a structured
 * JSON payload describing the loan(s) — header fields, schedule rows,
 * covenants and penalties.
 *
 * Strict no-hallucination rule: the model returns only fields that are
 * explicitly in the source. Unknown fields come back as null / omitted
 * rather than guessed.
 */

import type { LoanHeader, LoanScheduleRow, LoanCovenant, LoanPenalty, Periodicity, DayCount } from './loan-calculator';

export interface ExtractedLoan {
  header: Partial<LoanHeader>;
  schedule: LoanScheduleRow[];
  covenants: Omit<LoanCovenant, 'id' | 'clientConfirmedViaPortal' | 'metStatus' | 'notes'>[];
  penalties: Omit<LoanPenalty, 'id' | 'requiresDisclosure' | 'notes'>[];
  /** Plain-English summary of any data the model SAW but couldn't fit
   *  the schema — surfaced as a banner so the auditor knows. */
  unmappedNotes: string;
}

export interface ExtractInput {
  /** Concatenated plain-text from all source docs for this loan. */
  textContent: string;
  /** Engagement period start ISO — gives the model a frame of reference. */
  periodStartIso?: string;
  /** Engagement period end ISO. */
  periodEndIso?: string;
  /** Receivable vs liability — sets the model's "lender" perspective. */
  side: 'receivable' | 'liability';
}

export interface ExtractResult {
  loans: ExtractedLoan[];
  rawAiResponse?: string;
  model?: string;
  /** Set when the model key is missing or the call failed — surfaced to
   *  the UI so the user knows nothing was extracted (rather than
   *  silently empty). */
  error?: string;
}

const SYSTEM_PROMPT = `You are extracting structured data from loan-related documents
(facility agreements, loan notes, drawdown notices, repayment schedules,
lender statements, side-letters) so an auditor can build a loan
calculator workpaper.

CRITICAL RULES:
- Output ONLY valid JSON: { "loans": [...], "unmappedNotes": "..." }.
  No prose, no markdown, no commentary outside the JSON.
- DO NOT fabricate values. If the document doesn't say something, omit
  it (or use null). Better to return an empty object than to guess.
- If the source describes multiple loan agreements, emit one entry per
  loan. Otherwise, one entry.
- For amounts, return raw numbers (no currency symbols, no thousands
  separators). Currency is implied to be GBP unless the document states
  otherwise — note non-GBP currency in unmappedNotes.
- Dates as ISO YYYY-MM-DD.
- For each loan emit:
  {
    "header": {
      "lender": "<as named in the document>",
      "amount": <principal / facility>,
      "numberOfTranches": <integer>,
      "drawdownRequirements": "<conditions precedent to drawdown>",
      "interestBase": "<SONIA | Bank base rate | Fixed | SOFR | etc.>",
      "interestMargin": <% above base, e.g. 2.5>,
      "dayCountBasis": "Actual/365" | "Actual/360" | "30/360",
      "loanDate": "<YYYY-MM-DD agreement date>",
      "drawdownDate": "<YYYY-MM-DD first drawdown>",
      "fees": <total arrangement / commitment fees>,
      "loanPeriodicity": "Monthly" | "Quarterly" | "Semi-annual" | "Annual",
      "maturityDate": "<YYYY-MM-DD final repayment>",
      "securityHeld": <true|false|null>,
      "securityDescription": "<plain English if security held>"
    },
    "schedule": [
      { "fromDate": "<ISO>", "toDate": "<ISO>",
        "bf": 0, "drawdown": 0, "lenderFees": 0, "otherFees": 0,
        "interestCharged": 0, "payments": 0, "cf": 0 }
      // one row per loan period if the document includes a schedule.
      // OMIT entirely if the document has no schedule — do NOT invent rows.
    ],
    "covenants": [
      { "description": "<e.g. Net Debt:EBITDA must not exceed 3.0x>",
        "threshold": "<the exact wording>",
        "testFrequency": "<Quarterly | Annual | ...>" }
    ],
    "penalties": [
      { "description": "<e.g. Default rate +2% over margin>",
        "amount": <number or null>,
        "trigger": "<event that triggers the penalty>" }
    ]
  }
- Anything observed but not fitting these slots goes in the
  top-level unmappedNotes string.`;

export async function aiExtractLoan(input: ExtractInput): Promise<ExtractResult> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    return { loans: [], rawAiResponse: '', model: 'no-key', error: 'TOGETHER_API_KEY not set' };
  }

  const periodLine = input.periodStartIso && input.periodEndIso
    ? `Engagement audit period: ${input.periodStartIso} to ${input.periodEndIso}.`
    : '';
  const sideLine = input.side === 'receivable'
    ? 'Perspective: the client is the LENDER (loan receivable / loan asset).'
    : 'Perspective: the client is the BORROWER (loan payable / liability).';

  const userMessage = [
    periodLine,
    sideLine,
    '',
    'Source documents (plain text concatenated):',
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
      return { loans: [], rawAiResponse: txt, model, error: `LLM HTTP ${res.status}` };
    }
    const body = await res.json();
    const raw = body?.choices?.[0]?.message?.content || '';
    let parsed: unknown;
    try {
      // Strip code fences if present.
      const trimmed = String(raw).trim().replace(/^```(?:json)?\n?|\n?```$/g, '');
      parsed = JSON.parse(trimmed);
    } catch {
      return { loans: [], rawAiResponse: raw, model, error: 'LLM returned non-JSON' };
    }
    const loans = Array.isArray((parsed as any)?.loans) ? (parsed as any).loans : [];
    const unmapped = String((parsed as any)?.unmappedNotes || '');
    const cleaned: ExtractedLoan[] = loans.map((l: any) => ({
      header: cleanHeader(l?.header),
      schedule: Array.isArray(l?.schedule) ? l.schedule.map(cleanSchedRow).filter(Boolean) as LoanScheduleRow[] : [],
      covenants: Array.isArray(l?.covenants) ? l.covenants.filter((c: any) => c && c.description) : [],
      penalties: Array.isArray(l?.penalties) ? l.penalties.filter((p: any) => p && p.description) : [],
      unmappedNotes: unmapped,
    }));
    return { loans: cleaned, rawAiResponse: raw, model };
  } catch (e: any) {
    return { loans: [], model, error: String(e?.message || e) };
  }
}

function cleanHeader(h: any): Partial<LoanHeader> {
  if (!h || typeof h !== 'object') return {};
  const out: Partial<LoanHeader> = {};
  if (typeof h.lender === 'string') out.lender = h.lender;
  if (typeof h.amount === 'number') out.amount = h.amount;
  if (typeof h.numberOfTranches === 'number') out.numberOfTranches = h.numberOfTranches;
  if (typeof h.drawdownRequirements === 'string') out.drawdownRequirements = h.drawdownRequirements;
  if (typeof h.interestBase === 'string') out.interestBase = h.interestBase;
  if (typeof h.interestMargin === 'number') out.interestMargin = h.interestMargin;
  if (typeof h.dayCountBasis === 'string') {
    const dc = h.dayCountBasis as DayCount;
    if (dc === 'Actual/365' || dc === 'Actual/360' || dc === '30/360') out.dayCountBasis = dc;
  }
  if (typeof h.loanDate === 'string') out.loanDate = h.loanDate;
  if (typeof h.drawdownDate === 'string') out.drawdownDate = h.drawdownDate;
  if (typeof h.fees === 'number') out.fees = h.fees;
  if (typeof h.loanPeriodicity === 'string') {
    const p = h.loanPeriodicity as Periodicity;
    if (p === 'Monthly' || p === 'Quarterly' || p === 'Semi-annual' || p === 'Annual') out.loanPeriodicity = p;
  }
  if (typeof h.maturityDate === 'string') out.maturityDate = h.maturityDate;
  if (typeof h.securityHeld === 'boolean') out.securityHeld = h.securityHeld;
  if (typeof h.securityDescription === 'string') out.securityDescription = h.securityDescription;
  return out;
}

function cleanSchedRow(r: any): LoanScheduleRow | null {
  if (!r || typeof r !== 'object') return null;
  if (typeof r.fromDate !== 'string' || typeof r.toDate !== 'string') return null;
  return {
    fromDate: r.fromDate,
    toDate: r.toDate,
    bf: numOrZero(r.bf),
    drawdown: numOrZero(r.drawdown),
    lenderFees: numOrZero(r.lenderFees),
    otherFees: numOrZero(r.otherFees),
    interestCharged: numOrZero(r.interestCharged),
    payments: numOrZero(r.payments),
    cf: numOrZero(r.cf),
  };
}

function numOrZero(v: unknown): number {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[,£$€\s]/g, ''));
    return isFinite(n) ? n : 0;
  }
  return 0;
}
