import { NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { runJournalRiskAnalysis } from '@/lib/journal-risk/engine';
import { parseJournalsCsv, parseUsersCsv, parseAccountsCsv } from '@/lib/journal-risk/parseCsv';
import { validateJournals, validateUsers, validateAccounts, validateConfig } from '@/lib/journal-risk/validators';
import { buildDefaultConfig } from '@/lib/journal-risk/config-builder';
import { generateScoredCsv, generateMarkdownSummary } from '@/lib/journal-risk/reporting';
import { analyzeCoverage } from '@/lib/journal-risk/selection/coverage';
import { pullFromXero } from '@/lib/journal-risk/xero-pull';
import type { Config, JournalRecord, UserRecord, AccountRecord } from '@/lib/journal-risk/types';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, clientId: true, periodId: true },
  });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

/**
 * Load the firm's MOC suspicious-keyword overrides. Returns null when the
 * firm hasn't customised the list — the engine then falls back to its
 * built-in default.
 */
async function loadFirmKeywords(firmId: string): Promise<string[] | null> {
  try {
    const row = await prisma.methodologyRiskTable.findUnique({
      where: { firmId_tableType: { firmId, tableType: 'moc_suspicious_keywords' } },
    });
    const data = row?.data as { keywords?: unknown } | null | undefined;
    const list = data?.keywords;
    if (!Array.isArray(list)) return null;
    const cleaned = list.filter((k): k is string => typeof k === 'string' && k.trim().length > 0);
    return cleaned.length > 0 ? cleaned : null;
  } catch {
    return null;
  }
}

// GET — latest run summary or specific run
export async function GET(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  const engagement = await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!engagement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(req.url);
  const runId = url.searchParams.get('runId');

  // Sources status — tells the panel whether to show "Pull from Xero" /
  // request-from-client / CSV upload options.
  if (url.searchParams.get('sources')) {
    let xeroConnection: { orgName: string | null; expiresAt: Date } | null = null;
    try {
      const conn = await prisma.accountingConnection.findUnique({
        where: { clientId_system: { clientId: engagement.clientId, system: 'xero' } },
        select: { orgName: true, expiresAt: true },
      });
      if (conn && new Date() < conn.expiresAt) xeroConnection = conn;
    } catch { /* ignore */ }
    return NextResponse.json({
      xero: xeroConnection ? { connected: true, orgName: xeroConnection.orgName } : { connected: false },
    });
  }

  // Build a memo-ready summary text for the Audit Summary Memo. Pulled by
  // the Completion → Audit Summary Memo → Significant Risks → "Management
  // Override of controls" row so the auditor doesn't have to retype the
  // population evidence and selection rationale.
  if (url.searchParams.get('memoSummary')) {
    const latestRun = await prisma.journalRiskRun.findFirst({
      where: { engagementId, status: 'completed' },
      orderBy: { createdAt: 'desc' },
      include: { runBy: { select: { name: true } } },
    });
    if (!latestRun) {
      return NextResponse.json({
        available: false,
        message: 'No completed journal risk run on this engagement yet.',
      });
    }
    const exceptionCount = await prisma.journalRiskEntry.count({
      where: { runId: latestRun.id, testStatus: 'exception' },
    });
    const testedCount = await prisma.journalRiskEntry.count({
      where: { runId: latestRun.id, selected: true, testStatus: { in: ['tested', 'no_exception', 'exception'] } },
    });
    const errorScheduleCount = await prisma.journalRiskEntry.count({
      where: { runId: latestRun.id, errorScheduleId: { not: null } },
    });
    const aiFlaggedCount = await prisma.journalRiskEntry.count({
      where: { runId: latestRun.id, aiFlag: true },
    });
    const pop = latestRun.populationEvidence as { recordCount?: number; sourceSystem?: string; coverage?: { fromDate?: string; toDate?: string } };
    const ss = latestRun.selectionSummary as { layer1?: number; layer2?: number; layer3?: number };

    const sourceLabel = pop?.sourceSystem === 'xero' ? 'pulled live from Xero (manual journals)'
      : pop?.sourceSystem === 'xero_full' ? 'pulled live from Xero (full journals feed)'
      : pop?.sourceSystem === 'csv' ? 'extracted from client-provided CSV'
      : 'extracted from source system';

    const procedures = [
      `Procedures performed (ISA 240, paras 32–33):`,
      `- Obtained the complete population of ${latestRun.totalJournals.toLocaleString()} journal entr${latestRun.totalJournals === 1 ? 'y' : 'ies'} for the period (${pop?.coverage?.fromDate || ''} to ${pop?.coverage?.toDate || ''}), ${sourceLabel}.`,
      `- Applied the firm's ISA 240 risk model (timing, user/access, content, description, accounting-risk and behaviour dimensions) to the full population.`,
      `- Selected ${latestRun.totalSelected.toLocaleString()} journal${latestRun.totalSelected === 1 ? '' : 's'} for inspection across three layers: ${ss?.layer1 || 0} mandatory (high-risk score / critical tag), ${ss?.layer2 || 0} targeted (risk-tag coverage), ${ss?.layer3 || 0} unpredictable.`,
      aiFlaggedCount > 0 ? `- Reviewed AI-augmented commentary on description quality; ${aiFlaggedCount} entr${aiFlaggedCount === 1 ? 'y was' : 'ies were'} flagged as vague or unusual and corroborated against the deterministic scoring.` : '',
      `- Inspected supporting evidence for each selected journal and assessed the business rationale, posting authority and accounting treatment.`,
    ].filter(Boolean).join('\n');

    const conclusionDefault = exceptionCount === 0
      ? `Of the ${latestRun.totalSelected.toLocaleString()} journals selected, ${testedCount.toLocaleString()} ha${testedCount === 1 ? 's' : 've'} been tested with no exceptions identified. No evidence of management override of controls was identified.`
      : `Of the ${latestRun.totalSelected.toLocaleString()} journals selected, ${testedCount.toLocaleString()} ha${testedCount === 1 ? 's' : 've'} been tested and ${exceptionCount.toLocaleString()} exception${exceptionCount === 1 ? '' : 's'} ${exceptionCount === 1 ? 'was' : 'were'} identified${errorScheduleCount > 0 ? ` (${errorScheduleCount} raised to the error schedule)` : ''}. See WP reference below.`;

    return NextResponse.json({
      available: true,
      runId: latestRun.runId,
      runAt: latestRun.createdAt,
      runBy: latestRun.runBy?.name || 'Unknown',
      identifiedRisk: 'Management override of controls (ISA 240) — risk that management can override controls to perpetrate fraud through inappropriate journal entries.',
      proceduresPerformed: procedures,
      conclusion: latestRun.conclusion || conclusionDefault,
      wpReference: `MOC-${latestRun.runId.slice(0, 8)}`,
      population: latestRun.totalJournals,
      selected: latestRun.totalSelected,
      tested: testedCount,
      exceptions: exceptionCount,
      errorScheduleCount,
      aiFlagged: aiFlaggedCount,
    });
  }

  // Also return default config if requested
  if (url.searchParams.get('defaultConfig')) {
    const period = await prisma.clientPeriod.findUnique({ where: { id: engagement.periodId } });
    const periodStart = period?.startDate ? new Date(period.startDate).toISOString().slice(0, 10) : new Date().getFullYear() + '-01-01';
    const periodEnd = period?.endDate ? new Date(period.endDate).toISOString().slice(0, 10) : new Date().getFullYear() + '-12-31';
    const firmKeywords = engagement.firmId ? await loadFirmKeywords(engagement.firmId) : null;
    return NextResponse.json({ config: buildDefaultConfig({
      periodStartDate: periodStart,
      periodEndDate: periodEnd,
      suspiciousKeywords: firmKeywords ?? undefined,
    }) });
  }

  const run = runId
    ? await prisma.journalRiskRun.findUnique({ where: { runId }, include: { runBy: { select: { name: true } } } })
    : await prisma.journalRiskRun.findFirst({
        where: { engagementId, status: 'completed' },
        orderBy: { createdAt: 'desc' },
        include: { runBy: { select: { name: true } } },
      });

  if (!run) return NextResponse.json({ run: null });

  // Aggregate AI / exception / error-schedule counts so the panel header
  // can show them without a separate round-trip.
  const [aiCount, exceptionCount, errorScheduleCount] = await Promise.all([
    prisma.journalRiskEntry.count({ where: { runId: run.id, aiFlag: true } }),
    prisma.journalRiskEntry.count({ where: { runId: run.id, testStatus: 'exception' } }),
    prisma.journalRiskEntry.count({ where: { runId: run.id, errorScheduleId: { not: null } } }),
  ]);

  return NextResponse.json({ run: {
    id: run.id,
    runId: run.runId,
    status: run.status,
    totalJournals: run.totalJournals,
    totalSelected: run.totalSelected,
    selectionSummary: run.selectionSummary,
    populationEvidence: run.populationEvidence,
    config: run.config,
    runBy: run.runBy?.name || 'Unknown',
    createdAt: run.createdAt,
    conclusion: run.conclusion || '',
    conclusionAt: run.conclusionAt,
    aiFlaggedCount: aiCount,
    exceptionCount,
    errorScheduleCount,
  }});
}

/**
 * Run the engine, persist the run + entries, and return the run summary.
 * Shared between the CSV-upload path and the Xero-pull path.
 */
async function runAndPersist(opts: {
  engagementId: string;
  firmId: string | undefined;
  clientId: string;
  periodId: string;
  userId: string;
  journals: JournalRecord[];
  users: UserRecord[];
  accounts: AccountRecord[];
  baseCurrency: string;
  sourceLabel: string; // 'csv' | 'xero' — surfaced in the populationEvidence
  configOverrides?: Partial<Config>;
}) {
  validateJournals(opts.journals);
  validateUsers(opts.users);
  validateAccounts(opts.accounts);

  const period = await prisma.clientPeriod.findUnique({ where: { id: opts.periodId } });
  const periodStart = period?.startDate ? new Date(period.startDate).toISOString().slice(0, 10) : new Date().getFullYear() + '-01-01';
  const periodEnd = period?.endDate ? new Date(period.endDate).toISOString().slice(0, 10) : new Date().getFullYear() + '-12-31';
  const firmKeywords = opts.firmId ? await loadFirmKeywords(opts.firmId) : null;
  let config = buildDefaultConfig({
    periodStartDate: periodStart,
    periodEndDate: periodEnd,
    suspiciousKeywords: firmKeywords ?? undefined,
  });
  if (opts.configOverrides) {
    config = { ...config, ...opts.configOverrides } as Config;
  }
  validateConfig(config);

  const client = await prisma.client.findUnique({ where: { id: opts.clientId }, select: { clientName: true } });
  const entityName = client?.clientName || 'Unknown';

  const result = runJournalRiskAnalysis({
    journals: opts.journals,
    users: opts.users,
    accounts: opts.accounts,
    config,
    engagementId: opts.engagementId,
    entityName,
    baseCurrency: opts.baseCurrency,
  });

  // Tag the population evidence with the source so the UI can show how
  // the data got here (and an auditor reviewing the file can tell at a
  // glance whether it came from a verified accounting-system pull or a
  // CSV upload).
  (result.population as unknown as { sourceSystem: string }).sourceSystem = opts.sourceLabel;

  const coverage = analyzeCoverage(result.results.journals);

  await prisma.journalRiskRun.updateMany({
    where: { engagementId: opts.engagementId, status: 'completed' },
    data: { status: 'superseded' },
  });

  const run = await prisma.journalRiskRun.create({
    data: {
      engagementId: opts.engagementId,
      runId: result.results.run.runId,
      status: 'completed',
      config: config as object,
      populationEvidence: result.population as object,
      selectionSummary: {
        layer1: coverage.byLayer.layer1_mandatory_high_risk || 0,
        layer2: coverage.byLayer.layer2_targeted_coverage || 0,
        layer3: coverage.byLayer.layer3_unpredictable || 0,
        notSelected: coverage.byLayer.not_selected || 0,
      },
      riskModelSnapshot: result.riskModel as object,
      totalJournals: result.results.journals.length,
      totalSelected: coverage.totalSelected,
      runById: opts.userId,
    },
  });

  const BATCH_SIZE = 500;
  const entries = result.results.journals;
  // Build a journalId → input record lookup so we can recover the raw amount
  // / description / accounts without an O(n²) array scan per entry.
  const inputById = new Map(opts.journals.map(j => [j.journalId, j]));
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    await prisma.journalRiskEntry.createMany({
      data: batch.map(j => {
        const src = inputById.get(j.journalId);
        return {
          runId: run.id,
          journalId: j.journalId,
          postedAt: j.postedAt,
          period: j.period,
          isManual: j.isManual,
          preparedByUserId: j.preparedByUserId,
          approvedByUserId: j.approvedByUserId || null,
          amount: src?.amount ?? 0,
          description: src?.description ?? null,
          debitAccountId: src?.debitAccountId ?? '',
          creditAccountId: src?.creditAccountId ?? '',
          riskScore: j.riskScore,
          riskBand: j.riskBand,
          riskTags: j.riskTags as object,
          drivers: j.drivers as object,
          selected: j.selection.selected,
          selectionLayer: j.selection.selectionLayer,
          mandatory: j.selection.mandatory,
          rationale: j.selection.rationale,
        };
      }),
    });
  }

  return {
    run,
    totalJournals: entries.length,
    totalSelected: coverage.totalSelected,
    selectionSummary: run.selectionSummary,
  };
}

// POST — run analysis, update entries, export
export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  const engagement = await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;
  if (!engagement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const contentType = req.headers.get('content-type') || '';

  // ── Run analysis (multipart form with CSV files) ──
  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData();
    const journalsFile = formData.get('journals') as File | null;
    const usersFile = formData.get('users') as File | null;
    const accountsFile = formData.get('accounts') as File | null;
    const configOverrides = formData.get('configOverrides') as string | null;

    if (!journalsFile || !usersFile || !accountsFile) {
      return NextResponse.json({ error: 'journals, users, and accounts CSV files are required' }, { status: 400 });
    }

    try {
      const journals = parseJournalsCsv(await journalsFile.text());
      const users = parseUsersCsv(await usersFile.text());
      const accounts = parseAccountsCsv(await accountsFile.text());

      let overrides: Partial<Config> | undefined;
      if (configOverrides) {
        try { overrides = JSON.parse(configOverrides); } catch { /* ignore */ }
      }

      const out = await runAndPersist({
        engagementId,
        firmId: engagement.firmId,
        clientId: engagement.clientId,
        periodId: engagement.periodId,
        userId: session.user.id,
        journals,
        users,
        accounts,
        baseCurrency: journals[0]?.currency || 'GBP',
        sourceLabel: 'csv',
        configOverrides: overrides,
      });

      return NextResponse.json({
        run: {
          id: out.run.id,
          runId: out.run.runId,
          totalJournals: out.totalJournals,
          totalSelected: out.totalSelected,
          selectionSummary: out.selectionSummary,
        },
      }, { status: 201 });
    } catch (err: any) {
      console.error('[Journal Risk] Analysis failed:', err);
      return NextResponse.json({ error: err.message || 'Analysis failed' }, { status: 400 });
    }
  }

  // ── JSON actions ──
  const body = await req.json();
  const { action } = body;

  // Pull journals from Xero and run the engine.
  if (action === 'pull_xero') {
    try {
      const period = await prisma.clientPeriod.findUnique({ where: { id: engagement.periodId } });
      if (!period?.startDate || !period?.endDate) {
        return NextResponse.json({ error: 'Engagement period has no start / end date set' }, { status: 400 });
      }
      const periodStart = new Date(period.startDate).toISOString().slice(0, 10);
      const periodEnd = new Date(period.endDate).toISOString().slice(0, 10);
      const client = await prisma.client.findUnique({ where: { id: engagement.clientId }, select: { clientName: true } });

      const mode: 'manual' | 'full' = body?.mode === 'full' ? 'full' : 'manual';
      const pull = await pullFromXero({
        clientId: engagement.clientId,
        periodStart,
        periodEnd,
        entity: client?.clientName || 'Unknown',
        baseCurrency: 'GBP',
        mode,
      });

      if (pull.journals.length === 0) {
        return NextResponse.json({
          error: mode === 'manual'
            ? 'No manual journals found in Xero for this period.'
            : 'No journals found in Xero for this period.',
          skipped: pull.skipped,
        }, { status: 400 });
      }

      const out = await runAndPersist({
        engagementId,
        firmId: engagement.firmId,
        clientId: engagement.clientId,
        periodId: engagement.periodId,
        userId: session.user.id,
        journals: pull.journals,
        users: pull.users,
        accounts: pull.accounts,
        baseCurrency: 'GBP',
        sourceLabel: mode === 'full' ? 'xero_full' : 'xero',
      });

      return NextResponse.json({
        run: {
          id: out.run.id,
          runId: out.run.runId,
          totalJournals: out.totalJournals,
          totalSelected: out.totalSelected,
          selectionSummary: out.selectionSummary,
          source: 'xero',
          mode,
          skipped: pull.skipped,
        },
      }, { status: 201 });
    } catch (err: any) {
      console.error('[Journal Risk] Xero pull failed:', err);
      return NextResponse.json({ error: err.message || 'Xero pull failed' }, { status: 400 });
    }
  }

  // Run AI augmentation across all selected entries (or all medium/high
  // band entries if `scope: 'suspicious'`). Strictly supplementary — the
  // deterministic risk score does NOT change. Stores aiInsight / aiFlag /
  // aiProcessedAt on each entry. Idempotent: re-running overwrites the
  // commentary, doesn't append.
  if (action === 'run_ai_augmentation') {
    try {
      const run = await prisma.journalRiskRun.findFirst({
        where: { engagementId, status: 'completed' },
        orderBy: { createdAt: 'desc' },
      });
      if (!run) return NextResponse.json({ error: 'No completed run found' }, { status: 404 });

      const scope: 'selected' | 'suspicious' = body?.scope === 'suspicious' ? 'suspicious' : 'selected';
      const where = scope === 'suspicious'
        ? { runId: run.id, riskBand: { in: ['medium', 'high'] } }
        : { runId: run.id, selected: true };
      const entries = await prisma.journalRiskEntry.findMany({
        where,
        orderBy: { riskScore: 'desc' },
        select: {
          id: true, journalId: true, description: true, amount: true, period: true,
          debitAccountId: true, creditAccountId: true, riskBand: true, riskTags: true,
        },
      });

      if (entries.length === 0) {
        return NextResponse.json({ processed: 0 });
      }

      const OpenAI = (await import('openai')).default;
      const client = new OpenAI({
        apiKey: process.env.TOGETHER_API_KEY || '',
        baseURL: 'https://api.together.xyz/v1',
      });

      // Process in batches of 20 so a single completion call sees enough
      // context (vague-description detection is calibrated against the
      // batch) but stays well inside the token budget.
      const BATCH = 20;
      let processed = 0;
      for (let i = 0; i < entries.length; i += BATCH) {
        const batch = entries.slice(i, i + BATCH);
        const items = batch.map((e, idx) => ({
          idx,
          desc: e.description || '',
          amount: e.amount,
          period: e.period,
          tags: (e.riskTags as string[]) || [],
        }));

        const prompt = [
          'You are an audit assistant supporting an ISA 240 management-override test.',
          'For each numbered journal below, judge whether the **description text alone** is unusual, vague, evasive, or out-of-distribution compared to typical accounting narrations.',
          'Be strict: descriptions like "adjustment", "per CFO", "to fix", "as agreed", "off books", "true up", with no further detail are flags. Specific narrations referencing invoices, payroll periods, supplier names, or reconciliations are NOT flags by themselves.',
          'You MUST return one JSON object per input, in input order, in a JSON array. Each object must have:',
          '  - "idx": the input index number',
          '  - "flag": true if the description is genuinely concerning, false otherwise',
          '  - "insight": one short sentence explaining your judgement (cite specific words you saw)',
          'Return ONLY the JSON array, no preamble or trailing text.',
          '',
          'Journals:',
          JSON.stringify(items, null, 2),
        ].join('\n');

        let raw = '';
        try {
          const resp = await client.chat.completions.create({
            model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
            messages: [
              { role: 'system', content: 'You return JSON arrays only. No commentary.' },
              { role: 'user', content: prompt },
            ],
            max_tokens: 2000,
            temperature: 0.1,
          });
          raw = resp.choices[0]?.message?.content || '';
        } catch (err: any) {
          console.error('[Journal Risk AI] Together AI call failed:', err);
          continue; // skip this batch — keep going so partial progress lands
        }

        // Extract the JSON array — Llama sometimes adds a code fence even
        // when told not to.
        const cleaned = raw.replace(/```(?:json)?/g, '').trim();
        let parsed: Array<{ idx: number; flag: boolean; insight: string }> = [];
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          // Fallback: try to extract the first JSON array substring.
          const m = cleaned.match(/\[[\s\S]*\]/);
          if (m) {
            try { parsed = JSON.parse(m[0]); } catch { parsed = []; }
          }
        }

        for (const p of parsed) {
          if (typeof p?.idx !== 'number') continue;
          const target = batch[p.idx];
          if (!target) continue;
          await prisma.journalRiskEntry.update({
            where: { id: target.id },
            data: {
              aiInsight: typeof p.insight === 'string' ? p.insight.slice(0, 1000) : null,
              aiFlag: p.flag === true,
              aiProcessedAt: new Date(),
            },
          });
          processed++;
        }
      }

      return NextResponse.json({ processed, total: entries.length });
    } catch (err: any) {
      console.error('[Journal Risk] AI augmentation failed:', err);
      return NextResponse.json({ error: err.message || 'AI augmentation failed' }, { status: 500 });
    }
  }

  // Record the auditor's overall conclusion on the MOC test. Surfaced
  // into the Audit Summary Memo by the completion-memo endpoint.
  if (action === 'set_conclusion') {
    const conclusion = typeof body?.conclusion === 'string' ? body.conclusion : '';
    const run = await prisma.journalRiskRun.findFirst({
      where: { engagementId, status: 'completed' },
      orderBy: { createdAt: 'desc' },
    });
    if (!run) return NextResponse.json({ error: 'No completed run found' }, { status: 404 });
    await prisma.journalRiskRun.update({
      where: { id: run.id },
      data: {
        conclusion: conclusion || null,
        conclusionById: conclusion ? session.user.id : null,
        conclusionAt: conclusion ? new Date() : null,
      },
    });
    return NextResponse.json({ ok: true });
  }

  // Raise a single journal entry as an error onto the engagement's error
  // schedule. Stores the cross-link in both directions so the panel can
  // show "Raised on schedule" and the schedule can show "From MOC test".
  if (action === 'raise_as_error') {
    const { entryId, fsLine, accountCode, errorType, explanation, errorAmount } = body || {};
    if (!entryId) return NextResponse.json({ error: 'entryId required' }, { status: 400 });
    const entry = await prisma.journalRiskEntry.findUnique({ where: { id: entryId } });
    if (!entry) return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    if (entry.errorScheduleId) {
      return NextResponse.json({ error: 'Entry already raised as an error' }, { status: 409 });
    }

    const created = await prisma.auditErrorSchedule.create({
      data: {
        engagementId,
        fsLine: typeof fsLine === 'string' && fsLine ? fsLine : 'Management Override',
        accountCode: typeof accountCode === 'string' ? accountCode : entry.debitAccountId,
        description: `MOC test — journal ${entry.journalId}: ${entry.description || '(no description)'}`,
        errorAmount: typeof errorAmount === 'number' ? errorAmount : entry.amount,
        errorType: typeof errorType === 'string' && ['factual', 'judgemental', 'projected'].includes(errorType)
          ? errorType
          : 'factual',
        explanation: typeof explanation === 'string' ? explanation : (entry.testNotes || entry.rationale || ''),
        linkedFromType: 'journal_risk_entry',
        linkedFromId: entry.id,
      },
    });

    await prisma.journalRiskEntry.update({
      where: { id: entry.id },
      data: {
        errorScheduleId: created.id,
        testStatus: 'exception',
        testedById: session.user.id,
        testedAt: new Date(),
      },
    });

    return NextResponse.json({ errorScheduleId: created.id });
  }

  // Create a PortalRequest asking the client to upload a journal export.
  if (action === 'request_from_client') {
    const message = typeof body?.message === 'string' ? body.message : '';
    const period = await prisma.clientPeriod.findUnique({ where: { id: engagement.periodId } });
    const periodStartStr = period?.startDate ? new Date(period.startDate).toLocaleDateString('en-GB') : '';
    const periodEndStr = period?.endDate ? new Date(period.endDate).toLocaleDateString('en-GB') : '';

    const question = [
      'Please provide a full journal export covering the audit period (and the 90 days after period end).',
      periodStartStr && periodEndStr ? `Period: ${periodStartStr} – ${periodEndStr}.` : '',
      '',
      'The export should include, for every journal entry:',
      '',
      '- Journal number / ID',
      '- Date posted',
      '- User who posted the journal (and the approver, where separate)',
      '- Account code(s) on each line — both sides of the entry',
      '- Amount on each line',
      '- Journal narration / description',
      '- Source (e.g. manual journal, system-generated)',
      '',
      'Most accounting systems can produce this directly — in Xero this is the "General Ledger Detail" report (with all accounts selected) or the Journals export.',
      '',
      'Alternatively, if you would prefer us to pull the data directly from your accounting system, please let us know and we can send a read-only connection request.',
      '',
      message,
    ].filter(Boolean).join('\n');

    const portalRequest = await prisma.portalRequest.create({
      data: {
        clientId: engagement.clientId,
        engagementId,
        section: 'evidence',
        question,
        status: 'outstanding',
        requestedById: session.user.id,
        requestedByName: session.user.name || session.user.email || 'Audit Team',
        evidenceTag: 'journal_export',
      },
    });

    return NextResponse.json({ id: portalRequest.id, sentAt: new Date().toISOString() });
  }

  // Update entry test status
  if (action === 'update_entry') {
    const { entryId, testStatus, testNotes } = body;
    if (!entryId) return NextResponse.json({ error: 'entryId required' }, { status: 400 });
    const entry = await prisma.journalRiskEntry.update({
      where: { id: entryId },
      data: {
        testStatus: testStatus || undefined,
        testNotes: testNotes !== undefined ? testNotes : undefined,
        testedById: session.user.id,
        testedAt: new Date(),
      },
    });
    return NextResponse.json({ entry });
  }

  // Export CSV
  if (action === 'export_csv') {
    const { runId } = body;
    const run = runId
      ? await prisma.journalRiskRun.findUnique({ where: { runId } })
      : await prisma.journalRiskRun.findFirst({ where: { engagementId, status: 'completed' }, orderBy: { createdAt: 'desc' } });
    if (!run) return NextResponse.json({ error: 'No run found' }, { status: 404 });

    const entries = await prisma.journalRiskEntry.findMany({ where: { runId: run.id }, orderBy: { riskScore: 'desc' } });

    // Map to JournalRiskResult format for the reporting function
    const results = entries.map(e => ({
      journalId: e.journalId,
      postedAt: e.postedAt,
      period: e.period,
      isManual: e.isManual,
      preparedByUserId: e.preparedByUserId,
      approvedByUserId: e.approvedByUserId,
      riskScore: e.riskScore,
      riskBand: e.riskBand as 'low' | 'medium' | 'high',
      riskTags: (e.riskTags as string[]) || [],
      drivers: (e.drivers as any[]) || [],
      selection: { selected: e.selected, selectionLayer: e.selectionLayer, mandatory: e.mandatory, rationale: e.rationale || '' },
    }));

    const csv = generateScoredCsv(results as any);
    return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="journal_risk_${run.runId}.csv"` } });
  }

  // Export markdown
  if (action === 'export_markdown') {
    const { runId } = body;
    const run = runId
      ? await prisma.journalRiskRun.findUnique({ where: { runId } })
      : await prisma.journalRiskRun.findFirst({ where: { engagementId, status: 'completed' }, orderBy: { createdAt: 'desc' } });
    if (!run) return NextResponse.json({ error: 'No run found' }, { status: 404 });

    const entries = await prisma.journalRiskEntry.findMany({ where: { runId: run.id }, orderBy: { riskScore: 'desc' } });

    const runResult = {
      version: '1.0.0',
      engagement: { engagementId, entityName: '', periodStart: (run.config as any).periodStartDate, periodEnd: (run.config as any).periodEndDate, baseCurrency: 'GBP' },
      population: run.populationEvidence as any,
      riskModel: run.riskModelSnapshot as any,
      results: {
        run: { runId: run.runId, runAtUtc: run.createdAt.toISOString(), engineVersion: '1.0.0' },
        journals: entries.map(e => ({
          journalId: e.journalId, postedAt: e.postedAt, period: e.period, isManual: e.isManual,
          preparedByUserId: e.preparedByUserId, approvedByUserId: e.approvedByUserId,
          riskScore: e.riskScore, riskBand: e.riskBand, riskTags: (e.riskTags as string[]) || [],
          drivers: (e.drivers as any[]) || [],
          selection: { selected: e.selected, selectionLayer: e.selectionLayer, mandatory: e.mandatory, rationale: e.rationale || '' },
        })),
      },
    };

    const markdown = generateMarkdownSummary(runResult as any);
    return new Response(markdown, { headers: { 'Content-Type': 'text/markdown', 'Content-Disposition': `attachment; filename="journal_risk_summary_${run.runId}.md"` } });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
