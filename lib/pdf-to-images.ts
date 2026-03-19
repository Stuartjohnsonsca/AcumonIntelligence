/**
 * PDF text extraction for AI document processing.
 *
 * Uses pdf-parse (lightweight, no native dependencies, serverless-safe).
 * Extracts text content from PDFs so vision models aren't needed.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');

export interface PdfContent {
  mode: 'text' | 'raw';
  text?: string;
  pageCount: number;
}

/**
 * Extract text from a PDF buffer.
 * Returns text mode if content found, raw mode otherwise.
 */
export async function processPdf(
  pdfBuffer: Buffer,
  maxPages = 10,
): Promise<PdfContent> {
  try {
    const result = await pdfParse(pdfBuffer, {
      max: maxPages, // limit pages parsed
    });

    const text = (result.text || '').trim();
    const pageCount = result.numpages || 1;

    if (text.length > 50) {
      console.log(`[PDF] Extracted ${text.length} chars from ${pageCount} page(s)`);
      return { mode: 'text', text, pageCount };
    }

    console.warn(`[PDF] Very little text extracted (${text.length} chars) — likely scanned. Using raw mode.`);
    return { mode: 'raw', pageCount };
  } catch (err) {
    console.error(`[PDF] Text extraction failed: ${err instanceof Error ? err.message : err}`);
    return { mode: 'raw', pageCount: 1 };
  }
}

/**
 * Check if a mime type is a PDF.
 */
export function isPdf(mimeType: string): boolean {
  return mimeType.toLowerCase() === 'application/pdf';
}
