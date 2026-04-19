/**
 * Trial-Balance AI classifier corpus.
 *
 * The classifier writes per-row snapshots into ActivityLog whenever
 * an auditor leaves the TBCYvPY tab. Over time these snapshots
 * accumulate into a rich source-of-truth corpus:
 *
 *   "description X" → most-commonly-chosen {fsNoteLevel, fsLevel, fsStatement}
 *
 * This module aggregates the raw snapshots into that canonical
 * mapping, plus the evidence (how many times each answer appeared)
 * so the admin can judge confidence. The classifier endpoint uses
 * `findCanonical()` to short-circuit the LLM call when a confident
 * historical answer exists for an incoming description, and uses
 * `topExamples()` to seed the LLM's few-shot examples otherwise.
 */

import { prisma } from '@/lib/db';

export interface CorpusRowSnapshot {
  accountCode: string;
  description: string;
  currentYear: number | null;
  aiSuggested: {
    fsNoteLevel: string | null;
    fsLevel: string | null;
    fsStatement: string | null;
    aiConfidence: number | null;
  } | null;
  final: {
    fsNoteLevel: string | null;
    fsLevel: string | null;
    fsStatement: string | null;
  };
}

export interface CorpusEntry {
  /** Normalised key we aggregate on — lower-case, collapsed whitespace. */
  descriptionKey: string;
  /** Most-commonly-seen original description (for display). */
  description: string;
  /** Total times we've seen this description in any snapshot. */
  sampleCount: number;
  /** Most-commonly-chosen final classification. Null-valued fields
   *  mean consensus couldn't be established (tie or always blank). */
  canonical: {
    fsNoteLevel: string | null;
    fsLevel: string | null;
    fsStatement: string | null;
  };
  /** How many of the samples landed on the canonical classification.
   *  `consensusCount / sampleCount` gives you confidence. */
  consensusCount: number;
  /** Count of samples where AI was consulted AND its suggestion
   *  exactly matched the auditor's final answer. */
  aiAcceptedCount: number;
  /** Count of samples where AI was consulted AND was overridden. */
  aiOverriddenCount: number;
  /** All distinct final classifications seen, with their counts —
   *  useful for the admin view to see dissenting options. */
  variants: Array<{
    fsNoteLevel: string | null;
    fsLevel: string | null;
    fsStatement: string | null;
    count: number;
  }>;
}

/** Normalise a description so trivial differences (trailing space,
 *  case, extra whitespace) don't fragment the corpus. */
export function normaliseDescription(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Build the corpus for a firm by reading every
 *  tb_ai_corpus_snapshot ActivityLog written to date. Aggregation
 *  is in-memory — at audit-firm scale we're talking hundreds-to-
 *  thousands of engagements × ~200 rows each, which fits easily.
 *
 *  If the ActivityLog model is absent on a given environment the
 *  function returns an empty array rather than throwing. */
export async function buildCorpusForFirm(firmId: string): Promise<CorpusEntry[]> {
  let rawRows: Array<{ detail: any }> = [];
  try {
    rawRows = await (prisma as any).activityLog?.findMany?.({
      where: {
        firmId,
        tool: 'tb-ai-classifier',
        action: 'tb_ai_corpus_snapshot',
      },
      select: { detail: true },
      orderBy: { createdAt: 'desc' },
      // A reasonable cap so we don't scan a million rows on a giant
      // firm — latest 5000 snapshots is plenty for this feature.
      take: 5000,
    }) ?? [];
  } catch {
    return [];
  }

  // Aggregate in memory. Structure: Map<normalisedDesc, {
  //   originalDescSeen: Map<rawDesc, count>,
  //   variantCounts: Map<"note|level|stmt", count>,
  //   aiAccepted: number, aiOverridden: number, total: number,
  // }>
  type Bucket = {
    originals: Map<string, number>;
    variants: Map<string, number>;
    total: number;
    aiAccepted: number;
    aiOverridden: number;
  };
  const buckets = new Map<string, Bucket>();

  for (const r of rawRows) {
    const rows: CorpusRowSnapshot[] = Array.isArray(r.detail?.rows) ? r.detail.rows : [];
    for (const snap of rows) {
      if (!snap?.description && !snap?.accountCode) continue;
      // Only rows with a real final classification teach us anything.
      const fNote = (snap.final?.fsNoteLevel ?? '') || '';
      const fLevel = (snap.final?.fsLevel ?? '') || '';
      const fStmt = (snap.final?.fsStatement ?? '') || '';
      if (!fNote && !fLevel && !fStmt) continue;
      const key = normaliseDescription(snap.description);
      if (!key) continue;
      let b = buckets.get(key);
      if (!b) {
        b = { originals: new Map(), variants: new Map(), total: 0, aiAccepted: 0, aiOverridden: 0 };
        buckets.set(key, b);
      }
      b.total++;
      b.originals.set(snap.description, (b.originals.get(snap.description) || 0) + 1);
      const variantKey = `${fNote}|${fLevel}|${fStmt}`;
      b.variants.set(variantKey, (b.variants.get(variantKey) || 0) + 1);
      // AI accept / override bookkeeping — only counts when the AI
      // was actually consulted on this row.
      if (snap.aiSuggested) {
        const aNote = snap.aiSuggested.fsNoteLevel || '';
        const aLevel = snap.aiSuggested.fsLevel || '';
        const aStmt = snap.aiSuggested.fsStatement || '';
        const aiMatched = aNote === fNote && aLevel === fLevel && aStmt === fStmt;
        if (aiMatched) b.aiAccepted++;
        else b.aiOverridden++;
      }
    }
  }

  // Emit one CorpusEntry per bucket with the majority classification
  // as "canonical". Ties resolved by first-seen order.
  const entries: CorpusEntry[] = [];
  for (const [key, b] of buckets.entries()) {
    if (b.total === 0) continue;
    const variants = [...b.variants.entries()]
      .map(([vKey, count]) => {
        const [fsNoteLevel, fsLevel, fsStatement] = vKey.split('|');
        return { fsNoteLevel: fsNoteLevel || null, fsLevel: fsLevel || null, fsStatement: fsStatement || null, count };
      })
      .sort((a, b) => b.count - a.count);
    const top = variants[0];
    const description = pickMostCommon(b.originals) || key;
    entries.push({
      descriptionKey: key,
      description,
      sampleCount: b.total,
      canonical: {
        fsNoteLevel: top?.fsNoteLevel || null,
        fsLevel: top?.fsLevel || null,
        fsStatement: top?.fsStatement || null,
      },
      consensusCount: top?.count || 0,
      aiAcceptedCount: b.aiAccepted,
      aiOverriddenCount: b.aiOverridden,
      variants,
    });
  }
  // Sort by highest override count first — the most valuable entries
  // for prompt tuning. Admin UI can resort client-side.
  entries.sort((a, b) => (b.aiOverriddenCount - a.aiOverriddenCount) || (b.sampleCount - a.sampleCount));
  return entries;
}

function pickMostCommon(m: Map<string, number>): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of m.entries()) {
    if (n > bestN) { best = k; bestN = n; }
  }
  return best;
}

/** Confidence threshold for auto-returning a corpus answer without
 *  hitting the LLM. We require BOTH a minimum sample count AND a
 *  minimum consensus fraction so a single outlier doesn't lock a
 *  wrong answer in place. */
export interface CorpusMatchOpts {
  minSamples?: number;
  minConsensus?: number; // 0..1
}
export const DEFAULT_CORPUS_MATCH: Required<CorpusMatchOpts> = {
  minSamples: 3,
  minConsensus: 0.75,
};

/** Look up a description in the corpus and return a classification
 *  if we have one with enough evidence. Returns null otherwise —
 *  caller should fall back to the LLM. */
export function findCanonical(
  entries: CorpusEntry[],
  description: string,
  opts: CorpusMatchOpts = {},
): CorpusEntry['canonical'] | null {
  const { minSamples, minConsensus } = { ...DEFAULT_CORPUS_MATCH, ...opts };
  const key = normaliseDescription(description);
  if (!key) return null;
  const e = entries.find(x => x.descriptionKey === key);
  if (!e) return null;
  if (e.sampleCount < minSamples) return null;
  if (e.consensusCount / e.sampleCount < minConsensus) return null;
  return e.canonical;
}

/** Return the top-K most confident corpus entries — used as
 *  few-shot examples in the classifier's LLM prompt when no direct
 *  match exists. */
export function topExamples(entries: CorpusEntry[], k: number = 20): CorpusEntry[] {
  return entries
    .filter(e => e.sampleCount >= DEFAULT_CORPUS_MATCH.minSamples)
    .filter(e => e.consensusCount / e.sampleCount >= DEFAULT_CORPUS_MATCH.minConsensus)
    .sort((a, b) => (b.consensusCount - a.consensusCount) || (b.sampleCount - a.sampleCount))
    .slice(0, k);
}
