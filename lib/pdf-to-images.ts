/**
 * PDF processing for AI extraction.
 *
 * Strategy (in order of preference):
 * 1. Render PDF pages as PNG images using @napi-rs/canvas (best for vision models)
 * 2. Extract text content using pdfjs-dist (no canvas needed, works everywhere)
 * 3. Send raw PDF base64 (last resort — some models may accept it)
 */

export interface PdfPage {
  pageNumber: number;
  base64: string;
  width: number;
  height: number;
}

export interface PdfContent {
  mode: 'images' | 'text' | 'raw';
  images?: PdfPage[];
  text?: string;
  pageCount: number;
}

/**
 * Try to render PDF pages as PNG images. May fail if canvas isn't available.
 */
async function tryRenderImages(pdfBuffer: Buffer, maxPages: number, scale: number): Promise<PdfPage[]> {
  // Dynamic require — will throw if @napi-rs/canvas isn't available
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createCanvas } = require('@napi-rs/canvas');
  const pdfjs = await import('pdfjs-dist');

  const data = new Uint8Array(pdfBuffer);
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const numPages = Math.min(doc.numPages, maxPages);
  const pages: PdfPage[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const width = Math.round(viewport.width);
    const height = Math.round(viewport.height);

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (page.render({
      canvasContext: ctx as any,
      viewport,
      canvas: canvas as any,
    } as any)).promise;

    const pngBuffer: Buffer = canvas.toBuffer('image/png');
    pages.push({
      pageNumber: i,
      base64: pngBuffer.toString('base64'),
      width,
      height,
    });
  }

  return pages;
}

/**
 * Extract text content from PDF pages. Works without canvas.
 */
async function extractText(pdfBuffer: Buffer, maxPages: number): Promise<{ text: string; pageCount: number }> {
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
      .map((item: { str?: string }) => item.str || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (pageText) pageTexts.push(`--- Page ${i} ---\n${pageText}`);
  }

  return { text: pageTexts.join('\n\n'), pageCount: doc.numPages };
}

/**
 * Process a PDF for AI extraction. Tries image rendering first, falls back to text.
 */
export async function processPdf(
  pdfBuffer: Buffer,
  maxPages = 5,
  scale = 2.0,
): Promise<PdfContent> {
  // Try image rendering first (best quality for vision models)
  try {
    const images = await tryRenderImages(pdfBuffer, maxPages, scale);
    if (images.length > 0) {
      console.log(`[PDF] Rendered ${images.length} page(s) as images`);
      return { mode: 'images', images, pageCount: images.length };
    }
  } catch (err) {
    console.warn(`[PDF] Image rendering failed, falling back to text extraction: ${err instanceof Error ? err.message : err}`);
  }

  // Fall back to text extraction (works without canvas)
  try {
    const { text, pageCount } = await extractText(pdfBuffer, maxPages);
    if (text.length > 50) {
      console.log(`[PDF] Extracted ${text.length} chars of text from ${pageCount} page(s)`);
      return { mode: 'text', text, pageCount };
    }
    console.warn(`[PDF] Text extraction returned very little content (${text.length} chars), will try raw`);
  } catch (err) {
    console.warn(`[PDF] Text extraction also failed: ${err instanceof Error ? err.message : err}`);
  }

  // Last resort: raw PDF
  console.warn('[PDF] All extraction methods failed, returning raw PDF');
  return { mode: 'raw', pageCount: 1 };
}

/**
 * Check if a mime type is a PDF.
 */
export function isPdf(mimeType: string): boolean {
  return mimeType.toLowerCase() === 'application/pdf';
}
