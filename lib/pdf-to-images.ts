/**
 * Convert PDF pages to PNG images for vision model consumption.
 * Uses pdfjs-dist with @napi-rs/canvas (Vercel serverless compatible).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createCanvas } = require('@napi-rs/canvas');

export interface PdfPage {
  pageNumber: number;
  base64: string; // PNG base64 (no data: prefix)
  width: number;
  height: number;
}

/**
 * Convert a PDF buffer to an array of PNG base64 images (one per page).
 * @param pdfBuffer - Raw PDF file as Buffer
 * @param maxPages - Maximum number of pages to convert (default: 5)
 * @param scale - Rendering scale factor (default: 2.0 for good quality)
 */
export async function pdfToImages(
  pdfBuffer: Buffer,
  maxPages = 5,
  scale = 2.0,
): Promise<PdfPage[]> {
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

    // pdfjs render — use any cast for cross-canvas compatibility
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
 * Check if a mime type is a PDF.
 */
export function isPdf(mimeType: string): boolean {
  return mimeType.toLowerCase() === 'application/pdf';
}
