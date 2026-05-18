import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Row-level AI Populate endpoint used by the Completion panel's
 * StructuredScheduleTab (Update Procedures, Completion Checklist,
 * Overall Review, Summary Memo).
 *
 * Client passes:
 *   - templateType  e.g. 'update_procedures_questions' — drives the mode
 *   - mode          'references' | 'procedure'
 *                   references: fill in a reference pointing at the tab
 *                               in the Client/Period file where the
 *                               procedure is covered (Update Procedures)
 *                   procedure:  write the procedure description based on
 *                               what's in the audit file (Completion
 *                               Checklist)
 *   - questionText  first-column text on the row
 *   - sectionLabel  (optional) section name to help the AI disambiguate
 *   - columnHeader  (optional) the target column header ("Reference", etc.)
 *
 * Server assembles broad engagement context (TB, materiality, RMM, test
 * conclusions, error schedule, walkthroughs, portal status), calls
 * Llama 3.3 70B with a mode-specific prompt, and returns:
 *   {
 *     text: string,
 *     references?: [{ tab, anchor?, label }]
 *   }
 *
 * References are clickable chips on the UI — the target tab is one of
 * the engagement's main tabs (rmm, materiality, walkthroughs, audit-plan,
 * portal, completion, etc.). Tabs that support scroll-to-anchor read the
 * `scroll` URL param on mount; others ignore it and the user scrolls
 * manually.
 */

type Ctx = { params: Promise<{ engagementId: string }> };

const MODEL_ID = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

const KNOWN_TABS = [
  'prior-period',
  'tbcyvpy',
  'materiality',
  'rmm',
  'portal',
  'walkthroughs',
  'ethics',
  'engagement-letter',
  'audit-plan',
  'completion',
] as const;

export async function POST(req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { engagementId } = await ctx.params;
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (engagement.firmId !== session.user.firmId && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const {
    templateType,
    mode,
    questionText,
    sectionLabel,
    columnHeader,
  }: {
    templateType?: string;
    mode?: 'references' | 'procedure';
    questionText?: string;
    sectionLabel?: string;
    columnHeader?: string;
  } = body || {};

  if (!questionText?.trim()) {
    return NextResponse.json({ error: 'questionText is required' }, { status: 400 });
  }
  const runMode = mode === 'procedure' || mode === 'references' ? mode : 'references';

  // ── Short-circuit for Significant Risks → Management Override of controls.
  // The MOC test produces a deterministic, structured run; route the cell
  // directly to the journal-risk module rather than asking the LLM to
  // synthesise from generic context.
  const isMocRow = /management\s+override\s+of\s+controls/i.test(questionText)
    && (sectionLabel ? /significant\s+risks/i.test(sectionLabel) : true);
  if (isMocRow) {
    const latestRun = await prisma.journalRiskRun.findFirst({
      where: { engagementId, status: 'completed' },
      orderBy: { createdAt: 'desc' },
    });
    if (latestRun) {
      const exceptionCount = await prisma.journalRiskEntry.count({ where: { runId: latestRun.id, testStatus: 'exception' } });
      const testedCount = await prisma.journalRiskEntry.count({
        where: { runId: latestRun.id, selected: true, testStatus: { in: ['tested', 'no_exception', 'exception'] } },
      });
      const errorScheduleCount = await prisma.journalRiskEntry.count({
        where: { runId: latestRun.id, errorScheduleId: { not: null } },
      });
      const aiFlagged = await prisma.journalRiskEntry.count({ where: { runId: latestRun.id, aiFlag: true } });
      const pop = latestRun.populationEvidence as { sourceSystem?: string; coverage?: { fromDate?: string; toDate?: string } };
      const ss = latestRun.selectionSummary as { layer1?: number; layer2?: number; layer3?: number };

      const sourceLabel = pop?.sourceSystem === 'xero' ? 'live Xero pull (manual journals)'
        : pop?.sourceSystem === 'xero_full' ? 'live Xero pull (full journals feed)'
        : pop?.sourceSystem === 'csv' ? 'client-provided CSV extract'
        : 'source system extract';

      const header = (columnHeader || '').toLowerCase();
      let text = '';
      if (header.includes('identified risk') || header.includes('risk')) {
        text = 'Management override of controls (ISA 240) — risk that management overrides controls to perpetrate fraud through inappropriate journal entries.';
      } else if (header.includes('procedure')) {
        text = [
          `Obtained the complete population of ${latestRun.totalJournals.toLocaleString()} journals (${pop?.coverage?.fromDate || ''} – ${pop?.coverage?.toDate || ''}, ${sourceLabel}).`,
          `Applied firm ISA 240 risk model across timing, user/access, content, description, accounting-risk and behaviour dimensions.`,
          `Selected ${latestRun.totalSelected.toLocaleString()} for testing: ${ss?.layer1 || 0} mandatory, ${ss?.layer2 || 0} targeted, ${ss?.layer3 || 0} unpredictable.`,
          aiFlagged > 0 ? `AI commentary flagged ${aiFlagged} additional description${aiFlagged === 1 ? '' : 's'} as vague/unusual; corroborated against the deterministic scoring.` : '',
          `Inspected supporting evidence for each selected journal and assessed business rationale and posting authority.`,
        ].filter(Boolean).join(' ');
      } else if (header.includes('conclusion')) {
        text = latestRun.conclusion || (exceptionCount === 0
          ? `Of the ${latestRun.totalSelected} journals selected, ${testedCount} tested with no exceptions identified. No evidence of management override of controls.`
          : `Of the ${latestRun.totalSelected} journals selected, ${testedCount} tested; ${exceptionCount} exception${exceptionCount === 1 ? '' : 's'} identified${errorScheduleCount > 0 ? ` (${errorScheduleCount} raised to the error schedule)` : ''}.`);
      } else if (header.includes('wp') || header.includes('ref')) {
        text = `MOC-${latestRun.runId.slice(0, 8)}`;
      } else {
        text = `MOC run ${latestRun.runId.slice(0, 8)} — ${latestRun.totalSelected} of ${latestRun.totalJournals} journals selected; ${exceptionCount} exceptions.`;
      }

      return NextResponse.json({
        text,
        references: [{ tab: 'audit-plan', anchor: 'management-override', label: 'MOC tab' }],
      });
    }
    // No run yet — fall through to AI populate, which will say so in plain English.
  }

  // ── Assemble engagement context ────────────────────────────────────────
  // We pull summary / aggregate data across the main audit areas so the
  // AI can reason about what's covered where. We deliberately avoid huge
  // raw dumps — each area contributes a compact fact list.
  const context: Record<string, any> = {};

  try {
    const mat = await prisma.auditMateriality.findFirst({
      where: { engagementId } as any,
      select: { data: true } as any,
    }) as any;
    if (mat?.data) {
      const d: any = mat.data;
      context.materiality = {
        performance: d.performanceMateriality ?? d.pm ?? null,
        overall: d.overallMateriality ?? d.materiality ?? null,
        clearlyTrivial: d.clearlyTrivial ?? null,
        benchmark: d.benchmark ?? d.benchmarkBasis ?? null,
      };
    }
  } catch {}

  try {
    // RMM rows: keep just descriptions, assertions and risk level.
    const rmm = await (prisma as any).rmm?.findMany?.({
      where: { engagementId },
      select: { id: true, riskDescription: true, assertion: true, fsLine: true, inherentRisk: true, controlRisk: true, isSignificantRisk: true },
    }) ?? [];
    if (Array.isArray(rmm) && rmm.length > 0) context.rmm = rmm.slice(0, 80);
  } catch {}

  try {
    const concs = await prisma.auditTestConclusion.findMany({
      where: { engagementId },
      select: { id: true, fsLine: true, testDescription: true, conclusion: true, status: true, totalErrors: true },
    });
    if (concs.length > 0) context.test_conclusions = concs.slice(0, 150).map(c => ({
      id: c.id,
      fsLine: c.fsLine,
      test: c.testDescription,
      conclusion: c.conclusion,
      status: c.status,
      totalErrors: c.totalErrors || 0,
    }));
  } catch {}

  try {
    const errs = await prisma.auditErrorSchedule.findMany({
      where: { engagementId },
      select: { id: true, fsLine: true, description: true, errorAmount: true, errorType: true, resolution: true },
    });
    if (errs.length > 0) context.errors = errs.slice(0, 80);
  } catch {}

  try {
    const portalRequestCount = await prisma.portalRequest.count({
      where: { engagementId },
    });
    const outstandingCount = await prisma.outstandingItem.count({
      where: { engagementId, status: { in: ['pending', 'awaiting_client', 'in_progress'] } },
    });
    context.portal = { totalRequests: portalRequestCount, stillOutstanding: outstandingCount };
  } catch {}

  try {
    // Walkthroughs summary — count + list names if the model exists.
    const walkthroughs = await (prisma as any).auditWalkthrough?.findMany?.({
      where: { engagementId },
      select: { id: true, processName: true, status: true },
    }) ?? [];
    if (walkthroughs.length > 0) context.walkthroughs = walkthroughs.slice(0, 40);
  } catch {}

  try {
    // TB summary — count of rows and a handful of top-value FS lines.
    // TB rows link to MethodologyFsLine via fsLineId — join to the name
    // so the AI sees friendly labels rather than UUIDs.
    const tbRows = await prisma.auditTBRow.findMany({
      where: { engagementId },
      select: {
        accountCode: true, description: true, currentYear: true, priorYear: true,
        fsStatement: true,
        canonicalFsLine: { select: { name: true } },
      },
    });
    if (tbRows.length > 0) {
      const byFsLine: Record<string, number> = {};
      for (const r of tbRows) {
        const fsLine = r.canonicalFsLine?.name;
        if (!fsLine) continue;
        byFsLine[fsLine] = (byFsLine[fsLine] || 0) + Math.abs(Number(r.currentYear) || 0);
      }
      const topFs = Object.entries(byFsLine)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([fsLine, total]) => ({ fsLine, total }));
      context.tb_summary = { rowCount: tbRows.length, topFsLines: topFs };
    }
  } catch {}

  // ── Call AI ────────────────────────────────────────────────────────────
  const apiKey = process.env.TOGETHER_API_KEY || '';
  if (!apiKey) {
    return NextResponse.json({ error: 'AI provider not configured' }, { status: 500 });
  }
  const client = new OpenAI({ apiKey, baseURL: 'https://api.together.xyz/v1' });

  const systemPrompt = runMode === 'references'
    ? `You are a UK statutory auditor filling in a completion file cell. The row asks where a particular procedure or point is already covered in the audit file. You must answer with:
(a) A concise reference text (≤ 160 chars) — naming the tab(s) and the specific item/row/section where the point is covered.
(b) A JSON array of clickable references pointing at the tabs the reader should open. Each reference: { "tab": one of ${KNOWN_TABS.map(t => `"${t}"`).join(' | ')}, "anchor": optional string, "label": short display label }.

ANCHOR FORMAT — each target tab's anchor is of the form "<tab>-<identifier>" using a stable id drawn from the context you're given:
  - rmm-<rmm.id>                     e.g. "rmm-abc123..."
  - audit-plan-<account_code>        e.g. "audit-plan-1000"
  - tbcyvpy-<account_code>           e.g. "tbcyvpy-1000"
  - portal-<portal_request_id>       e.g. "portal-def456..."
  - materiality-pm | materiality-clearly-trivial | materiality-benchmark (section keys)
  - walkthrough-<process_key>        e.g. "walkthrough-revenue"
If you cannot pick a specific anchor from the context, omit the anchor field and the UI will just open the tab at the top.

If there is no clear coverage in the audit file, say so honestly in (a) and return an empty references array.

Return ONLY JSON in this exact shape — no prose, no markdown fences:
{ "text": "...", "references": [ { "tab": "...", "anchor": "...", "label": "..." } ] }`
    : `You are a UK statutory auditor writing the procedure description for a completion checklist row based on what actually happened on this engagement. You must answer with a single concise paragraph (≤ 300 chars) describing the procedure that was performed on the file, drawing only on the context provided. If the context does not contain evidence that the procedure was performed, say that and recommend what the team should do.

Return ONLY JSON in this exact shape — no prose, no markdown fences:
{ "text": "...", "references": [] }`;

  const userPrompt = JSON.stringify({
    templateType,
    sectionLabel: sectionLabel || null,
    columnHeader: columnHeader || null,
    row_question: questionText,
    engagement_context: context,
  });

  let result;
  try {
    const response = await client.chat.completions.create({
      model: MODEL_ID,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 800,
      temperature: 0.1,
    });
    result = response.choices[0]?.message?.content || '';
  } catch (err: any) {
    console.error('[ai-populate-cell] AI call failed:', err?.message || err);
    return NextResponse.json({ error: 'AI call failed', detail: err?.message || 'Unknown error' }, { status: 502 });
  }

  // Parse JSON out of the AI output (strip any accidental markdown fence).
  const cleaned = result.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    return NextResponse.json({ text: cleaned.slice(0, 300), references: [] });
  }
  try {
    const parsed = JSON.parse(match[0]);
    const text = typeof parsed.text === 'string' ? parsed.text : '';
    const refsIn = Array.isArray(parsed.references) ? parsed.references : [];
    const references = refsIn
      .map((r: any) => ({
        tab: typeof r?.tab === 'string' ? r.tab : null,
        anchor: typeof r?.anchor === 'string' && r.anchor.length > 0 ? r.anchor : undefined,
        label: typeof r?.label === 'string' && r.label.length > 0 ? r.label : (r?.tab || ''),
      }))
      .filter((r: any) => r.tab && (KNOWN_TABS as readonly string[]).includes(r.tab));
    return NextResponse.json({ text, references });
  } catch (err: any) {
    console.warn('[ai-populate-cell] JSON parse failed — returning raw text');
    return NextResponse.json({ text: cleaned.slice(0, 300), references: [] });
  }
}
