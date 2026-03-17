import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60000;

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

const EXTRACTION_PROMPT = `You are a financial document extraction specialist. Extract all available financial data from this document AND locate where each field appears on the document.

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
- fieldLocations: for EVERY non-null extracted field, provide a bounding box showing where that value appears on the document. Coordinates are normalized 0-1000 (top-left origin). Keys must match field names exactly: purchaserName, purchaserTaxId, purchaserCountry, sellerName, sellerTaxId, sellerCountry, documentRef, documentDate, dueDate, netTotal, dutyTotal, taxTotal, grossTotal. For line items use keys like "lineItems[0].description", "lineItems[0].net", etc.
- pageCount: the total number of pages in this document (1 for single images)`;

export async function extractDocumentFromBase64(
  base64Data: string,
  mimeType: string,
  fileName: string
): Promise<ExtractedDocument> {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const result = await retryWithBackoff(
    () => model.generateContent([
      {
        inlineData: {
          data: base64Data,
          mimeType: mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf',
        },
      },
      `File name: ${fileName}\n\n${EXTRACTION_PROMPT}`,
    ]),
    `extract:${fileName}`,
  );

  const text = result.response.text();

  // Strip markdown code blocks if present
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
    };
  } catch {
    return {
      purchaserName: null, purchaserTaxId: null, purchaserCountry: null,
      sellerName: null, sellerTaxId: null, sellerCountry: null,
      documentRef: null, documentDate: null, dueDate: null,
      netTotal: null, dutyTotal: null, taxTotal: null, grossTotal: null,
      lineItems: [], accountCategory: null, confidence: 0,
      fieldLocations: {}, pageCount: 1,
    };
  }
}

export async function categoriseDescription(
  description: string,
  existingCategories: { description: string; category: string }[]
): Promise<string> {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const context = existingCategories.length > 0
    ? `Previously categorised items for this client:\n${existingCategories.slice(0, 20).map(c => `"${c.description}" → ${c.category}`).join('\n')}\n\n`
    : '';

  const result = await retryWithBackoff(
    () => model.generateContent(
      `${context}What accounting category does this description belong to? Reply with ONLY the category name (2-4 words max, e.g. "Professional Fees", "Insurance", "IT Services", "Travel & Subsistence").\n\nDescription: "${description}"`
    ),
    `categorise:${description.substring(0, 40)}`,
  );

  return result.response.text().trim().replace(/^["']|["']$/g, '');
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
