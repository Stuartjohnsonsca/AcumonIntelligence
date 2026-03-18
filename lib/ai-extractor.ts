import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.TOGETHER_API_KEY!,
  baseURL: 'https://api.together.xyz/v1',
});

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60000;

export const AI_MODEL = process.env.AI_MODEL || 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8';

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
  'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8': { inputPerToken: 0.27 / 1_000_000, outputPerToken: 0.85 / 1_000_000 },
  'Qwen/Qwen3-VL-8B-Instruct': { inputPerToken: 0.18 / 1_000_000, outputPerToken: 0.68 / 1_000_000 },
  'Qwen/Qwen3.5-397B-A17B': { inputPerToken: 0.60 / 1_000_000, outputPerToken: 3.60 / 1_000_000 },
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
  const dataUri = `data:${mimeType};base64,${base64Data}`;

  const result = await retryWithBackoff(
    () => client.chat.completions.create({
      model: AI_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: dataUri },
            },
            {
              type: 'text',
              text: `File name: ${fileName}\n\n${prompt}`,
            },
          ],
        },
      ],
      max_tokens: 4096,
    }),
    `extract:${fileName}`,
  );

  const usage = extractUsageMetadata(result);
  const text = result.choices[0]?.message?.content || '';

  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  const jsonText = jsonMatch ? jsonMatch[1] : text;

  try {
    const parsed = JSON.parse(jsonText.trim());

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
  } catch {
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

  const result = await retryWithBackoff(
    () => client.chat.completions.create({
      model: AI_MODEL,
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
