import { NextRequest, NextResponse, after } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import OpenAI from 'openai';
import { buildCorpusForFirm, findCanonical, topExamples, normaliseDescription } from '@/lib/tb-ai-corpus';

export const maxDuration = 120; // Allow up to 2 minutes for large TB classification

const CATEGORY_TO_STATEMENT: Record<string, string> = {
  pnl: 'Profit & Loss',
  balance_sheet: 'Balance Sheet',
  cashflow: 'Cash Flow Statement',
  notes: 'Notes',
};

const apiKey = process.env.TOGETHER_API_KEY || process.env.TOGETHER_DOC_SUMMARY_KEY || '';

/**
 * Resolve a fuzzy fsLevel/fsNoteLevel string to a canonical MethodologyFsLine ID.
 * This is the ONE place fuzzy matching happens — at classification time, not render time.
 */
function resolveFsLineId(
  fsLines: { id: string; name: string; lineType: string; fsCategory: string }[],
  fsLevel?: string | null,
  fsNoteLevel?: string | null,
): string | null {
  if (!fsLevel && !fsNoteLevel) return null;

  const stop = new Set(['and', 'at', 'the', 'of', 'in', '&', 'due', 'within', 'one', 'year', 'after', 'other']);
  function words(s: string) { return new Set(s.toLowerCase().split(/[\s\-\/]+/).filter(w => w.length > 1 && !stop.has(w))); }
  function overlap(a: Set<string>, b: Set<string>) { let n = 0; for (const w of a) if (b.has(w)) n++; return a.size === 0 ? 0 : n / Math.max(a.size, b.size); }

  function findBest(name: string): string | null {
    const lc = name.toLowerCase().trim();
    // 1. Exact match
    const exact = fsLines.find(fl => fl.name.toLowerCase().trim() === lc);
    if (exact) return exact.id;
    // 2. Contains match
    const contains = fsLines.find(fl => { const fn = fl.name.toLowerCase(); return fn.includes(lc) || lc.includes(fn); });
    if (contains) return contains.id;
    // 3. Keyword overlap (50% threshold)
    const nameWords = words(name);
    let bestId: string | null = null, bestScore = 0;
    for (const fl of fsLines) {
      const score = overlap(nameWords, words(fl.name));
      if (score > bestScore) { bestScore = score; bestId = fl.id; }
    }
    if (bestScore >= 0.5 && bestId) return bestId;
    return null;
  }

  // Try fsLevel first (the primary FS Line), then fsNoteLevel
  return findBest(fsLevel || '') || findBest(fsNoteLevel || '');
}
const client = new OpenAI({
  apiKey,
  baseURL: 'https://api.together.xyz/v1',
});

const MODEL = process.env.TOGETHER_CLASSIFY_MODEL || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

/**
 * POST /api/engagements/[engagementId]/ai-classify-tb
 * Uses AI to classify trial balance rows into FS Note, FS Level, FS Statement.
 *
 * Body: { rows: [{ index, accountCode, description, currentYear }] }
 * Returns: { classifications: [{ index, fsNoteLevel, fsLevel, fsStatement }] }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ engagementId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { engagementId } = await params;
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;
  const firmId = session.user.firmId;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { auditType: true, firmId: true, clientId: true },
  });

  if (!engagement || (engagement.firmId !== firmId && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!apiKey) {
    return NextResponse.json({ error: 'AI service not configured (TOGETHER_API_KEY missing)' }, { status: 503 });
  }

  console.log(`[AI Classify] Using model: ${MODEL}, API key prefix: ${apiKey.slice(0, 8)}...`);

  const body = await req.json();

  // If action=poll, check background task status
  if (body.action === 'poll' && body.taskId) {
    const task = await prisma.backgroundTask.findUnique({ where: { id: body.taskId } });
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    return NextResponse.json({ status: task.status, progress: task.progress, error: task.error, result: task.result });
  }

  // Standalone backfill: resolve fsLineId for existing TB rows without re-running AI classification
  if (body.action === 'backfill_fs_line_ids') {
    const fsLines = await prisma.methodologyFsLine.findMany({
      where: { firmId, isActive: true },
      select: { id: true, name: true, lineType: true, fsCategory: true },
    });

    const unresolved = await prisma.auditTBRow.findMany({
      where: { engagementId, fsLevel: { not: null }, fsLineId: null },
      select: { id: true, fsLevel: true, fsNoteLevel: true },
    });

    let backfilled = 0;
    let skipped = 0;
    for (const row of unresolved) {
      const resolved = resolveFsLineId(fsLines, row.fsLevel, row.fsNoteLevel);
      if (resolved) {
        await prisma.auditTBRow.update({ where: { id: row.id }, data: { fsLineId: resolved } });
        backfilled++;
      } else {
        skipped++;
      }
    }

    // Also backfill test_executions and audit_test_conclusions using their fsLine name
    // Both of these have fsLine as a required String, so we only filter on blank fsLineId.
    let testExecBackfilled = 0;
    const unresolvedExecs = await prisma.testExecution.findMany({
      where: { engagementId, fsLineId: null },
      select: { id: true, fsLine: true },
    });
    for (const exec of unresolvedExecs) {
      const resolved = resolveFsLineId(fsLines, exec.fsLine, null);
      if (resolved) {
        await prisma.testExecution.update({ where: { id: exec.id }, data: { fsLineId: resolved } });
        testExecBackfilled++;
      }
    }

    let concBackfilled = 0;
    const unresolvedConcs = await prisma.auditTestConclusion.findMany({
      where: { engagementId, fsLineId: null },
      select: { id: true, fsLine: true },
    });
    for (const conc of unresolvedConcs) {
      const resolved = resolveFsLineId(fsLines, conc.fsLine, null);
      if (resolved) {
        await prisma.auditTestConclusion.update({ where: { id: conc.id }, data: { fsLineId: resolved } });
        concBackfilled++;
      }
    }

    return NextResponse.json({
      success: true,
      tbRows: { total: unresolved.length, backfilled, skipped },
      testExecutions: { total: unresolvedExecs.length, backfilled: testExecBackfilled },
      testConclusions: { total: unresolvedConcs.length, backfilled: concBackfilled },
    });
  }

  const { rows } = body;
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'rows array required' }, { status: 400 });
  }

  // Create background task and return immediately
  const task = await prisma.backgroundTask.create({
    data: { userId: session.user.id, type: 'ai-classify-tb', status: 'running', progress: { phase: 'starting', classified: 0, total: rows.length } as any },
  });

  // Process in background — continues even if user navigates away
  after(async () => {
    try {
      // Load the firm's FS Lines hierarchy for context
      const fsLines = await prisma.methodologyFsLine.findMany({
        where: { firmId, isActive: true },
        include: { parent: { select: { id: true, name: true, fsCategory: true } } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });

      const fsLineItems = fsLines
        .filter(l => l.lineType === 'fs_line_item')
        .map(l => `${l.name} (${CATEGORY_TO_STATEMENT[l.fsCategory] || l.fsCategory})`);

      const noteItems = fsLines
        .filter(l => l.lineType === 'note_item')
        .map(l => {
          const parent = l.parent;
          return `${l.name} → parent: ${parent?.name || 'none'} (${parent ? CATEGORY_TO_STATEMENT[parent.fsCategory] || parent.fsCategory : l.fsCategory})`;
        });

      const systemPrompt = `You are a financial statement classification expert for UK statutory audits.

Given trial balance account descriptions, classify each into:
- fsNoteLevel: The specific note disclosure item (e.g. "Trade Debtors", "Revenue", "Depreciation")
- fsLevel: The aggregated FS line item it belongs to (e.g. "Debtors", "Revenue", "Fixed Assets")
- fsStatement: Which financial statement (exactly one of: "Profit & Loss", "Balance Sheet", "Cash Flow Statement")

CRITICAL — Accounting System Type OVERRIDES description:
When a "Type" field is provided from the accounting system, it is the AUTHORITATIVE classification.
The account description/name may be misleading — always trust the Type over the description.
Key Type mappings:
- Type: BANK → ALWAYS "Cash at Bank", fsStatement "Balance Sheet"
- Type: REVENUE → ALWAYS Revenue, fsStatement "Profit & Loss"
- Type: DIRECTCOSTS → ALWAYS Cost of Sales, fsStatement "Profit & Loss"
- Type: EXPENSE or OVERHEADS → ALWAYS Expenses/Administrative Expenses, fsStatement "Profit & Loss"
- Type: FIXED → ALWAYS Fixed Assets, fsStatement "Balance Sheet"
- Type: CURRENT → ALWAYS Current Assets (Debtors), fsStatement "Balance Sheet"
- Type: CURRLIAB → ALWAYS Current Liabilities (Creditors), fsStatement "Balance Sheet"
- Type: TERMLIAB → ALWAYS Non-Current Liabilities, fsStatement "Balance Sheet"
- Type: EQUITY → ALWAYS Capital & Reserves, fsStatement "Balance Sheet"
- Type: OTHERINCOME → ALWAYS Other Income, fsStatement "Profit & Loss"
- Type: INVENTORY → ALWAYS Stock/Inventory, fsStatement "Balance Sheet"
- Type: PREPAYMENT → ALWAYS Prepayments (Debtors), fsStatement "Balance Sheet"
- Type: DEPRECIATN → ALWAYS Depreciation, fsStatement "Profit & Loss"
Also: accounts with NO account code (null/empty) are typically bank accounts in Xero.

Additional description-based rules (only when Type is not provided):
- Sales, revenue, turnover, fees, commissions → fsLevel "Revenue", fsStatement "Profit & Loss"
- Cost of sales, direct costs, materials → fsLevel "Cost of Sales", fsStatement "Profit & Loss"
- Wages, salaries, NI, pensions, staff costs → fsLevel "Administrative Expenses", fsStatement "Profit & Loss"
- Rent, utilities, insurance, repairs, office costs → fsLevel "Administrative Expenses", fsStatement "Profit & Loss"
- Depreciation CHARGE → fsLevel "Depreciation", fsStatement "Profit & Loss"
- ACCUMULATED depreciation (contra asset) → fsLevel "Tangible Fixed Assets", fsStatement "Balance Sheet"
- Interest, bank charges → fsLevel "Interest", fsStatement "Profit & Loss"
- Tax, corporation tax → fsLevel "Taxation", fsStatement "Profit & Loss"
- Trade debtors, prepayments, other debtors, VAT recoverable → fsLevel "Debtors", fsStatement "Balance Sheet"
- Cash, bank → fsLevel "Cash at Bank", fsStatement "Balance Sheet"
- Trade creditors, accruals, other creditors, VAT payable → fsLevel "Creditors", fsStatement "Balance Sheet"
- Loans, HP, mortgages → fsLevel "Loans & Borrowings", fsStatement "Balance Sheet"
- Fixed assets, plant, equipment → fsLevel "Tangible Fixed Assets", fsStatement "Balance Sheet"
- Share capital, reserves, retained earnings, dividends → fsLevel "Capital & Reserves", fsStatement "Balance Sheet"

The firm has these FS Line Items configured:
${fsLineItems.join('\n')}

And these Note Items (with parents):
${noteItems.join('\n')}

Prefer matching to existing configured items where possible.

Respond with a JSON object of the form:
{ "classifications": [ { "index": <number>, "fsNoteLevel": "<string>", "fsLevel": "<string>", "fsStatement": "<string>", "confidence": <number 0-100> }, ... ] }
Return exactly one entry per input row. No prose, no markdown.`;

      // Load all TB rows from DB for matching
      const tbRowsDb = await prisma.auditTBRow.findMany({
        where: { engagementId },
        select: { id: true, accountCode: true },
        orderBy: { sortOrder: 'asc' },
      });

      let totalClassified = 0;
      let totalLlmFailures = 0;
      const failureSamples: string[] = [];

      /**
       * Robust JSON extraction for LLM responses. Handles:
       *   - plain object `{ classifications: [...] }`
       *   - plain array `[...]` (older prompt form)
       *   - code-fenced blocks
       *   - preamble/commentary around the JSON
       *   - single trailing commas
       */
      function extractClassifications(raw: string): any[] {
        if (!raw) return [];
        let s = raw.trim();
        // Strip code fences
        s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
        // Try direct parse first
        const tryParse = (txt: string): any[] | null => {
          try {
            const v = JSON.parse(txt);
            if (Array.isArray(v)) return v;
            if (v && Array.isArray(v.classifications)) return v.classifications;
            if (v && Array.isArray(v.rows)) return v.rows;
            return null;
          } catch { return null; }
        };
        let got = tryParse(s);
        if (got) return got;
        // Try removing trailing commas (common LLM mistake)
        got = tryParse(s.replace(/,(\s*[}\]])/g, '$1'));
        if (got) return got;
        // Scan for the first balanced array `[...]`
        const firstBracket = s.indexOf('[');
        const lastBracket = s.lastIndexOf(']');
        if (firstBracket >= 0 && lastBracket > firstBracket) {
          const sliced = s.slice(firstBracket, lastBracket + 1);
          got = tryParse(sliced) || tryParse(sliced.replace(/,(\s*[}\]])/g, '$1'));
          if (got) return got;
        }
        // Scan for the first balanced object `{...classifications...}`
        const firstBrace = s.indexOf('{');
        const lastBrace = s.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
          const sliced = s.slice(firstBrace, lastBrace + 1);
          got = tryParse(sliced) || tryParse(sliced.replace(/,(\s*[}\]])/g, '$1'));
          if (got) return got;
        }
        return [];
      }

      // ── Firm-wide learning corpus ────────────────────────────────
      // Built from past auditor classifications across every engagement
      // (snapshots captured on TB-tab unmount, aggregated by
      // buildCorpusForFirm). Two uses:
      //   1. Short-circuit — when an incoming row's description has a
      //      confident canonical answer, return it immediately without
      //      bothering the LLM. Faster, cheaper, and more consistent.
      //   2. Few-shot — otherwise, prepend the top ~20 most-confident
      //      corpus entries to the system prompt so the LLM has real
      //      examples of this firm's preferred classifications.
      const corpus = await buildCorpusForFirm(firmId);
      // Build a few-shot examples block to add to the system prompt.
      // Compact format: "<description> → <note> / <level> / <stmt>"
      const examples = topExamples(corpus, 20);
      const fewShotBlock = examples.length > 0
        ? `\n\nFIRM'S CANONICAL EXAMPLES (real auditor classifications from past engagements — prefer these patterns):\n` +
          examples.map(e => `- "${e.description}" → ${e.canonical.fsNoteLevel || ''} / ${e.canonical.fsLevel || ''} / ${e.canonical.fsStatement || ''} (${e.consensusCount}/${e.sampleCount} agree)`).join('\n')
        : '';
      const systemPromptWithCorpus = systemPrompt + fewShotBlock;

      // Process in batches of 30
      for (let i = 0; i < rows.length; i += 30) {
        const batch = rows.slice(i, i + 30);

        // Split batch into corpus-hits (confident historical answer
        // exists) vs needs-LLM. The hits are classified instantly
        // from the canonical map; only the rest go to the LLM.
        const corpusHits: Array<{ index: number; fsNoteLevel: string | null; fsLevel: string | null; fsStatement: string | null; aiConfidence: number }> = [];
        const needsLlm: any[] = [];
        for (const r of batch) {
          const canonical = findCanonical(corpus, r.description);
          if (canonical) {
            corpusHits.push({
              index: r.index,
              fsNoteLevel: canonical.fsNoteLevel,
              fsLevel: canonical.fsLevel,
              fsStatement: canonical.fsStatement,
              aiConfidence: 0.99, // Corpus lookups are high-confidence by definition
            });
          } else {
            needsLlm.push(r);
          }
        }

        await prisma.backgroundTask.update({
          where: { id: task.id },
          data: { progress: { phase: 'classifying', classified: totalClassified, total: rows.length, batch: `${i + 1}–${Math.min(i + 30, rows.length)}`, corpusHits: corpusHits.length, llmRows: needsLlm.length } as any },
        });

        // Apply corpus hits to DB immediately — no LLM needed.
        for (const hit of corpusHits) {
          const sourceRow = batch.find((r: any) => r.index === hit.index);
          if (!sourceRow) continue;
          const dbRow = tbRowsDb.find(r => r.accountCode === sourceRow.accountCode);
          if (dbRow && (hit.fsNoteLevel || hit.fsLevel || hit.fsStatement)) {
            const resolvedFsLineId = resolveFsLineId(fsLines, hit.fsLevel, hit.fsNoteLevel);
            await prisma.auditTBRow.update({
              where: { id: dbRow.id },
              data: {
                fsNoteLevel: hit.fsNoteLevel || undefined,
                fsLevel: hit.fsLevel || undefined,
                fsLineId: resolvedFsLineId || undefined,
                fsStatement: hit.fsStatement || undefined,
                aiConfidence: hit.aiConfidence,
              } as any,
            });
            totalClassified++;
          }
        }

        // If everything in this batch was a corpus hit, skip the LLM
        // call entirely and move to the next batch.
        if (needsLlm.length === 0) continue;

        const rowDescriptions = needsLlm
          .map((r: any) => {
            let line = `[${r.index}] Code: "${r.accountCode || ''}" | Desc: "${r.description || ''}" | Amount: ${r.currentYear ?? 'nil'}`;
            if (r.sourceMetadata) {
              const meta = r.sourceMetadata;
              if (meta.xeroType) line += ` | Type: ${meta.xeroType}`;
              if (meta.xeroClass) line += ` | Class: ${meta.xeroClass}`;
              if (meta.xeroDescription) line += ` | Detail: ${meta.xeroDescription}`;
            }
            if (r.category) line += ` | Category: ${r.category}`;
            return line;
          })
          .join('\n');

        try {
          // Try up to 2 passes: first with json_object mode (strict
          // JSON); if that errors on the model side, retry without.
          let responseText = '';
          let usage: any = null;
          try {
            const completion = await client.chat.completions.create({
              model: MODEL,
              messages: [
                { role: 'system', content: systemPromptWithCorpus },
                { role: 'user', content: rowDescriptions },
              ],
              max_tokens: 4096,
              temperature: 0.1,
              // Together.ai supports json_object mode on Llama 3.3 / Qwen models.
              // Cast because the OpenAI SDK's type requires schema vars we don't need.
              response_format: { type: 'json_object' } as any,
            });
            responseText = completion.choices[0]?.message?.content || '';
            usage = completion.usage;
          } catch (jsonModeErr: any) {
            console.warn('[AI Classify] json_object mode failed — falling back:', jsonModeErr?.message);
            const completion = await client.chat.completions.create({
              model: MODEL,
              messages: [
                { role: 'system', content: systemPromptWithCorpus },
                { role: 'user', content: rowDescriptions },
              ],
              max_tokens: 4096,
              temperature: 0.1,
            });
            responseText = completion.choices[0]?.message?.content || '';
            usage = completion.usage;
          }

          const classifications = extractClassifications(responseText);
          if (classifications.length === 0) {
            totalLlmFailures += needsLlm.length;
            if (failureSamples.length < 3) {
              failureSamples.push(responseText.slice(0, 300));
            }
            console.error(`[AI Classify] Batch ${i}–${i + 30}: could not parse LLM response. First 500 chars:`, responseText.slice(0, 500));
          }

          // Save each classification directly to DB — resolve fsLineId from canonical FS Lines
          for (const c of classifications) {
            const sourceRow = batch.find((r: any) => r.index === c.index);
            if (!sourceRow) continue;
            const dbRow = tbRowsDb.find(r => r.accountCode === sourceRow.accountCode);
            if (dbRow && (c.fsNoteLevel || c.fsLevel || c.fsStatement)) {
              // Resolve fsLineId: match AI's fuzzy fsLevel to canonical MethodologyFsLine
              const resolvedFsLineId = resolveFsLineId(fsLines, c.fsLevel, c.fsNoteLevel);
              await prisma.auditTBRow.update({
                where: { id: dbRow.id },
                data: {
                  fsNoteLevel: c.fsNoteLevel || undefined,
                  fsLevel: c.fsLevel || undefined,
                  fsLineId: resolvedFsLineId || undefined,
                  fsStatement: c.fsStatement || undefined,
                  aiConfidence: c.confidence ?? null,
                },
              });
              totalClassified++;
            }
          }

          // Log AI usage
          try {
            await prisma.aiUsage.create({
              data: {
                clientId: engagement!.clientId,
                userId: session.user.id,
                action: 'TB Classification',
                model: MODEL,
                operation: 'classify_tb_rows',
                promptTokens: usage?.prompt_tokens || 0,
                completionTokens: usage?.completion_tokens || 0,
                totalTokens: usage?.total_tokens || 0,
                estimatedCostUsd: ((usage?.prompt_tokens || 0) * 0.0008 + (usage?.completion_tokens || 0) * 0.0008) / 1000,
              },
            });
          } catch {}
        } catch (err: any) {
          console.error(`[AI Classify] Batch ${i}–${i + 30} failed:`, err?.message);
          totalLlmFailures += needsLlm.length;
          if (failureSamples.length < 3 && err?.message) {
            failureSamples.push(`LLM error: ${String(err.message).slice(0, 200)}`);
          }
          // Continue with next batch
        }
      }

      // Backfill: resolve fsLineId for any rows that have fsLevel but no fsLineId (covers existing data)
      let backfilled = 0;
      const unresolved = await prisma.auditTBRow.findMany({
        where: { engagementId, fsLevel: { not: null }, fsLineId: null },
        select: { id: true, fsLevel: true, fsNoteLevel: true },
      });
      for (const row of unresolved) {
        const resolved = resolveFsLineId(fsLines, row.fsLevel, row.fsNoteLevel);
        if (resolved) {
          await prisma.auditTBRow.update({ where: { id: row.id }, data: { fsLineId: resolved } });
          backfilled++;
        }
      }

      await prisma.backgroundTask.update({
        where: { id: task.id },
        data: {
          status: 'completed',
          result: {
            classified: totalClassified,
            total: rows.length,
            backfilled,
            llmFailures: totalLlmFailures,
            failureSamples,
          } as any,
        },
      });
    } catch (err: any) {
      console.error('[AI Classify] Background task failed:', err);
      await prisma.backgroundTask.update({
        where: { id: task.id },
        data: { status: 'error', error: err.message || 'Classification failed' },
      });
    }
  });

  return NextResponse.json({ taskId: task.id, status: 'running', total: rows.length });
}
