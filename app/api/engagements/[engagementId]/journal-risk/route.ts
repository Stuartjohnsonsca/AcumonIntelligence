import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { runJournalRiskAnalysis } from '@/lib/journal-risk/engine';
import { parseJournalsCsv, parseUsersCsv, parseAccountsCsv } from '@/lib/journal-risk/parseCsv';
import { validateJournals, validateUsers, validateAccounts, validateConfig } from '@/lib/journal-risk/validators';
import { buildDefaultConfig } from '@/lib/journal-risk/config-builder';
import { generateScoredCsv, generateMarkdownSummary } from '@/lib/journal-risk/reporting';
import { analyzeCoverage } from '@/lib/journal-risk/selection/coverage';
import type { Config } from '@/lib/journal-risk/types';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, clientId: true, periodId: true },
  });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
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

  // Also return default config if requested
  if (url.searchParams.get('defaultConfig')) {
    const period = await prisma.clientPeriod.findUnique({ where: { id: engagement.periodId } });
    const periodStart = period?.startDate ? new Date(period.startDate).toISOString().slice(0, 10) : new Date().getFullYear() + '-01-01';
    const periodEnd = period?.endDate ? new Date(period.endDate).toISOString().slice(0, 10) : new Date().getFullYear() + '-12-31';
    return NextResponse.json({ config: buildDefaultConfig({ periodStartDate: periodStart, periodEndDate: periodEnd }) });
  }

  const run = runId
    ? await prisma.journalRiskRun.findUnique({ where: { runId }, include: { runBy: { select: { name: true } } } })
    : await prisma.journalRiskRun.findFirst({
        where: { engagementId, status: 'completed' },
        orderBy: { createdAt: 'desc' },
        include: { runBy: { select: { name: true } } },
      });

  if (!run) return NextResponse.json({ run: null });

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
  }});
}

// POST — run analysis, update entries, export
export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  const engagement = await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
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
      // Parse CSVs
      const journalsCsv = await journalsFile.text();
      const usersCsv = await usersFile.text();
      const accountsCsv = await accountsFile.text();

      const journals = parseJournalsCsv(journalsCsv);
      const users = parseUsersCsv(usersCsv);
      const accounts = parseAccountsCsv(accountsCsv);

      // Validate
      validateJournals(journals);
      validateUsers(users);
      validateAccounts(accounts);

      // Build config
      const period = await prisma.clientPeriod.findUnique({ where: { id: engagement.periodId } });
      const periodStart = period?.startDate ? new Date(period.startDate).toISOString().slice(0, 10) : new Date().getFullYear() + '-01-01';
      const periodEnd = period?.endDate ? new Date(period.endDate).toISOString().slice(0, 10) : new Date().getFullYear() + '-12-31';
      let config = buildDefaultConfig({ periodStartDate: periodStart, periodEndDate: periodEnd });

      // Apply overrides
      if (configOverrides) {
        try {
          const overrides = JSON.parse(configOverrides);
          config = { ...config, ...overrides } as Config;
        } catch { /* ignore invalid overrides */ }
      }

      validateConfig(config);

      // Get entity name
      const client = await prisma.client.findUnique({ where: { id: engagement.clientId }, select: { companyName: true } });
      const entityName = client?.companyName || 'Unknown';

      // Run analysis
      const result = runJournalRiskAnalysis({
        journals, users, accounts, config,
        engagementId,
        entityName,
        baseCurrency: journals[0]?.currency || 'GBP',
      });

      const coverage = analyzeCoverage(result.results.journals);

      // Mark previous runs as superseded
      await prisma.journalRiskRun.updateMany({
        where: { engagementId, status: 'completed' },
        data: { status: 'superseded' },
      });

      // Persist run
      const run = await prisma.journalRiskRun.create({
        data: {
          engagementId,
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
          runById: session.user.id,
        },
      });

      // Persist entries in batches
      const BATCH_SIZE = 500;
      const entries = result.results.journals;
      for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = entries.slice(i, i + BATCH_SIZE);
        await prisma.journalRiskEntry.createMany({
          data: batch.map(j => ({
            runId: run.id,
            journalId: j.journalId,
            postedAt: j.postedAt,
            period: j.period,
            isManual: j.isManual,
            preparedByUserId: j.preparedByUserId,
            approvedByUserId: j.approvedByUserId || null,
            amount: journals.find(jr => jr.journalId === j.journalId)?.amount || 0,
            description: journals.find(jr => jr.journalId === j.journalId)?.description || null,
            debitAccountId: journals.find(jr => jr.journalId === j.journalId)?.debitAccountId || '',
            creditAccountId: journals.find(jr => jr.journalId === j.journalId)?.creditAccountId || '',
            riskScore: j.riskScore,
            riskBand: j.riskBand,
            riskTags: j.riskTags as object,
            drivers: j.drivers as object,
            selected: j.selection.selected,
            selectionLayer: j.selection.selectionLayer,
            mandatory: j.selection.mandatory,
            rationale: j.selection.rationale,
          })),
        });
      }

      return NextResponse.json({
        run: {
          id: run.id,
          runId: run.runId,
          totalJournals: entries.length,
          totalSelected: coverage.totalSelected,
          selectionSummary: run.selectionSummary,
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

    const csv = generateScoredCsv(results);
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
