import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export interface LineItem {
  description: string;
  quantity: number | null;
  productId: string | null;
  net: number | null;
  tax: number | null;
  duty: number | null;
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
}

const EXTRACTION_PROMPT = `You are a financial document extraction specialist. Extract all available financial data from this document.

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
  "confidence": 0.0 to 1.0
}

Rules:
- All monetary values should be numbers without currency symbols
- Dates in YYYY-MM-DD format
- If this is not a financial document, return all nulls with confidence 0
- accountCategory should be your best interpretation based on the document content`;

export async function extractDocumentFromBase64(
  base64Data: string,
  mimeType: string,
  fileName: string
): Promise<ExtractedDocument> {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const result = await model.generateContent([
    {
      inlineData: {
        data: base64Data,
        mimeType: mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf',
      },
    },
    `File name: ${fileName}\n\n${EXTRACTION_PROMPT}`,
  ]);

  const text = result.response.text();

  // Strip markdown code blocks if present
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  const jsonText = jsonMatch ? jsonMatch[1] : text;

  try {
    const parsed = JSON.parse(jsonText.trim());
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
    };
  } catch {
    return {
      purchaserName: null, purchaserTaxId: null, purchaserCountry: null,
      sellerName: null, sellerTaxId: null, sellerCountry: null,
      documentRef: null, documentDate: null, dueDate: null,
      netTotal: null, dutyTotal: null, taxTotal: null, grossTotal: null,
      lineItems: [], accountCategory: null, confidence: 0,
    };
  }
}

export async function categoriseDescription(
  description: string,
  existingCategories: { description: string; category: string }[]
): Promise<string> {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const context = existingCategories.length > 0
    ? `Previously categorised items for this client:\n${existingCategories.slice(0, 20).map(c => `"${c.description}" → ${c.category}`).join('\n')}\n\n`
    : '';

  const result = await model.generateContent(
    `${context}What accounting category does this description belong to? Reply with ONLY the category name (2-4 words max, e.g. "Professional Fees", "Insurance", "IT Services", "Travel & Subsistence").\n\nDescription: "${description}"`
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
