/**
 * PDF text extraction for AI document processing.
 *
 * Uses multiple extraction methods with fallbacks:
 * 1. pdf-parse (primary)
 * 2. unpdf (fallback)
 * 3. pdfjs-dist (fallback)
 *
 * Uses serverExternalPackages in next.config.js
 * to prevent Turbopack from bundling pdfjs-dist's canvas dependencies.
 */

export interface PdfContent {
  mode: 'text' | 'raw';
  text?: string;
  pageCount: number;
}

/**
 * Extract text from a PDF buffer using multiple methods.
 * Returns text mode if content found, raw mode otherwise.
 */
export async function processPdf(
  pdfBuffer: Buffer,
  maxPages = 10,
): Promise<PdfContent> {
  let extractedText = '';
  let pageCount = 1;

  // Attempt 1: pdf-parse
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse');
    const result = await pdfParse(pdfBuffer, { max: maxPages });
    extractedText = (result.text || '').trim();
    pageCount = result.numpages || 1;
    if (extractedText.length > 50) {
      console.log(`[PDF] pdf-parse extracted ${extractedText.length} chars from ${pageCount} page(s)`);
      return { mode: 'text', text: extractedText, pageCount };
    }
    console.log(`[PDF] pdf-parse: only ${extractedText.length} chars, trying fallbacks...`);
  } catch (err) {
    console.warn(`[PDF] pdf-parse failed: ${err instanceof Error ? err.message : err}`);
  }

  // Attempt 2: unpdf
  try {
    const { extractText } = await import('unpdf');
    const pdfData = new Uint8Array(pdfBuffer);
    const result = await extractText(pdfData);
    const pages = Array.isArray(result.text) ? result.text : [String(result.text || '')];
    const unpdfText = pages.join('\n\n');
    if (unpdfText.length > extractedText.length) extractedText = unpdfText;
    if (pages.length > pageCount) pageCount = pages.length;
    if (extractedText.length > 50) {
      console.log(`[PDF] unpdf extracted ${extractedText.length} chars from ${pageCount} page(s)`);
      return { mode: 'text', text: extractedText, pageCount };
    }
    console.log(`[PDF] unpdf: only ${extractedText.length} chars, trying pdfjs-dist...`);
  } catch (err) {
    console.warn(`[PDF] unpdf failed: ${err instanceof Error ? err.message : err}`);
  }

  // Attempt 3: pdfjs-dist
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
    const pagesText: string[] = [];
    const limit = Math.min(doc.numPages, maxPages);
    for (let i = 1; i <= limit; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: unknown) => (item as { str?: string }).str || '')
        .join(' ');
      pagesText.push(pageText);
    }
    const pdfjsText = pagesText.join('\n\n');
    if (pdfjsText.length > extractedText.length) extractedText = pdfjsText;
    if (doc.numPages > pageCount) pageCount = doc.numPages;
    await doc.destroy();
    if (extractedText.length > 50) {
      console.log(`[PDF] pdfjs-dist extracted ${extractedText.length} chars from ${pageCount} page(s)`);
      return { mode: 'text', text: extractedText, pageCount };
    }
    console.log(`[PDF] pdfjs-dist: only ${extractedText.length} chars`);
  } catch (err) {
    console.warn(`[PDF] pdfjs-dist failed: ${err instanceof Error ? err.message : err}`);
  }

  // If we got SOME text (even < 50 chars), try it anyway — it might contain enough structure
  if (extractedText.length > 10) {
    console.log(`[PDF] Using partial text extraction (${extractedText.length} chars) from ${pageCount} page(s)`);
    return { mode: 'text', text: extractedText, pageCount };
  }

  console.warn(`[PDF] All text extraction methods failed or returned minimal text (${extractedText.length} chars). Using raw/vision mode.`);
  return { mode: 'raw', pageCount };
}

/**
 * Check if a mime type is a PDF.
 */
export function isPdf(mimeType: string): boolean {
  return mimeType.toLowerCase() === 'application/pdf';
}
