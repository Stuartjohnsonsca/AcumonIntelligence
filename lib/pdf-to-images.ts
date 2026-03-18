/**
 * Convert PDF pages to PNG images for vision model consumption.
 * Uses pdfjs-dist with node-canvas for server-side rendering.
 */

import { createCanvas } from 'canvas';

// pdfjs-dist requires dynamic import for Node.js ESM compatibility
let pdfjsLib: typeof import('pdfjs-dist') | null = null;

async function getPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist');
  }
  return pdfjsLib;
}

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
  const pdfjs = await getPdfjs();

  const data = new Uint8Array(pdfBuffer);
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    // Disable worker for serverless — run in main thread
    isEvalSupported: false,
  }).promise;

  const numPages = Math.min(doc.numPages, maxPages);
  const pages: PdfPage[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });

    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');

    // pdfjs render expects a CanvasRenderingContext2D-like object
    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;

    const pngBuffer = canvas.toBuffer('image/png');
    pages.push({
      pageNumber: i,
      base64: pngBuffer.toString('base64'),
      width: viewport.width,
      height: viewport.height,
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
