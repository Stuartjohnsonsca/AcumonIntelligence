import OpenAI from 'openai';

// Lazy-initialised client — reads the current env var on each call.
// This supports the worker's per-job key rotation (process.env is updated at runtime).
let _client: OpenAI | null = null;
let _clientKey: string | undefined;

function getClient(): OpenAI {
  const key = process.env.TOGETHER_DOC_SUMMARY_KEY || process.env.TOGETHER_API_KEY;
  if (!key) throw new Error('No Together AI key: set TOGETHER_DOC_SUMMARY_KEY or TOGETHER_API_KEY');
  // Re-create client if the key changed (multi-key rotation)
  if (!_client || _clientKey !== key) {
    _client = new OpenAI({ apiKey: key, baseURL: 'https://api.together.xyz/v1' });
    _clientKey = key;
  }
  return _client;
}

const PRIMARY_MODEL = 'Qwen/Qwen3.5-397B-A17B';
const FALLBACK_MODEL = 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8';

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 30000;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DocSummaryFinding {
  area: string;
  finding: string;
  clauseReference: string;
  isSignificantRisk: boolean;
  accountingImpact?: string;
  auditImpact?: string;
}

export interface DocSummaryUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface DocSummaryKeyTerm {
  term: string;
  value: string;
  clauseReference: string;
}

export interface DocSummaryMissingItem {
  item: string;
  reason: string;
}

export interface DocSummaryResult {
  findings: DocSummaryFinding[];
  summary: string;
  documentDescription: string;
  keyTerms: DocSummaryKeyTerm[];
  missingInformation: DocSummaryMissingItem[];
  usage: DocSummaryUsage;
  model: string;
}

// ─── Pricing ────────────────────────────────────────────────────────────────

const DOC_SUMMARY_PRICING: Record<string, { inputPerToken: number; outputPerToken: number }> = {
  [PRIMARY_MODEL]: { inputPerToken: 0.60 / 1_000_000, outputPerToken: 3.60 / 1_000_000 },
  [FALLBACK_MODEL]: { inputPerToken: 0.27 / 1_000_000, outputPerToken: 0.85 / 1_000_000 },
};

const DEFAULT_PRICING = { inputPerToken: 0.60 / 1_000_000, outputPerToken: 3.60 / 1_000_000 };

export function calculateDocSummaryCost(
  usage: { promptTokens: number; completionTokens: number },
  model: string,
): number {
  const pricing = DOC_SUMMARY_PRICING[model] || DEFAULT_PRICING;
  return (usage.promptTokens * pricing.inputPerToken) + (usage.completionTokens * pricing.outputPerToken);
}

// ─── Retry logic (mirrors ai-extractor.ts) ──────────────────────────────────

function isTransientError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes('429') || msg.includes('rate') || msg.includes('quota')
      || msg.includes('500') || msg.includes('503') || msg.includes('unavailable')
      || msg.includes('resource exhausted') || msg.includes('timeout')
      || msg.includes('econnreset') || msg.includes('fetch failed');
  }
  return false;
}

function parseRetryDelay(errorMessage: string): number | null {
  const match = errorMessage.match(/retry\s+(?:in\s+)?(\d+(?:\.\d+)?)\s*s/i);
  if (match) return Math.ceil(parseFloat(match[1]) * 1000);
  const msMatch = errorMessage.match(/retry\s+(?:in\s+)?(\d+)\s*ms/i);
  if (msMatch) return parseInt(msMatch[1], 10);
  return null;
}

function addJitter(delayMs: number): number {
  const jitter = delayMs * (Math.random() * 0.25);
  return Math.round(delayMs + jitter);
}

async function retryWithBackoff<T>(fn: () => Promise<T>, context: string): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (!isTransientError(err) && attempt === 0) {
        throw new Error(`[${context}] Non-transient error: ${lastError.message}`);
      }
      if (attempt < MAX_RETRIES - 1) {
        const serverDelay = parseRetryDelay(lastError.message);
        const exponentialDelay = BASE_BACKOFF_MS * Math.pow(2, attempt);
        const rawDelay = serverDelay ?? exponentialDelay;
        const clampedDelay = Math.min(Math.max(rawDelay, BASE_BACKOFF_MS), MAX_BACKOFF_MS);
        const finalDelay = addJitter(clampedDelay);

        console.warn(
          `[${context}] Attempt ${attempt + 1} failed: ${lastError.message}. ` +
          `Retrying in ${finalDelay}ms (server hint: ${serverDelay ?? 'none'})...`,
        );
        await new Promise(r => setTimeout(r, finalDelay));
      }
    }
  }
  throw new Error(`[${context}] Failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

function isModelUnavailableError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (msg.includes('404') && (msg.includes('model') || msg.includes('unable to access')))
      || msg.includes('model not found')
      || msg.includes('does not exist');
  }
  return false;
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

function buildAuditAnalysisPrompt(fileName: string, clientName: string, accountingFramework: string = 'FRS 102', perspective?: string): string {
  const perspectiveParty = perspective || clientName;
  return `You are a senior audit professional analysing a legal or commercial document for audit purposes. The document belongs to the client "${clientName}". You MUST analyse this document from the perspective of "${perspectiveParty}". The applicable accounting framework is ${accountingFramework}.

CRITICAL — PERSPECTIVE: All analysis, risk assessment, accounting impact, and audit impact MUST be from the perspective of "${perspectiveParty}". When identifying obligations, risks, and financial impacts, evaluate what they mean for "${perspectiveParty}" specifically — not for the counterparty or any other party to the document.

Analyse this document thoroughly for the following MINIMUM areas:
1. **Parties** — Identify all parties to the document and their roles
2. **Date** — Key dates including execution date, effective date, and any renewal dates
3. **Signatories** — Who signed the document and in what capacity
4. **Obligations on each party** — What each party is required to do
5. **Risks for each party** — Potential risks or exposures for each party
6. **Key Deliverables** — What must be delivered, by whom, and when
7. **Default/Termination conditions** — Circumstances under which the agreement can be terminated or a party is in default
8. **Future obligations** — Ongoing or future commitments
9. **Future rights** — Rights that parties gain in the future (e.g. options, renewals)
10. **Key performance obligations** — Performance obligations relevant to revenue recognition (IFRS 15 / ASC 606)
11. **Onerous contract provisions** — Any terms that may create an onerous contract (IAS 37)

ADDITIONALLY, use your professional judgement to identify ANY other material matters relevant to an audit that are not covered by the categories above. This may include (but is not limited to): related party relationships, contingent liabilities, going concern indicators, regulatory compliance issues, unusual or non-standard clauses, guarantees, indemnities, change of control provisions, intellectual property matters, or any other items an auditor should be aware of.

CRITICAL RULES:
- Every finding MUST cite a specific clause, section, paragraph, or page reference from the document. If there is no clear clause number, reference the relevant paragraph or page.
- Be EVIDENCE-BASED only. Do not fabricate or assume content that is not in the document.
- If a minimum area has no relevant content in the document, still include it with a finding stating it is not addressed.
- Each finding must be a complete, properly formed summary. NEVER truncate findings with '...' or leave them incomplete. If a clause is lengthy, summarise it concisely but completely.

SIGNIFICANT RISK ASSESSMENT (isSignificantRisk: true):
You MUST assess significant risk from the perspective of an auditor evaluating the risk of material misstatement of financial statements. Flag as significant risk ANY finding that:
- Creates an **uncertain or unquantified financial obligation** (e.g. dilapidations, make-good provisions, repair obligations on lease termination, decommissioning costs)
- Could require a **provision, contingent liability, or disclosure** under IAS 37/IAS 16/IFRS 16
- Involves **onerous contract indicators** — where unavoidable costs exceed expected economic benefits
- Affects **revenue recognition** timing or measurement (IFRS 15 performance obligations)
- Creates **lease liability or right-of-use asset implications** under IFRS 16 (rent reviews, break clauses, extension options, variable lease payments)
- Involves **guarantees, indemnities, or personal covenants** that could create unrecognised liabilities
- Involves **penalty clauses, liquidated damages, or default consequences** with material financial impact
- Creates **commitments not yet recognised** in financial statements (capital commitments, purchase obligations)
- Could affect **going concern** assessment or entity viability
- Involves **related party transactions** or non-arm's length terms
- Contains **unusual, non-standard, or one-sided terms** that could disadvantage one party materially
- Requires **management judgement or estimation** that could be materially misstated
- Has **vacant possession, surrender, or reinstatement obligations** — these are almost always significant risks as the cost is uncertain and potentially material
When in doubt about whether something is a significant risk, ERR ON THE SIDE OF FLAGGING IT. Auditors prefer to assess and dismiss a flagged risk rather than miss one entirely.

ACCOUNTING IMPACT ASSESSMENT (accountingImpact):
For EACH finding, assess the accounting impact under ${accountingFramework} ONLY from the perspective of "${perspectiveParty}". Do NOT assess the accounting treatment of any counterparty, landlord, customer, supplier, or other party — only "${perspectiveParty}"'s own accounting treatment matters. Reference the relevant clause from the document AND specific sections/paragraphs of ${accountingFramework} where applicable. If a finding has no accounting impact for "${perspectiveParty}", set accountingImpact to "None".

AUDIT IMPACT ASSESSMENT (auditImpact):
For EACH finding, assess the audit impact — what should the auditor do in response to this finding? Reference the relevant clause from the document. If a finding has no audit implications, set auditImpact to "None".

KEY COMMERCIAL TERMS EXTRACTION (keyTerms):
After completing your analysis, extract ALL key commercial terms from the document. Consider what information a reader would expect to find for this type of document. For example:
- For a lease: annual rent, rent review dates, lease start date, lease end/expiry date, break clause dates, deposit amount, service charge, permitted use, repair obligations, insurance requirements
- For a loan: principal amount, interest rate, repayment schedule, maturity date, security/collateral, covenants, default triggers
- For a service agreement: contract value/fees, payment terms, service commencement date, term/duration, renewal terms, notice period, SLA commitments
- For a sale/purchase agreement: purchase price, completion date, deposit, conditions precedent, warranties period, indemnity caps, retention amounts
- For employment: salary, bonus/commission, start date, notice period, restrictive covenants duration, pension contributions, benefits
Extract the actual values found in the document. Each term must cite the specific clause reference where it appears.

MISSING INFORMATION ASSESSMENT (missingInformation):
After extracting key terms, consider what information would NORMALLY be expected in this type of document but is MISSING or NOT SPECIFIED. For each missing item, explain why it would typically be expected and why its absence matters. For example:
- A lease with no rent review mechanism — "Rent review mechanism: typically included to protect the landlord against inflation and to establish market rent at intervals"
- A loan with no stated maturity date — "Maturity/repayment date: essential for determining the classification of the liability as current or non-current"
- A contract with no termination clause — "Termination provisions: needed to understand exit options and potential penalties"
Only include genuinely missing items that would be expected for this document type. Do NOT list items that are present in the document.

File name: ${fileName}

Return ONLY valid JSON with this exact structure:
{
  "findings": [
    {
      "area": "string — the analysis area (e.g. 'Parties', 'Risks for each party', or your own identified area)",
      "finding": "string — detailed description of the finding",
      "clauseReference": "string — specific clause/section/paragraph reference",
      "isSignificantRisk": false,
      "accountingImpact": "string — accounting impact under ${accountingFramework} from the client's perspective only, or 'None'",
      "auditImpact": "string — recommended audit procedures and considerations, or 'None'"
    }
  ],
  "keyTerms": [
    {
      "term": "string — name of the commercial term (e.g. 'Annual Rent', 'Effective Date', 'Contract Value')",
      "value": "string — the actual value extracted from the document (e.g. '£50,000 per annum', '1 January 2025', '36 months')",
      "clauseReference": "string — clause/section reference where this term is found"
    }
  ],
  "missingInformation": [
    {
      "item": "string — what is missing (e.g. 'Rent Review Mechanism', 'Termination Notice Period')",
      "reason": "string — why this would typically be expected in this type of document and why its absence is noteworthy"
    }
  ],
  "documentDescription": "string — one or two paragraphs describing what this document is (e.g. 'This is a commercial lease agreement between X and Y for premises at Z, commencing on [date] for a term of [n] years at an annual rent of £[amount].'). This helps the reader understand the type and nature of the contract before reviewing findings.",
  "summary": "string — a concise executive summary of the key audit implications (2-4 sentences, separate from the document description)"
}`;
}

// ─── Main analysis function ─────────────────────────────────────────────────

export async function analyseDocumentForAudit(
  text: string,
  fileName: string,
  clientName: string,
  accountingFramework: string = 'FRS 102',
  perspective?: string,
): Promise<DocSummaryResult> {
  const prompt = buildAuditAnalysisPrompt(fileName, clientName, accountingFramework, perspective);
  const models = [PRIMARY_MODEL, FALLBACK_MODEL];
  let result: OpenAI.Chat.Completions.ChatCompletion | null = null;
  let usedModel = models[0];
  const errors: string[] = [];

  for (const modelId of models) {
    usedModel = modelId;
    try {
      result = await retryWithBackoff(
        () => getClient().chat.completions.create({
          model: modelId,
          messages: [
            { role: 'user', content: `${prompt}\n\n--- DOCUMENT TEXT ---\n\n${text}` },
          ],
          max_tokens: 16384,
        }),
        `doc-summary:${fileName}`,
      );
      console.log(`[DocSummary:AI] Success | file=${fileName} | model=${modelId}`);
      break;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`${modelId}: ${errMsg}`);
      console.warn(`[DocSummary:AI] Model ${modelId} failed for ${fileName}: ${errMsg}`);

      if (isModelUnavailableError(err)) {
        continue;
      }
      if (err instanceof Error && err.message.includes('400')) {
        continue;
      }
      throw err;
    }
  }

  if (!result) {
    const errorDetail = errors.join(' | ');
    throw new Error(`[doc-summary:${fileName}] All models failed. ${errorDetail}`);
  }

  const usage: DocSummaryUsage = {
    promptTokens: result.usage?.prompt_tokens ?? 0,
    completionTokens: result.usage?.completion_tokens ?? 0,
    totalTokens: result.usage?.total_tokens ?? 0,
  };

  const responseText = result.choices[0]?.message?.content || '';

  // Robust JSON parsing — handle markdown code fences
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/) || responseText.match(/(\{[\s\S]*\})/);
  const jsonText = jsonMatch ? jsonMatch[1] : responseText;

  try {
    const parsed = JSON.parse(jsonText.trim());
    const findings: DocSummaryFinding[] = Array.isArray(parsed.findings)
      ? parsed.findings.map((f: Record<string, unknown>) => ({
          area: String(f.area || 'Unknown'),
          finding: String(f.finding || ''),
          clauseReference: String(f.clauseReference || 'Not specified'),
          isSignificantRisk: Boolean(f.isSignificantRisk),
          accountingImpact: String(f.accountingImpact || ''),
          auditImpact: String(f.auditImpact || ''),
        }))
      : [];

    const keyTerms: DocSummaryKeyTerm[] = Array.isArray(parsed.keyTerms)
      ? parsed.keyTerms.map((t: Record<string, unknown>) => ({
          term: String(t.term || ''),
          value: String(t.value || ''),
          clauseReference: String(t.clauseReference || ''),
        }))
      : [];

    const missingInformation: DocSummaryMissingItem[] = Array.isArray(parsed.missingInformation)
      ? parsed.missingInformation.map((m: Record<string, unknown>) => ({
          item: String(m.item || ''),
          reason: String(m.reason || ''),
        }))
      : [];

    console.log(
      `[DocSummary:AI] Parsed | file=${fileName} | findings=${findings.length} | ` +
      `keyTerms=${keyTerms.length} | missing=${missingInformation.length} | ` +
      `risks=${findings.filter(f => f.isSignificantRisk).length} | model=${usedModel}`,
    );

    return {
      findings,
      keyTerms,
      missingInformation,
      summary: String(parsed.summary || ''),
      documentDescription: String(parsed.documentDescription || ''),
      usage,
      model: usedModel,
    };
  } catch (parseError) {
    const snippet = responseText.substring(0, 200).replace(/\n/g, '\\n');
    console.error(
      `[DocSummary:AI] JSON parse failed | file=${fileName} | model=${usedModel} | ` +
      `error=${parseError instanceof Error ? parseError.message : 'Unknown'} | responseSnippet="${snippet}"`,
    );
    throw new Error(`[doc-summary:${fileName}] Failed to parse AI response as JSON`);
  }
}

// ─── Vision-based analysis for scanned/image PDFs ────────────────────────────

const VISION_MODEL = 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8';

export type BatchProgressCallback = (batchesDone: number, batchesTotal: number, pagesDone: number, pagesTotal: number) => void;

export async function analyseDocumentFromImage(
  imageDataUris: string[],
  fileName: string,
  clientName: string,
  onBatchProgress?: BatchProgressCallback,
  accountingFramework: string = 'FRS 102',
  perspective?: string,
): Promise<DocSummaryResult> {
  const BATCH_SIZE = 5;
  const allFindings: DocSummaryFinding[] = [];
  const allKeyTerms: DocSummaryKeyTerm[] = [];
  const allMissingInfo: DocSummaryMissingItem[] = [];
  const summaries: string[] = [];
  const descriptions: string[] = [];
  const totalUsage: DocSummaryUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  // Process pages in batches to avoid request size limits
  for (let i = 0; i < imageDataUris.length; i += BATCH_SIZE) {
    const batch = imageDataUris.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(imageDataUris.length / BATCH_SIZE);
    const pageRange = `pages ${i + 1}-${Math.min(i + BATCH_SIZE, imageDataUris.length)}`;

    console.log(`[DocSummary:Vision] Processing batch ${batchNum}/${totalBatches} (${pageRange}) | file=${fileName}`);

    const prompt = buildAuditAnalysisPrompt(fileName, clientName, accountingFramework, perspective)
      + `\n\nNote: You are analysing ${pageRange} of ${imageDataUris.length} total pages. Extract all findings from these pages.`;

    const contentParts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: 'text', text: prompt },
      ...batch.map((uri): OpenAI.Chat.Completions.ChatCompletionContentPart => ({
        type: 'image_url',
        image_url: { url: uri },
      })),
    ];

    const result = await retryWithBackoff(
      () => getClient().chat.completions.create({
        model: VISION_MODEL,
        messages: [{ role: 'user', content: contentParts }],
        max_tokens: 16384,
      }),
      `doc-summary-vision:${fileName}:batch${batchNum}`,
    );

    totalUsage.promptTokens += result.usage?.prompt_tokens ?? 0;
    totalUsage.completionTokens += result.usage?.completion_tokens ?? 0;
    totalUsage.totalTokens += result.usage?.total_tokens ?? 0;

    // Report progress
    if (onBatchProgress) {
      onBatchProgress(batchNum, totalBatches, Math.min(i + BATCH_SIZE, imageDataUris.length), imageDataUris.length);
    }

    const responseText = result.choices[0]?.message?.content || '';
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/) || responseText.match(/(\{[\s\S]*\})/);
    const jsonText = jsonMatch ? jsonMatch[1] : responseText;

    try {
      const parsed = JSON.parse(jsonText.trim());
      if (Array.isArray(parsed.findings)) {
        for (const f of parsed.findings) {
          allFindings.push({
            area: String(f.area || 'Unknown'),
            finding: String(f.finding || ''),
            clauseReference: String(f.clauseReference || 'Not specified'),
            isSignificantRisk: Boolean(f.isSignificantRisk),
            accountingImpact: String(f.accountingImpact || ''),
            auditImpact: String(f.auditImpact || ''),
          });
        }
      }
      if (Array.isArray(parsed.keyTerms)) {
        for (const t of parsed.keyTerms) {
          allKeyTerms.push({
            term: String(t.term || ''),
            value: String(t.value || ''),
            clauseReference: String(t.clauseReference || ''),
          });
        }
      }
      if (Array.isArray(parsed.missingInformation)) {
        for (const m of parsed.missingInformation) {
          allMissingInfo.push({
            item: String(m.item || ''),
            reason: String(m.reason || ''),
          });
        }
      }
      if (parsed.summary) summaries.push(String(parsed.summary));
      if (parsed.documentDescription) descriptions.push(String(parsed.documentDescription));
    } catch {
      console.error(`[DocSummary:Vision] JSON parse failed batch ${batchNum} | file=${fileName} | snippet="${responseText.substring(0, 200)}"`);
      // Continue with other batches rather than failing entirely
    }
  }

  console.log(`[DocSummary:Vision] Complete | file=${fileName} | ${allFindings.length} findings from ${Math.ceil(imageDataUris.length / BATCH_SIZE)} batches`);

  // Deduplicate findings by area+finding content (batches may have overlap)
  const seen = new Set<string>();
  const uniqueFindings = allFindings.filter(f => {
    const key = `${f.area}::${f.finding.substring(0, 100)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Deduplicate key terms by term name
  const seenTerms = new Set<string>();
  const uniqueKeyTerms = allKeyTerms.filter(t => {
    const key = t.term.toLowerCase();
    if (seenTerms.has(key)) return false;
    seenTerms.add(key);
    return true;
  });

  // Deduplicate missing info by item name
  const seenMissing = new Set<string>();
  const uniqueMissing = allMissingInfo.filter(m => {
    const key = m.item.toLowerCase();
    if (seenMissing.has(key)) return false;
    seenMissing.add(key);
    return true;
  });

  const combinedSummary = summaries.join(' ').trim();
  const combinedDescription = descriptions.join(' ').trim();
  return { findings: uniqueFindings, keyTerms: uniqueKeyTerms, missingInformation: uniqueMissing, summary: combinedSummary, documentDescription: combinedDescription, usage: totalUsage, model: VISION_MODEL };
}

// ─── Document Q&A — answer questions grounded in document text ────────────

const QA_SYSTEM_PROMPT = `You are a professional document analyst. You answer questions ONLY using information found in the provided document. You must follow these rules strictly:

1. Answer ONLY from the document content provided. Do NOT use any external or prior knowledge.
2. If the answer is not in the document, state explicitly: "This information is not contained in the document."
3. Cite specific clause, section, paragraph, or page references where possible.
4. If you are uncertain about the answer, say so clearly rather than guessing.
5. Be concise, accurate, and professional in your responses.
6. If the question is ambiguous, explain what you found that may be relevant and ask for clarification.`;

const CHUNK_SIZE = 25000; // characters per chunk

function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start + CHUNK_SIZE;
    // Try to break at a paragraph or sentence boundary
    if (end < text.length) {
      const lastPara = text.lastIndexOf('\n\n', end);
      if (lastPara > start + CHUNK_SIZE * 0.7) end = lastPara;
      else {
        const lastSentence = text.lastIndexOf('. ', end);
        if (lastSentence > start + CHUNK_SIZE * 0.7) end = lastSentence + 1;
      }
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

export interface QAConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function askDocumentQuestion(
  documentText: string,
  question: string,
  fileName: string,
  conversationHistory: QAConversationMessage[] = [],
): Promise<{ answer: string; usage: DocSummaryUsage; model: string }> {
  const chunks = chunkText(documentText);
  const totalUsage: DocSummaryUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  const models = [PRIMARY_MODEL, FALLBACK_MODEL];

  // Build conversation context from history (last 10 turns max to fit context)
  const recentHistory = conversationHistory.slice(-10);

  if (chunks.length === 1) {
    // Single chunk — direct Q&A
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: QA_SYSTEM_PROMPT },
      { role: 'user', content: `Document: "${fileName}"\n\n--- DOCUMENT TEXT ---\n${chunks[0]}\n--- END DOCUMENT ---` },
    ];
    // Add conversation history
    for (const msg of recentHistory) {
      messages.push({ role: msg.role, content: msg.content });
    }
    // Add the new question
    messages.push({ role: 'user', content: question });

    let result: OpenAI.Chat.Completions.ChatCompletion | null = null;
    let usedModel = models[0];

    for (const modelId of models) {
      usedModel = modelId;
      try {
        result = await retryWithBackoff(
          () => getClient().chat.completions.create({
            model: modelId,
            messages,
            max_tokens: 4096,
          }),
          `doc-qa:${fileName}`,
        );
        break;
      } catch (err) {
        if (isModelUnavailableError(err)) continue;
        throw err;
      }
    }

    if (!result) throw new Error(`[doc-qa:${fileName}] All models failed`);

    totalUsage.promptTokens = result.usage?.prompt_tokens ?? 0;
    totalUsage.completionTokens = result.usage?.completion_tokens ?? 0;
    totalUsage.totalTokens = result.usage?.total_tokens ?? 0;

    const answer = result.choices[0]?.message?.content?.trim() || 'Unable to generate a response.';
    console.log(`[DocSummary:QA] Single-chunk | file=${fileName} | model=${usedModel} | tokens=${totalUsage.totalTokens}`);
    return { answer, usage: totalUsage, model: usedModel };
  }

  // Multi-chunk — process each chunk then synthesise
  console.log(`[DocSummary:QA] Multi-chunk (${chunks.length} chunks) | file=${fileName}`);
  const partialAnswers: string[] = [];
  let usedModel = models[0];

  for (let i = 0; i < chunks.length; i++) {
    const chunkLabel = `[Part ${i + 1}/${chunks.length}]`;
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: QA_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Document: "${fileName}" ${chunkLabel}\n\n--- DOCUMENT TEXT (section ${i + 1} of ${chunks.length}) ---\n${chunks[i]}\n--- END SECTION ---`,
      },
    ];
    // Include recent history for context
    for (const msg of recentHistory) {
      messages.push({ role: msg.role, content: msg.content });
    }
    messages.push({
      role: 'user',
      content: `${question}\n\nNote: You are reading section ${i + 1} of ${chunks.length} of the document. Answer based on what you find in THIS section. If this section does not contain relevant information, say "No relevant information in this section."`,
    });

    let result: OpenAI.Chat.Completions.ChatCompletion | null = null;
    for (const modelId of models) {
      usedModel = modelId;
      try {
        result = await retryWithBackoff(
          () => getClient().chat.completions.create({
            model: modelId,
            messages,
            max_tokens: 2048,
          }),
          `doc-qa:${fileName}:chunk${i + 1}`,
        );
        break;
      } catch (err) {
        if (isModelUnavailableError(err)) continue;
        throw err;
      }
    }

    if (result) {
      totalUsage.promptTokens += result.usage?.prompt_tokens ?? 0;
      totalUsage.completionTokens += result.usage?.completion_tokens ?? 0;
      totalUsage.totalTokens += result.usage?.total_tokens ?? 0;
      const partial = result.choices[0]?.message?.content?.trim() || '';
      if (partial && !partial.toLowerCase().includes('no relevant information in this section')) {
        partialAnswers.push(`${chunkLabel} ${partial}`);
      }
    }
  }

  if (partialAnswers.length === 0) {
    return {
      answer: 'This information is not contained in the document.',
      usage: totalUsage,
      model: usedModel,
    };
  }

  // Synthesise partial answers into a coherent response
  const synthMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    {
      role: 'system',
      content: 'You are a professional document analyst. Synthesise the following partial answers from different sections of a document into a single, coherent response. Remove any duplicates and cite clause/section references where available.',
    },
    {
      role: 'user',
      content: `Original question: "${question}"\n\nPartial answers from different document sections:\n\n${partialAnswers.join('\n\n')}\n\nPlease synthesise these into one clear, complete answer.`,
    },
  ];

  let synthResult: OpenAI.Chat.Completions.ChatCompletion | null = null;
  for (const modelId of models) {
    usedModel = modelId;
    try {
      synthResult = await retryWithBackoff(
        () => getClient().chat.completions.create({
          model: modelId,
          messages: synthMessages,
          max_tokens: 4096,
        }),
        `doc-qa:${fileName}:synth`,
      );
      break;
    } catch (err) {
      if (isModelUnavailableError(err)) continue;
      throw err;
    }
  }

  if (synthResult) {
    totalUsage.promptTokens += synthResult.usage?.prompt_tokens ?? 0;
    totalUsage.completionTokens += synthResult.usage?.completion_tokens ?? 0;
    totalUsage.totalTokens += synthResult.usage?.total_tokens ?? 0;
  }

  const finalAnswer = synthResult?.choices[0]?.message?.content?.trim()
    || partialAnswers.join('\n\n');

  console.log(`[DocSummary:QA] Multi-chunk complete | file=${fileName} | model=${usedModel} | chunks=${chunks.length} | tokens=${totalUsage.totalTokens}`);
  return { answer: finalAnswer, usage: totalUsage, model: usedModel };
}
