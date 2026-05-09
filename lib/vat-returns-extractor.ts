/**
 * VAT-return PDF extractor.
 *
 * Wired in by the firm-side commit on a portal request whose section is
 * 'vat_returns' (the request created by the "Request VAT returns via
 * portal" button on the VAT Reconciliation panel). Each PDF the client
 * attached gets downloaded from Azure Blob, the text is pulled out with
 * the standard `processPdf` pipeline, and a Together AI Llama call
 * produces a strict JSON shape with period end + the four figures the
 * grid needs.
 *
 * Output is matched back into the engagement's
 * audit_vat_reconciliations.data.periodRows by closest periodEnding
 * date so the existing pro-rata / HMRC running-balance maths picks the
 * figures up automatically.
 */

import { processPdf } from '@/lib/pdf-to-images';
import { downloadBlob } from '@/lib/azure-blob';
import type { VatPeriodRow } from '@/lib/vat-reconciliation';

export interface ExtractedVatReturn {
  periodEnding: string;       // ISO YYYY-MM-DD, '' if AI could not determine
  netRevenue: number | null;
  netPurchases: number | null;
  salesVat: number | null;
  purchaseVat: number | null;
  sourceFileName: string;
}

const VAT_EXTRACTION_SYSTEM_PROMPT = `You are extracting figures from a UK or Republic of Ireland VAT return / BAS / GST return PDF for an external audit. Return ONLY a strict JSON object — no markdown fencing, no commentary.

Schema:
{
  "periodEnding": "YYYY-MM-DD" | "",   // VAT-period END date (the last day of the period the return covers). Empty string if the document doesn't reliably state one.
  "netRevenue":   number | null,        // Box 6 / Total value of sales (excluding VAT) for the period. Net of VAT.
  "netPurchases": number | null,        // Box 7 / Total value of purchases (excluding VAT) for the period. Net of VAT.
  "salesVat":     number | null,        // Box 1 / VAT due on sales (output VAT) for the period.
  "purchaseVat":  number | null         // Box 4 / VAT reclaimed on purchases (input VAT) for the period.
}

Rules:
- Read figures verbatim from the document. Ignore any "year to date" or "annual summary" totals — only the figures that pertain to the SINGLE return period the document covers.
- Strip currency symbols, comma thousand-separators, and trailing CR/DR markers — return raw numbers.
- A negative figure (e.g. credit / refund) must be returned as a negative number.
- If a figure is genuinely missing or unreadable, return null for that field. Do not guess.
- For UK VAT returns the relevant boxes are typically labelled Box 1 (Sales VAT), Box 4 (Purchase VAT), Box 6 (Net Revenue), Box 7 (Net Purchases). For ROI / Australian / NZ filings use the equivalent labels in those forms.
- The period-ending date is the END of the period covered by the return, NOT the date the return was filed or signed.
- Return strict JSON only.`;

/**
 * Extract one VAT return from a PDF buffer. Tolerates short / scanned
 * PDFs by returning a sentinel "no figures" object — the commit
 * handler logs and skips the upload rather than crashing.
 */
export async function extractVatReturnFromPdf(
  buffer: Buffer,
  fileName: string,
): Promise<ExtractedVatReturn> {
  const empty: ExtractedVatReturn = {
    periodEnding: '',
    netRevenue: null,
    netPurchases: null,
    salesVat: null,
    purchaseVat: null,
    sourceFileName: fileName,
  };
  let text = '';
  try {
    const pdf = await processPdf(buffer, 5);
    text = (pdf.text || '').trim();
  } catch (err) {
    console.warn(`[vat-returns-extractor] processPdf failed on ${fileName}:`, err instanceof Error ? err.message : err);
    return empty;
  }
  if (text.length < 50) {
    console.warn(`[vat-returns-extractor] ${fileName} produced only ${text.length} chars of text — skipping AI call`);
    return empty;
  }

  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    console.warn('[vat-returns-extractor] TOGETHER_API_KEY not configured — cannot run extraction');
    return empty;
  }

  const userMessage = `VAT Return PDF text (filename: ${fileName}):\n\n${text.slice(0, 30000)}`;

  let aiText = '';
  try {
    const res = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        messages: [
          { role: 'system', content: VAT_EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 600,
        temperature: 0,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[vat-returns-extractor] Together AI ${res.status} on ${fileName}: ${body.slice(0, 200)}`);
      return empty;
    }
    const data = await res.json();
    aiText = (data.choices?.[0]?.message?.content || '').trim();
  } catch (err) {
    console.warn(`[vat-returns-extractor] Together AI call failed on ${fileName}:`, err instanceof Error ? err.message : err);
    return empty;
  }

  // Strip code fencing the model sometimes emits despite the prompt.
  aiText = aiText.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();

  let parsed: any;
  try {
    parsed = JSON.parse(aiText);
  } catch {
    console.warn(`[vat-returns-extractor] non-JSON AI response on ${fileName}: ${aiText.slice(0, 200)}`);
    return empty;
  }

  const isoDate = typeof parsed.periodEnding === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.periodEnding.trim())
    ? parsed.periodEnding.trim()
    : '';

  return {
    periodEnding: isoDate,
    netRevenue: toNumberOrNull(parsed.netRevenue),
    netPurchases: toNumberOrNull(parsed.netPurchases),
    salesVat: toNumberOrNull(parsed.salesVat),
    purchaseVat: toNumberOrNull(parsed.purchaseVat),
    sourceFileName: fileName,
  };
}

function toNumberOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[,£$€\s]/g, '').replace(/CR$/i, '').replace(/DR$/i, '').trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Download every portal upload attached to a vat_returns request,
 * extract each in turn, and return the structured results. Errors
 * inside one upload don't sink the rest — the failed upload contributes
 * an empty object that the merge step skips.
 */
export async function extractVatReturnsFromUploads(
  uploads: { storagePath: string; containerName: string | null; originalName: string }[],
): Promise<ExtractedVatReturn[]> {
  const out: ExtractedVatReturn[] = [];
  for (const u of uploads) {
    try {
      const buf = await downloadBlob(u.storagePath, u.containerName || 'upload-inbox');
      const ex = await extractVatReturnFromPdf(buf, u.originalName);
      out.push(ex);
    } catch (err) {
      console.warn(`[vat-returns-extractor] download/extract failed on ${u.originalName}:`, err instanceof Error ? err.message : err);
      out.push({
        periodEnding: '', netRevenue: null, netPurchases: null,
        salesVat: null, purchaseVat: null, sourceFileName: u.originalName,
      });
    }
  }
  return out;
}

/**
 * Merge a batch of extracted VAT returns into an engagement's existing
 * periodRows. Each extraction is matched to the row with the closest
 * periodEnding date (within 45 days — wide enough to absorb minor
 * cut-off / filing-period shifts but tight enough that an annual return
 * doesn't get assigned to a quarterly row by accident). Manual values
 * the auditor has already typed are preserved unless the extraction
 * actually carries a number — null fields never overwrite live values.
 *
 * Returns the patched periodRows array and a per-extraction report so
 * the caller can log which uploads landed where.
 */
export interface MergeReport {
  fileName: string;
  matchedRowId: string | null;
  matchedRowDate: string | null;
  reason: string;
}

export function mergeExtractionsIntoPeriodRows(
  rows: VatPeriodRow[],
  extractions: ExtractedVatReturn[],
): { rows: VatPeriodRow[]; report: MergeReport[] } {
  const report: MergeReport[] = [];
  const next = rows.map(r => ({ ...r }));

  for (const ex of extractions) {
    if (!ex.periodEnding && ex.netRevenue == null && ex.netPurchases == null && ex.salesVat == null && ex.purchaseVat == null) {
      report.push({ fileName: ex.sourceFileName, matchedRowId: null, matchedRowDate: null, reason: 'extraction empty — nothing to merge' });
      continue;
    }
    if (!ex.periodEnding) {
      report.push({ fileName: ex.sourceFileName, matchedRowId: null, matchedRowDate: null, reason: 'extraction had no period-ending date — cannot match to a row' });
      continue;
    }
    const target = pickClosestRow(next, ex.periodEnding);
    if (!target) {
      report.push({ fileName: ex.sourceFileName, matchedRowId: null, matchedRowDate: null, reason: 'no period row within ±45 days' });
      continue;
    }
    // Only overwrite fields the extraction actually carries.
    if (ex.netRevenue != null) target.netRevenue = ex.netRevenue;
    if (ex.netPurchases != null) target.netPurchases = ex.netPurchases;
    if (ex.salesVat != null) target.salesVat = ex.salesVat;
    if (ex.purchaseVat != null) target.purchaseVat = ex.purchaseVat;
    report.push({
      fileName: ex.sourceFileName,
      matchedRowId: target.id,
      matchedRowDate: target.periodEnding,
      reason: 'merged',
    });
  }

  return { rows: next, report };
}

function pickClosestRow(rows: VatPeriodRow[], targetIso: string): VatPeriodRow | null {
  const target = new Date(targetIso).getTime();
  if (!Number.isFinite(target)) return null;
  let best: VatPeriodRow | null = null;
  let bestDelta = Infinity;
  for (const r of rows) {
    if (r.isOpening) continue;          // opening row is for prior-period b/f, never a return
    const t = new Date(r.periodEnding).getTime();
    if (!Number.isFinite(t)) continue;
    const delta = Math.abs(t - target);
    if (delta < bestDelta) { bestDelta = delta; best = r; }
  }
  // 45 days = wide enough for monthly / quarterly / annual cut-off
  // shifts, narrow enough to keep an annual return out of a quarterly
  // slot.
  if (best && bestDelta <= 45 * 86_400_000) return best;
  return null;
}
