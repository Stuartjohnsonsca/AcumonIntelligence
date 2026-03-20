import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.TOGETHER_DOC_SUMMARY_KEY || process.env.TOGETHER_API_KEY!,
  baseURL: 'https://api.together.xyz/v1',
});

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

export interface DocSummaryResult {
  findings: DocSummaryFinding[];
  summary: string;
  documentDescription: string;
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

function buildAuditAnalysisPrompt(fileName: string, clientName: string, accountingFramework: string = 'FRS 102'): string {
  return `You are a senior audit professional analysing a legal or commercial document for audit purposes. The document belongs to the client "${clientName}". The applicable accounting framework is ${accountingFramework}.

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
For EACH finding, assess the accounting impact under ${accountingFramework} ONLY from the perspective of the client "${clientName}". Do NOT assess the accounting treatment of any counterparty, landlord, customer, supplier, or other party — only the client's own accounting treatment matters. Reference the relevant clause from the document AND specific sections/paragraphs of ${accountingFramework} where applicable. If a finding has no accounting impact for the client, set accountingImpact to "None".

AUDIT IMPACT ASSESSMENT (auditImpact):
For EACH finding, assess the audit impact — what should the auditor do in response to this finding? Reference the relevant clause from the document. If a finding has no audit implications, set auditImpact to "None".

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
): Promise<DocSummaryResult> {
  const prompt = buildAuditAnalysisPrompt(fileName, clientName, accountingFramework);
  const models = [PRIMARY_MODEL, FALLBACK_MODEL];
  let result: OpenAI.Chat.Completions.ChatCompletion | null = null;
  let usedModel = models[0];
  const errors: string[] = [];

  for (const modelId of models) {
    usedModel = modelId;
    try {
      result = await retryWithBackoff(
        () => client.chat.completions.create({
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

    console.log(
      `[DocSummary:AI] Parsed | file=${fileName} | findings=${findings.length} | ` +
      `risks=${findings.filter(f => f.isSignificantRisk).length} | model=${usedModel}`,
    );

    return {
      findings,
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
): Promise<DocSummaryResult> {
  const BATCH_SIZE = 5;
  const allFindings: DocSummaryFinding[] = [];
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

    const prompt = buildAuditAnalysisPrompt(fileName, clientName, accountingFramework)
      + `\n\nNote: You are analysing ${pageRange} of ${imageDataUris.length} total pages. Extract all findings from these pages.`;

    const contentParts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: 'text', text: prompt },
      ...batch.map((uri): OpenAI.Chat.Completions.ChatCompletionContentPart => ({
        type: 'image_url',
        image_url: { url: uri },
      })),
    ];

    const result = await retryWithBackoff(
      () => client.chat.completions.create({
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

  const combinedSummary = summaries.join(' ').trim();
  const combinedDescription = descriptions.join(' ').trim();
  return { findings: uniqueFindings, summary: combinedSummary, documentDescription: combinedDescription, usage: totalUsage, model: VISION_MODEL };
}
