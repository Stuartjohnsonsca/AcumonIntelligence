/**
 * Smart document processor for Assurance evidence review.
 *
 * Handles:
 * - Large documents by chunking text into model-friendly sizes
 * - Scanned PDFs via OCR (vision model fallback)
 * - Non-PDF files (images, spreadsheets)
 * - Adaptive concurrency to avoid rate limits
 */

import OpenAI from 'openai';
import { processPdf, isPdf } from '@/lib/pdf-to-images';
import { selectModels } from '@/lib/ai-extractor';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Max characters per chunk sent to the review model (~6K tokens ≈ 24K chars) */
const MAX_CHUNK_CHARS = 20_000;

/** Overlap between chunks so context isn't lost at boundaries */
const CHUNK_OVERLAP_CHARS = 1_000;

/** Max concurrent document processing tasks */
const MAX_CONCURRENCY = 6;

/** Max concurrent API calls within a single document (for chunk reviews) */
const MAX_CHUNK_CONCURRENCY = 3;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ProcessedDocument {
  documentId: string;
  originalName: string;
  textContent: string;
  chunks: DocumentChunk[];
  extractionMethod: 'pdf-text' | 'pdf-ocr' | 'image-ocr' | 'raw-text';
  pageCount?: number;
  totalChars: number;
}

export interface DocumentChunk {
  index: number;
  text: string;
  startChar: number;
  endChar: number;
}

// ─── Client ─────────────────────────────────────────────────────────────────

let _client: OpenAI | null = null;
let _clientKey: string | undefined;

function getClient(): OpenAI {
  const key = process.env.TOGETHER_DOC_SUMMARY_KEY || process.env.TOGETHER_API_KEY;
  if (!key) throw new Error('No Together AI key');
  if (!_client || _clientKey !== key) {
    _client = new OpenAI({ apiKey: key, baseURL: 'https://api.together.xyz/v1' });
    _clientKey = key;
  }
  return _client;
}

// ─── Text chunking ──────────────────────────────────────────────────────────

export function chunkText(text: string, maxChars = MAX_CHUNK_CHARS, overlap = CHUNK_OVERLAP_CHARS): DocumentChunk[] {
  if (text.length <= maxChars) {
    return [{ index: 0, text, startChar: 0, endChar: text.length }];
  }

  const chunks: DocumentChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);

    // Try to break at a paragraph or sentence boundary
    if (end < text.length) {
      // Look for paragraph break within last 20% of chunk
      const searchStart = Math.floor(end - maxChars * 0.2);
      const searchRegion = text.substring(searchStart, end);

      const paragraphBreak = searchRegion.lastIndexOf('\n\n');
      if (paragraphBreak > 0) {
        end = searchStart + paragraphBreak + 2;
      } else {
        // Fall back to sentence boundary
        const sentenceBreak = searchRegion.lastIndexOf('. ');
        if (sentenceBreak > 0) {
          end = searchStart + sentenceBreak + 2;
        }
      }
    }

    chunks.push({
      index,
      text: text.substring(start, end),
      startChar: start,
      endChar: end,
    });

    index++;
    // Next chunk starts with overlap for context continuity
    start = Math.max(start + 1, end - overlap);

    // Safety: prevent infinite loop
    if (start >= text.length || index > 200) break;
  }

  return chunks;
}

// ─── Extract text from document buffer ──────────────────────────────────────

export async function extractDocumentText(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<{ text: string; method: ProcessedDocument['extractionMethod']; pageCount?: number }> {

  // PDF files
  if (isPdf(mimeType)) {
    // First try text extraction (works for digital PDFs)
    const pdfResult = await processPdf(buffer, 200); // Allow up to 200 pages

    if (pdfResult.mode === 'text' && pdfResult.text && pdfResult.text.length > 100) {
      console.log(`[AssuranceDoc] PDF text extraction: ${pdfResult.text.length} chars, ${pdfResult.pageCount} pages`);
      return {
        text: pdfResult.text,
        method: 'pdf-text',
        pageCount: pdfResult.pageCount,
      };
    }

    // Scanned PDF — use OCR via vision model
    console.log(`[AssuranceDoc] PDF appears scanned, attempting OCR via vision model`);
    const ocrText = await ocrViaVisionModel(buffer, mimeType, fileName);
    return {
      text: ocrText,
      method: 'pdf-ocr',
      pageCount: pdfResult.pageCount,
    };
  }

  // Image files (PNG, JPEG, TIFF) — OCR
  if (mimeType.startsWith('image/')) {
    const ocrText = await ocrViaVisionModel(buffer, mimeType, fileName);
    return { text: ocrText, method: 'image-ocr' };
  }

  // Text-based files (CSV, JSON, TXT, HTML)
  if (
    mimeType.includes('text') ||
    mimeType.includes('json') ||
    mimeType.includes('csv') ||
    mimeType.includes('xml') ||
    mimeType.includes('html')
  ) {
    return { text: buffer.toString('utf-8'), method: 'raw-text' };
  }

  // Excel/Word — try to read as text (basic)
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const XLSX = require('xlsx');
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const text = wb.SheetNames
        .map((name: string) => {
          const sheet = wb.Sheets[name];
          return `=== Sheet: ${name} ===\n${XLSX.utils.sheet_to_csv(sheet)}`;
        })
        .join('\n\n');
      return { text, method: 'raw-text' };
    } catch {
      return { text: `[Unable to extract text from ${fileName}]`, method: 'raw-text' };
    }
  }

  // Fallback
  return { text: buffer.toString('utf-8').substring(0, MAX_CHUNK_CHARS), method: 'raw-text' };
}

// ─── OCR via vision model ───────────────────────────────────────────────────

async function ocrViaVisionModel(buffer: Buffer, mimeType: string, fileName: string): Promise<string> {
  const base64 = buffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64}`;

  // Use vision-capable models
  const models = selectModels({ speed: 3, accuracy: 4, depth: 3, cost: 2 }, true);

  for (const modelId of models) {
    try {
      const result = await getClient().chat.completions.create({
        model: modelId,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            {
              type: 'text',
              text: `Extract ALL text from this document image "${fileName}". Preserve the document structure including headings, tables, lists, and paragraphs. Return the full text content only, no commentary.`,
            },
          ] as OpenAI.Chat.Completions.ChatCompletionContentPart[],
        }],
        max_tokens: 16384,
      });

      const text = result.choices[0]?.message?.content || '';
      if (text.length > 50) {
        console.log(`[AssuranceDoc:OCR] Extracted ${text.length} chars via ${modelId}`);
        return text;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      if (msg.includes('404') || msg.includes('model not found')) continue;
      console.warn(`[AssuranceDoc:OCR] Model ${modelId} failed:`, err);
      continue;
    }
  }

  return `[OCR failed for ${fileName} — unable to extract text from this document]`;
}

// ─── Process a single document end-to-end ───────────────────────────────────

export async function processDocument(
  documentId: string,
  originalName: string,
  buffer: Buffer,
  mimeType: string,
): Promise<ProcessedDocument> {
  const { text, method, pageCount } = await extractDocumentText(buffer, mimeType, originalName);
  const chunks = chunkText(text);

  console.log(`[AssuranceDoc] Processed "${originalName}": ${text.length} chars, ${chunks.length} chunk(s), method=${method}`);

  return {
    documentId,
    originalName,
    textContent: text,
    chunks,
    extractionMethod: method,
    pageCount,
    totalChars: text.length,
  };
}

// ─── Review a chunked document against ToR ──────────────────────────────────

import { type DocumentReviewResult, type ReviewFinding } from '@/lib/assurance-review-ai';

const PRIMARY_MODEL = 'Qwen/Qwen3.5-397B-A17B';
const FALLBACK_MODEL = 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8';

/**
 * Review a document that may have multiple chunks.
 * Each chunk is reviewed against the ToR, then results are merged.
 */
export async function reviewChunkedDocument(
  doc: ProcessedDocument,
  documentCategory: string,
  torContext: string,
  subToolName: string,
  sector: string,
): Promise<DocumentReviewResult> {
  if (doc.chunks.length === 1) {
    // Single chunk — review directly (existing fast path)
    return reviewSingleChunk(doc.chunks[0].text, doc.originalName, documentCategory, torContext, subToolName, sector);
  }

  // Multi-chunk: review each chunk in parallel, then merge
  console.log(`[AssuranceDoc:Review] "${doc.originalName}" has ${doc.chunks.length} chunks — reviewing in parallel`);

  const chunkResults: DocumentReviewResult[] = [];
  const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  // Process chunks in batches
  for (let i = 0; i < doc.chunks.length; i += MAX_CHUNK_CONCURRENCY) {
    const batch = doc.chunks.slice(i, i + MAX_CHUNK_CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(chunk =>
        reviewSingleChunk(
          chunk.text,
          `${doc.originalName} (part ${chunk.index + 1}/${doc.chunks.length})`,
          documentCategory,
          torContext,
          subToolName,
          sector,
        ),
      ),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        chunkResults.push(result.value);
        totalUsage.promptTokens += result.value.usage.promptTokens;
        totalUsage.completionTokens += result.value.usage.completionTokens;
        totalUsage.totalTokens += result.value.usage.totalTokens;
      }
    }
  }

  if (chunkResults.length === 0) {
    throw new Error(`All chunk reviews failed for ${doc.originalName}`);
  }

  // Merge chunk results
  return mergeChunkResults(chunkResults, totalUsage);
}

// ─── Review a single chunk ──────────────────────────────────────────────────

async function reviewSingleChunk(
  text: string,
  documentName: string,
  documentCategory: string,
  torContext: string,
  subToolName: string,
  sector: string,
): Promise<DocumentReviewResult> {
  const prompt = `You are a senior internal audit professional reviewing evidence against Terms of Reference.

SERVICE AREA: ${subToolName}
SECTOR: ${sector}
DOCUMENT CATEGORY: ${documentCategory}
DOCUMENT: ${documentName}

TERMS OF REFERENCE CONTEXT:
${torContext}

DOCUMENT TEXT:
${text}

Analyse and return ONLY valid JSON:
{
  "satisfiesRequirement": true/false,
  "findings": [{ "area": "...", "finding": "...", "severity": "high|medium|low" }],
  "gaps": ["..."],
  "score": 75,
  "recommendations": ["..."]
}`;

  const models = [PRIMARY_MODEL, FALLBACK_MODEL];
  let result: OpenAI.Chat.Completions.ChatCompletion | null = null;
  let usedModel = models[0];

  for (const modelId of models) {
    usedModel = modelId;
    try {
      result = await getClient().chat.completions.create({
        model: modelId,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 8192,
      });
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      if (msg.includes('404') || msg.includes('model not found')) continue;
      throw err;
    }
  }

  if (!result) throw new Error(`All models failed for chunk review of ${documentName}`);

  const usage = {
    promptTokens: result.usage?.prompt_tokens ?? 0,
    completionTokens: result.usage?.completion_tokens ?? 0,
    totalTokens: result.usage?.total_tokens ?? 0,
  };

  const responseText = result.choices[0]?.message?.content || '';
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/) || responseText.match(/(\{[\s\S]*\})/);

  try {
    const parsed = JSON.parse((jsonMatch ? jsonMatch[1] : responseText).trim());
    return {
      satisfiesRequirement: Boolean(parsed.satisfiesRequirement),
      findings: Array.isArray(parsed.findings)
        ? parsed.findings.map((f: Record<string, unknown>) => ({
            area: String(f.area || ''),
            finding: String(f.finding || ''),
            severity: ['high', 'medium', 'low'].includes(String(f.severity)) ? String(f.severity) as 'high' | 'medium' | 'low' : 'medium',
          }))
        : [],
      gaps: Array.isArray(parsed.gaps) ? parsed.gaps.map((g: unknown) => String(g)) : [],
      score: typeof parsed.score === 'number' ? Math.min(100, Math.max(0, parsed.score)) : 50,
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.map((r: unknown) => String(r)) : [],
      usage,
      model: usedModel,
    };
  } catch {
    return {
      satisfiesRequirement: false,
      findings: [{ area: documentName, finding: 'Unable to parse AI review response', severity: 'medium' }],
      gaps: ['Review could not be completed for this section'],
      score: 30,
      recommendations: ['Manual review required'],
      usage,
      model: usedModel,
    };
  }
}

// ─── Merge multiple chunk review results ────────────────────────────────────

function mergeChunkResults(
  results: DocumentReviewResult[],
  totalUsage: { promptTokens: number; completionTokens: number; totalTokens: number },
): DocumentReviewResult {
  // Merge findings, deduplicating by content similarity
  const allFindings: ReviewFinding[] = [];
  const seenFindings = new Set<string>();

  for (const r of results) {
    for (const f of r.findings) {
      const key = `${f.area}:${f.finding.substring(0, 50)}`.toLowerCase();
      if (!seenFindings.has(key)) {
        seenFindings.add(key);
        allFindings.push(f);
      }
    }
  }

  // Merge gaps, deduplicating
  const allGaps = [...new Set(results.flatMap(r => r.gaps))];

  // Merge recommendations, deduplicating
  const allRecs = [...new Set(results.flatMap(r => r.recommendations))];

  // Average the scores
  const avgScore = Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length);

  // Document satisfies if majority of chunks say yes
  const satisfiesCount = results.filter(r => r.satisfiesRequirement).length;
  const satisfies = satisfiesCount > results.length / 2;

  return {
    satisfiesRequirement: satisfies,
    findings: allFindings,
    gaps: allGaps,
    score: avgScore,
    recommendations: allRecs,
    usage: totalUsage,
    model: results[0]?.model || PRIMARY_MODEL,
  };
}

// ─── Concurrency-limited parallel document processing ───────────────────────

/**
 * Process multiple documents with controlled concurrency.
 * Unlike Promise.all with fixed batches, this uses a semaphore pattern
 * so new documents start as soon as any slot frees up.
 */
export async function processDocumentsParallel<T>(
  items: T[],
  processor: (item: T) => Promise<void>,
  concurrency = MAX_CONCURRENCY,
): Promise<void> {
  let running = 0;
  let index = 0;

  return new Promise((resolve, reject) => {
    let hasError = false;

    function next() {
      if (hasError) return;
      if (index >= items.length && running === 0) {
        resolve();
        return;
      }

      while (running < concurrency && index < items.length) {
        const item = items[index++];
        running++;
        processor(item)
          .catch(err => {
            console.error('[AssuranceDoc:Parallel] Task failed:', err);
            // Don't reject — continue processing remaining items
          })
          .finally(() => {
            running--;
            next();
          });
      }
    }

    next();
  });
}
