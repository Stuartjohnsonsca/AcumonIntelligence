import OpenAI from 'openai';
import { processPdf, isPdf } from '@/lib/pdf-to-images';

const client = new OpenAI({
  apiKey: process.env.TOGETHER_DOC_SUMMARY_KEY || process.env.TOGETHER_API_KEY || '',
  baseURL: 'https://api.together.xyz/v1',
});

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60000;

// ─── AI Model Selection ──────────────────────────────────────────────────────

export interface ModelPriorities {
  accuracy: number;  // 1 = highest priority, 4 = lowest
  speed: number;
  cost: number;
  depth: number;
}

interface ModelProfile {
  id: string;
  speed: number;     // 1-5, 5=fastest
  accuracy: number;  // 1-5, 5=best
  depth: number;     // 1-5, 5=deepest
  cost: number;      // 1-5, 5=cheapest
  vision: boolean;
}

const MODEL_REGISTRY: ModelProfile[] = [
  { id: 'google/gemma-3n-E4B-it',                                speed: 5, accuracy: 2, depth: 1, cost: 5, vision: true },
  { id: 'Qwen/Qwen3-VL-8B-Instruct',                            speed: 4, accuracy: 3, depth: 2, cost: 4, vision: true },
  { id: 'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo',     speed: 3, accuracy: 4, depth: 3, cost: 3, vision: true },
  { id: 'moonshotai/Kimi-K2.5',                                  speed: 2, accuracy: 4, depth: 4, cost: 2, vision: true },
  { id: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',                                speed: 1, accuracy: 5, depth: 5, cost: 1, vision: true },
];

// Per-operation default priorities (1=highest, 4=lowest)
export const EXTRACTION_PRIORITIES: ModelPriorities = { accuracy: 1, speed: 2, cost: 3, depth: 4 };
export const CATEGORISATION_PRIORITIES: ModelPriorities = { speed: 1, cost: 2, accuracy: 3, depth: 4 };

// Track models that returned 404/unavailable during this process lifetime
const unavailableModels = new Set<string>();

function scoreModel(model: ModelProfile, priorities: ModelPriorities): number {
  // Weight = (5 - priority_rank), so priority 1 gets weight 4, priority 4 gets weight 1
  return (
    model.accuracy * (5 - priorities.accuracy) +
    model.speed * (5 - priorities.speed) +
    model.cost * (5 - priorities.cost) +
    model.depth * (5 - priorities.depth)
  );
}

/**
 * Select the best model for a given set of priorities.
 * Skips models that have returned 404/unavailable errors.
 * Returns a ranked list (best first) for fallback support.
 */
export function selectModels(priorities: ModelPriorities, requireVision = true): string[] {
  const envOverride = process.env.AI_MODEL;
  const candidates = MODEL_REGISTRY
    .filter(m => (!requireVision || m.vision) && !unavailableModels.has(m.id))
    .sort((a, b) => scoreModel(b, priorities) - scoreModel(a, priorities))
    .map(m => m.id);

  // Only use env override if it looks like a valid model ID (contains /)
  if (envOverride && envOverride.includes('/') && !unavailableModels.has(envOverride)) {
    return [envOverride, ...candidates.filter(id => id !== envOverride)];
  }
  if (envOverride && !envOverride.includes('/')) {
    console.warn(`[AI] AI_MODEL env var "${envOverride}" doesn't look like a valid model ID (expected format: org/model-name). Ignoring.`);
  }
  return candidates;
}

export function markModelUnavailable(modelId: string): void {
  unavailableModels.add(modelId);
  console.warn(`[AI] Model marked unavailable: ${modelId}. Will use fallback for remaining calls.`);
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

// Legacy export for backward compatibility
export const AI_MODEL = process.env.AI_MODEL || 'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo';

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

export interface LineItem {
  description: string;
  quantity: number | null;
  productId: string | null;
  net: number | null;
  tax: number | null;
  duty: number | null;
}

export interface FieldLocation {
  page: number;
  bbox: [number, number, number, number]; // [y_min, x_min, y_max, x_max] normalized 0-1000
}

export interface ExtractedDocument {
  purchaserName: string | null;
  purchaserTaxId: string | null;
  purchaserCountry: string | null;
  sellerName: string | null;
  sellerTaxId: string | null;
  sellerCountry: string | null;
  documentRef: string | null;
  documentDate: string | null;
  dueDate: string | null;
  netTotal: number | null;
  dutyTotal: number | null;
  taxTotal: number | null;
  grossTotal: number | null;
  lineItems: LineItem[];
  accountCategory: string | null;
  confidence: number; // 0-1
  fieldLocations: Record<string, FieldLocation>;
  pageCount: number;
}

function buildExtractionPrompt(clientName?: string): string {
  const clientContext = clientName
    ? `\nIMPORTANT CONTEXT: These documents belong to the client "${clientName}". This client is the entity whose records are being audited. Use this to correctly determine purchaser vs seller:
- If "${clientName}" (or a close match) appears on the document, determine their role from the document type:
  - On a RECEIVED invoice/bill (from a supplier TO the client): "${clientName}" is the PURCHASER, the supplier is the SELLER
  - On an ISSUED invoice (from the client TO a customer): "${clientName}" is the SELLER, the customer is the PURCHASER
  - On a receipt, bank statement, or statement of account: use the same logic based on who is paying/receiving
- Be CONSISTENT: "${clientName}" should appear in the same role (purchaser or seller) across all documents of the same type in this batch
- If the document does not clearly indicate direction, default to "${clientName}" as the PURCHASER (most common in audit bundles — suppliers sending invoices to the client)\n`
    : '';

  return `You are a financial document extraction specialist. Extract all available financial data from this document AND locate where each field appears on the document.
${clientContext}
Return ONLY valid JSON with this exact structure (use null for missing fields):
{
  "purchaserName": "string or null",
  "purchaserTaxId": "string or null",
  "purchaserCountry": "string or null",
  "sellerName": "string or null",
  "sellerTaxId": "string or null",
  "sellerCountry": "string or null",
  "documentRef": "string or null",
  "documentDate": "YYYY-MM-DD or null",
  "dueDate": "YYYY-MM-DD or null",
  "netTotal": number or null,
  "dutyTotal": number or null,
  "taxTotal": number or null,
  "grossTotal": number or null,
  "lineItems": [
    {
      "description": "string",
      "quantity": number or null,
      "productId": "string or null",
      "net": number or null,
      "tax": number or null,
      "duty": number or null
    }
  ],
  "accountCategory": "best-guess category (e.g. Insurance, Professional Fees, IT Services, Travel, etc.) or null",
  "confidence": 0.0 to 1.0,
  "pageCount": number (total pages in document, minimum 1),
  "fieldLocations": {
    "fieldName": { "page": 1, "bbox": [y_min, x_min, y_max, x_max] }
  }
}

Rules:
- All monetary values should be numbers without currency symbols
- Dates in YYYY-MM-DD format
- If this is not a financial document, return all nulls with confidence 0
- accountCategory should be your best interpretation based on the document content
- purchaserName is the entity RECEIVING goods/services (the buyer). sellerName is the entity PROVIDING goods/services (the vendor/supplier). On a standard invoice, the company at the top issuing the invoice is the SELLER, and the "Bill To" / "Invoice To" entity is the PURCHASER.
- fieldLocations: for EVERY non-null extracted field, provide a bounding box showing where that value appears on the document. Coordinates are normalized 0-1000 (top-left origin). Keys must match field names exactly: purchaserName, purchaserTaxId, purchaserCountry, sellerName, sellerTaxId, sellerCountry, documentRef, documentDate, dueDate, netTotal, dutyTotal, taxTotal, grossTotal. For line items use keys like "lineItems[0].description", "lineItems[0].net", etc.
- pageCount: the total number of pages in this document (1 for single images)`;
}

export interface AiTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
}

const AI_PRICING: Record<string, { inputPerToken: number; outputPerToken: number }> = {
  'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo': { inputPerToken: 0.27 / 1_000_000, outputPerToken: 0.85 / 1_000_000 },
  'Qwen/Qwen3-VL-8B-Instruct': { inputPerToken: 0.18 / 1_000_000, outputPerToken: 0.68 / 1_000_000 },
  'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo': { inputPerToken: 0.60 / 1_000_000, outputPerToken: 3.60 / 1_000_000 },
  'moonshotai/Kimi-K2.5': { inputPerToken: 0.50 / 1_000_000, outputPerToken: 2.80 / 1_000_000 },
  'google/gemma-3n-E4B-it': { inputPerToken: 0.02 / 1_000_000, outputPerToken: 0.04 / 1_000_000 },
};

const DEFAULT_PRICING = { inputPerToken: 0.27 / 1_000_000, outputPerToken: 0.85 / 1_000_000 };

export function calculateCostUsd(usage: AiTokenUsage): number {
  const pricing = AI_PRICING[usage.model] || DEFAULT_PRICING;
  return (usage.promptTokens * pricing.inputPerToken) + (usage.completionTokens * pricing.outputPerToken);
}

function extractUsageMetadata(response: OpenAI.Chat.Completions.ChatCompletion): AiTokenUsage {
  return {
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0,
    model: response.model || AI_MODEL,
  };
}

export interface ExtractionResult {
  document: ExtractedDocument;
  usage: AiTokenUsage;
}

export async function extractDocumentFromBase64(
  base64Data: string,
  mimeType: string,
  fileName: string,
  clientName?: string,
): Promise<ExtractionResult> {
  const prompt = buildExtractionPrompt(clientName);

  // Build message content based on file type
  type ContentPart = { type: 'image_url'; image_url: { url: string } } | { type: 'text'; text: string };
  let contentParts: ContentPart[];
  let inputMode = 'image';

  if (isPdf(mimeType)) {
    const pdfBuffer = Buffer.from(base64Data, 'base64');
    const pdfContent = await processPdf(pdfBuffer, 10);

    if (pdfContent.mode === 'text' && pdfContent.text) {
      // Send extracted text (no vision needed — works with all models)
      inputMode = 'pdf-text';
      contentParts = [
        { type: 'text', text: `File name: ${fileName}\n\nDocument text content (extracted from PDF, ${pdfContent.pageCount} pages):\n\n${pdfContent.text}\n\n${prompt}` },
      ];
    } else {
      // Scanned PDF with no extractable text — send raw (some models may handle it)
      inputMode = 'pdf-raw';
      contentParts = [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } },
        { type: 'text', text: `File name: ${fileName}\n\n${prompt}` },
      ];
    }
  } else {
    contentParts = [
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } },
      { type: 'text', text: `File name: ${fileName}\n\n${prompt}` },
    ];
  }

  console.log(`[Extraction:AI] Starting extraction | file=${fileName} | mode=${inputMode} | mime=${mimeType}`);

  // Text-only mode doesn't require vision models
  const requireVision = inputMode !== 'pdf-text';
  const models = selectModels(EXTRACTION_PRIORITIES, requireVision);
  let result: OpenAI.Chat.Completions.ChatCompletion | null = null;
  let usedModel = models[0];
  const errors: string[] = [];

  for (const modelId of models) {
    usedModel = modelId;
    try {
      result = await retryWithBackoff(
        () => client.chat.completions.create({
          model: modelId,
          messages: [{ role: 'user', content: contentParts }],
          max_tokens: 4096,
        }),
        `extract:${fileName}`,
      );
      console.log(`[Extraction:AI] Success | file=${fileName} | model=${modelId} | mode=${inputMode}`);
      break;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`${modelId}: ${errMsg}`);
      console.warn(`[Extraction:AI] Model ${modelId} failed for ${fileName}: ${errMsg}`);

      if (isModelUnavailableError(err)) {
        markModelUnavailable(modelId);
        continue;
      }
      // Any 400-level error: try next model (bad input for this model)
      if (err instanceof Error && err.message.includes('400')) {
        continue;
      }
      throw err; // 500s, network errors, etc. — propagate
    }
  }

  if (!result) {
    const errorDetail = errors.join(' | ');
    throw new Error(`[extract:${fileName}] All models failed (mode=${inputMode}). ${errorDetail}`);
  }

  const usage = extractUsageMetadata(result);
  usage.model = usedModel;
  const text = result.choices[0]?.message?.content || '';

  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  const jsonText = jsonMatch ? jsonMatch[1] : text;

  try {
    const parsed = JSON.parse(jsonText.trim());
    console.log(`[Extraction:AI] Parsed successfully | file=${fileName} | confidence=${parsed.confidence ?? 'N/A'} | lineItems=${Array.isArray(parsed.lineItems) ? parsed.lineItems.length : 0} | model=${result.model || AI_MODEL}`);

    const rawLocations = parsed.fieldLocations ?? {};
    const fieldLocations: Record<string, FieldLocation> = {};
    for (const [key, loc] of Object.entries(rawLocations)) {
      const l = loc as { page?: number; bbox?: number[] };
      if (l && Array.isArray(l.bbox) && l.bbox.length === 4) {
        fieldLocations[key] = {
          page: l.page ?? 1,
          bbox: l.bbox as [number, number, number, number],
        };
      }
    }

    return {
      document: {
        purchaserName: parsed.purchaserName ?? null,
        purchaserTaxId: parsed.purchaserTaxId ?? null,
        purchaserCountry: parsed.purchaserCountry ?? null,
        sellerName: parsed.sellerName ?? null,
        sellerTaxId: parsed.sellerTaxId ?? null,
        sellerCountry: parsed.sellerCountry ?? null,
        documentRef: parsed.documentRef ?? null,
        documentDate: parsed.documentDate ?? null,
        dueDate: parsed.dueDate ?? null,
        netTotal: parsed.netTotal ?? null,
        dutyTotal: parsed.dutyTotal ?? null,
        taxTotal: parsed.taxTotal ?? null,
        grossTotal: parsed.grossTotal ?? null,
        lineItems: Array.isArray(parsed.lineItems) ? parsed.lineItems : [],
        accountCategory: parsed.accountCategory ?? null,
        confidence: parsed.confidence ?? 0.5,
        fieldLocations,
        pageCount: parsed.pageCount ?? 1,
      },
      usage,
    };
  } catch (parseError) {
    const snippet = text.substring(0, 200).replace(/\n/g, '\\n');
    console.error(`[Extraction:AI] JSON parse failed | file=${fileName} | model=${result.model || AI_MODEL} | error=${parseError instanceof Error ? parseError.message : 'Unknown'} | responseSnippet="${snippet}"`);

    return {
      document: {
        purchaserName: null, purchaserTaxId: null, purchaserCountry: null,
        sellerName: null, sellerTaxId: null, sellerCountry: null,
        documentRef: null, documentDate: null, dueDate: null,
        netTotal: null, dutyTotal: null, taxTotal: null, grossTotal: null,
        lineItems: [], accountCategory: null, confidence: 0,
        fieldLocations: {}, pageCount: 1,
      },
      usage,
    };
  }
}

export interface CategorisationResult {
  category: string;
  usage: AiTokenUsage;
}

export async function categoriseDescription(
  description: string,
  existingCategories: { description: string; category: string }[]
): Promise<CategorisationResult> {
  const context = existingCategories.length > 0
    ? `Previously categorised items for this client:\n${existingCategories.slice(0, 20).map(c => `"${c.description}" → ${c.category}`).join('\n')}\n\n`
    : '';

  const models = selectModels(CATEGORISATION_PRIORITIES, false);
  let result: OpenAI.Chat.Completions.ChatCompletion | null = null;

  for (const modelId of models) {
    try {
      result = await retryWithBackoff(
        () => client.chat.completions.create({
          model: modelId,
          messages: [
            {
              role: 'user',
              content: `${context}What accounting category does this description belong to? Reply with ONLY the category name (2-4 words max, e.g. "Professional Fees", "Insurance", "IT Services", "Travel & Subsistence").\n\nDescription: "${description}"`,
            },
          ],
          max_tokens: 50,
        }),
        `categorise:${description.substring(0, 40)}`,
      );
      break;
    } catch (err) {
      if (isModelUnavailableError(err)) {
        markModelUnavailable(modelId);
        continue;
      }
      throw err;
    }
  }

  if (!result) {
    throw new Error(`[categorise] All models unavailable. Tried: ${models.join(', ')}`);
  }

  return {
    category: (result.choices[0]?.message?.content || '').trim().replace(/^["']|["']$/g, ''),
    usage: extractUsageMetadata(result),
  };
}

export function generateReferenceId(index: number): string {
  return `DOC-${String(index).padStart(3, '0')}`;
}

export function getMimeType(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop();
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}

export function isSupportedForExtraction(fileName: string): boolean {
  const ext = fileName.toLowerCase().split('.').pop();
  return ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext || '');
}

// ─── Bank Statement Extraction ──────────────────────────────────────────────

const BANK_STATEMENT_PROMPT = `You are an expert bank statement data extractor. Extract ALL transaction data from this bank statement.

For each transaction, extract:
- date: The transaction date (format: YYYY-MM-DD)
- description: The transaction description/narrative
- reference: Any reference number (or empty string if none)
- debit: The debit/payment amount as a number (0 if credit)
- credit: The credit/receipt amount as a number (0 if debit)
- balance: The running balance after this transaction (0 if not shown)

Also extract these header details:
- bankName: Name of the bank
- sortCode: Sort code (e.g. "20-37-83")
- accountNumber: Full account number
- statementDate: The date printed on the statement (YYYY-MM-DD)
- statementPage: Page number if shown
- openingBalance: Opening balance for this statement page
- closingBalance: Closing balance for this statement page

Return ONLY valid JSON in this exact format:
{
  "bankName": "Bank Name",
  "sortCode": "12-34-56",
  "accountNumber": "12345678",
  "statementDate": "2025-01-31",
  "statementPage": 1,
  "openingBalance": 5000.00,
  "closingBalance": 4500.00,
  "currency": "GBP",
  "transactions": [
    {"date": "2025-01-15", "description": "Direct Debit - Electric Co", "reference": "DD123", "debit": 150.00, "credit": 0, "balance": 4850.00}
  ]
}

CRITICAL RULES:
- Extract EVERY transaction, do not skip any
- Amounts must be numbers, not strings (no commas in numbers)
- Dates must be in YYYY-MM-DD format
- If the year is not shown on each line, infer it from the statement period
- If amounts have commas, convert to plain numbers
- If balance is not shown per-transaction, set it to 0
- Do NOT include "Start Balance" or "Balance carried forward" as transactions`;

export interface BankStatementResult {
  bankName: string | null;
  sortCode: string | null;
  accountNumber: string | null;
  statementDate: string | null;
  statementPage: number | null;
  openingBalance: number | null;
  closingBalance: number | null;
  currency: string | null;
  transactions: {
    date: string;
    description: string;
    reference: string;
    debit: number;
    credit: number;
    balance: number;
  }[];
  usage: AiTokenUsage;
}

export async function extractBankStatementFromBase64(
  base64Data: string,
  mimeType: string,
  fileName: string,
): Promise<BankStatementResult> {
  type ContentPart = { type: 'image_url'; image_url: { url: string } } | { type: 'text'; text: string };

  if (isPdf(mimeType)) {
    const pdfBuffer = Buffer.from(base64Data, 'base64');
    const pdfContent = await processPdf(pdfBuffer, 20);
    console.log(`[BankToTB:AI] PDF mode=${pdfContent.mode} pages=${pdfContent.pageCount} textLen=${pdfContent.text?.length ?? 0} file=${fileName}`);

    if (pdfContent.mode === 'text' && pdfContent.text) {
      // Text-based PDF — use text extraction (no vision needed)
      return await extractFromText(pdfContent.text, pdfContent.pageCount, fileName);
    } else {
      // Scanned/image PDF — split into single pages and process each with vision
      console.log(`[BankToTB:AI] Scanned PDF detected, splitting into pages for vision extraction`);
      return await extractFromScannedPdf(pdfBuffer, fileName);
    }
  } else {
    // Image file (JPG/PNG) — send directly to vision model
    const contentParts: ContentPart[] = [
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } },
      { type: 'text', text: BANK_STATEMENT_PROMPT },
    ];
    return await extractWithVision(contentParts, fileName);
  }
}

// Extract from text-based PDF using LLM (no vision)
async function extractFromText(text: string, pageCount: number, fileName: string): Promise<BankStatementResult> {
  type ContentPart = { type: 'text'; text: string };
  const contentParts: ContentPart[] = [
    { type: 'text', text: `${BANK_STATEMENT_PROMPT}\n\n--- BANK STATEMENT TEXT (${pageCount} pages) ---\n${text}` },
  ];

  const models = selectModels(EXTRACTION_PRIORITIES, false);
  let result: OpenAI.Chat.Completions.ChatCompletion | null = null;
  let usedModel = models[0];
  const errors: string[] = [];

  for (const modelId of models) {
    usedModel = modelId;
    try {
      result = await retryWithBackoff(
        () => client.chat.completions.create({
          model: modelId,
          messages: [{ role: 'user', content: contentParts }],
          max_tokens: 16000,
        }),
        `bank-stmt:${fileName}`,
      );
      console.log(`[BankToTB:AI] Text extraction success | file=${fileName} | model=${modelId}`);
      break;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`${modelId}: ${errMsg}`);
      console.warn(`[BankToTB:AI] Model ${modelId} failed for ${fileName}: ${errMsg}`);
      if (isModelUnavailableError(err)) { markModelUnavailable(modelId); continue; }
      if (err instanceof Error && err.message.includes('400')) { continue; }
      throw err;
    }
  }

  if (!result) {
    throw new Error(`[bank-stmt:${fileName}] All models failed. ${errors.join(' | ')}`);
  }

  return parseResult(result, usedModel, fileName);
}

// Extract from scanned PDF by splitting into single-page PDFs and using vision model
async function extractFromScannedPdf(pdfBuffer: Buffer, fileName: string): Promise<BankStatementResult> {
  const { PDFDocument } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const pageCount = pdfDoc.getPageCount();
  const maxPages = Math.min(pageCount, 10);

  console.log(`[BankToTB:AI] Processing ${maxPages} pages from scanned PDF: ${fileName}`);

  const allTransactions: { date: string; description: string; reference: string; debit: number; credit: number; balance: number }[] = [];
  let metadata: Record<string, unknown> = {};
  let lastUsage: ReturnType<typeof extractUsageMetadata> | null = null;
  let lastModel = '';

  for (let pi = 0; pi < maxPages; pi++) {
    // Create a single-page PDF
    const singlePageDoc = await PDFDocument.create();
    const [copiedPage] = await singlePageDoc.copyPages(pdfDoc, [pi]);
    singlePageDoc.addPage(copiedPage);
    const singlePageBytes = await singlePageDoc.save();
    const base64Pdf = Buffer.from(singlePageBytes).toString('base64');

    const visionPrompt = pi === 0
      ? BANK_STATEMENT_PROMPT
      : `Continue extracting transactions from this bank statement page (page ${pi + 1}). Extract bankName, sortCode, accountNumber, statementDate, statementPage if visible. Return ONLY valid JSON with the same format as before.`;

    type ContentPart = { type: 'image_url'; image_url: { url: string } } | { type: 'text'; text: string };
    const contentParts: ContentPart[] = [
      { type: 'image_url', image_url: { url: `data:application/pdf;base64,${base64Pdf}` } },
      { type: 'text', text: visionPrompt },
    ];

    // Llama-3.2-90B-Vision-Instruct-Turbo handles vision/PDF input
    // Put it first, then fall back to other vision models
    const PDF_VISION_MODELS = [
      'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo',
      ...selectModels(EXTRACTION_PRIORITIES, true).filter(m => m !== 'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo'),
    ];
    let result: OpenAI.Chat.Completions.ChatCompletion | null = null;

    for (const modelId of PDF_VISION_MODELS) {
      try {
        result = await retryWithBackoff(
          () => client.chat.completions.create({
            model: modelId,
            messages: [{ role: 'user', content: contentParts }],
            max_tokens: 8000,
          }),
          `bank-stmt:${fileName}:p${pi + 1}`,
        );
        lastModel = modelId;
        console.log(`[BankToTB:AI] Vision page ${pi + 1}/${maxPages} success | file=${fileName} | model=${modelId}`);
        break;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[BankToTB:AI] Vision model ${modelId} failed page ${pi + 1}: ${errMsg}`);
        if (isModelUnavailableError(err)) { markModelUnavailable(modelId); continue; }
        if (err instanceof Error && err.message.includes('400')) { continue; }
        // Don't throw — try next model
      }
    }

    if (!result) {
      console.warn(`[BankToTB:AI] All vision models failed for page ${pi + 1} of ${fileName} — skipping`);
      continue;
    }

    lastUsage = extractUsageMetadata(result);
    const text = result.choices[0]?.message?.content || '';
    const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/) || cleaned.match(/(\{[\s\S]*\})/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        if (pi === 0) {
          metadata = { ...parsed };
          delete metadata.transactions;
        }
        if (Array.isArray(parsed.transactions)) {
          for (const t of parsed.transactions) {
            allTransactions.push({
              date: String(t.date || ''),
              description: String(t.description || ''),
              reference: String(t.reference || ''),
              debit: Number(t.debit) || 0,
              credit: Number(t.credit) || 0,
              balance: Number(t.balance) || 0,
            });
          }
        }
      } catch { /* skip malformed JSON from this page */ }
    }
  }

  if (allTransactions.length === 0) {
    throw new Error(`[bank-stmt:${fileName}] No transactions extracted from ${maxPages} pages. The PDF may be encrypted or in an unsupported format.`);
  }

  const usage = lastUsage || { promptTokens: 0, completionTokens: 0, totalTokens: 0, model: lastModel, costUsd: 0 };
  usage.model = lastModel;

  console.log(`[BankToTB:AI] Scanned PDF complete: ${allTransactions.length} txns from ${maxPages} pages | file=${fileName}`);

  return {
    bankName: (metadata.bankName as string) || null,
    sortCode: (metadata.sortCode as string) || null,
    accountNumber: (metadata.accountNumber as string) || null,
    statementDate: (metadata.statementDate as string) || null,
    statementPage: metadata.statementPage ? Number(metadata.statementPage) : null,
    openingBalance: metadata.openingBalance != null ? Number(metadata.openingBalance) : null,
    closingBalance: metadata.closingBalance != null ? Number(metadata.closingBalance) : null,
    currency: (metadata.currency as string) || null,
    transactions: allTransactions,
    usage,
  };
}

// Extract from image using vision model
async function extractWithVision(
  contentParts: ({ type: 'image_url'; image_url: { url: string } } | { type: 'text'; text: string })[],
  fileName: string,
): Promise<BankStatementResult> {
  const models = selectModels(EXTRACTION_PRIORITIES, true);
  let result: OpenAI.Chat.Completions.ChatCompletion | null = null;
  let usedModel = models[0];
  const errors: string[] = [];

  for (const modelId of models) {
    usedModel = modelId;
    try {
      result = await retryWithBackoff(
        () => client.chat.completions.create({
          model: modelId,
          messages: [{ role: 'user', content: contentParts }],
          max_tokens: 16000,
        }),
        `bank-stmt:${fileName}`,
      );
      console.log(`[BankToTB:AI] Vision success | file=${fileName} | model=${modelId}`);
      break;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`${modelId}: ${errMsg}`);
      console.warn(`[BankToTB:AI] Model ${modelId} failed for ${fileName}: ${errMsg}`);
      if (isModelUnavailableError(err)) { markModelUnavailable(modelId); continue; }
      if (err instanceof Error && err.message.includes('400')) { continue; }
      throw err;
    }
  }

  if (!result) {
    throw new Error(`[bank-stmt:${fileName}] All models failed. ${errors.join(' | ')}`);
  }

  return parseResult(result, usedModel, fileName);
}

// Parse AI result into BankStatementResult
function parseResult(result: OpenAI.Chat.Completions.ChatCompletion, usedModel: string, fileName: string): BankStatementResult {
  const usage = extractUsageMetadata(result);
  usage.model = usedModel;
  const text = result.choices[0]?.message?.content || '';
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/) || cleaned.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) {
    throw new Error(`[bank-stmt:${fileName}] No JSON in AI response`);
  }

  const parsed = JSON.parse(jsonMatch[1].trim());
  const txns = Array.isArray(parsed.transactions) ? parsed.transactions : [];

  return {
    bankName: parsed.bankName || null,
    sortCode: parsed.sortCode || null,
    accountNumber: parsed.accountNumber || null,
    statementDate: parsed.statementDate || null,
    statementPage: parsed.statementPage ? Number(parsed.statementPage) : null,
    openingBalance: parsed.openingBalance != null ? Number(parsed.openingBalance) : null,
    closingBalance: parsed.closingBalance != null ? Number(parsed.closingBalance) : null,
    currency: parsed.currency || null,
    transactions: txns.map((t: Record<string, unknown>) => ({
      date: String(t.date || ''),
      description: String(t.description || ''),
      reference: String(t.reference || ''),
      debit: Number(t.debit) || 0,
      credit: Number(t.credit) || 0,
      balance: Number(t.balance) || 0,
    })),
    usage,
  };
}
