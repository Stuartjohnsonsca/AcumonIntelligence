/**
 * PDF text extraction for AI document processing.
 *
 * Uses pdf-parse with serverExternalPackages in next.config.js
 * to prevent Turbopack from bundling pdfjs-dist's canvas dependencies.
 */

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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse');
    const result = await pdfParse(pdfBuffer, { max: maxPages });

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
