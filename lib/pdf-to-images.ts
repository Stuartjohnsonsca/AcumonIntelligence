/**
 * PDF processing for AI extraction.
 *
 * Extracts text content from PDF pages using pdfjs-dist.
 * No native dependencies (canvas) needed — works on Vercel serverless.
 *
 * For scanned/image-only PDFs where text extraction yields nothing,
 * falls back to sending the raw PDF base64.
 */

export interface PdfContent {
  mode: 'text' | 'raw';
  text?: string;
  pageCount: number;
}

/**
 * Extract text content from PDF pages using pdfjs-dist (pure JS, no canvas).
 */
export async function processPdf(
  pdfBuffer: Buffer,
  maxPages = 10,
): Promise<PdfContent> {
  try {
    const pdfjs = await import('pdfjs-dist');

    const data = new Uint8Array(pdfBuffer);
    const doc = await pdfjs.getDocument({
      data,
      useSystemFonts: true,
      isEvalSupported: false,
    }).promise;

    const numPages = Math.min(doc.numPages, maxPages);
    const pageTexts: string[] = [];

    for (let i = 1; i <= numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : '') || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (pageText) pageTexts.push(`--- Page ${i} ---\n${pageText}`);
    }

    const text = pageTexts.join('\n\n');

    if (text.length > 50) {
      console.log(`[PDF] Extracted ${text.length} chars of text from ${numPages} page(s)`);
      return { mode: 'text', text, pageCount: doc.numPages };
    }

    console.warn(`[PDF] Text extraction returned very little content (${text.length} chars) — likely a scanned PDF. Using raw mode.`);
    return { mode: 'raw', pageCount: doc.numPages };
  } catch (err) {
    console.warn(`[PDF] Text extraction failed: ${err instanceof Error ? err.message : err}. Using raw mode.`);
    return { mode: 'raw', pageCount: 1 };
  }
}

/**
 * Check if a mime type is a PDF.
 */
export function isPdf(mimeType: string): boolean {
  return mimeType.toLowerCase() === 'application/pdf';
}
