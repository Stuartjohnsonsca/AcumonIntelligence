import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { aiExtractProposals } from '@/lib/import-options/ai-extractor';
import { applyProposals } from '@/lib/import-options/apply-proposals';
import {
  AI_POPULATE_EXCLUDED_TABS,
  type ImportOptionsState,
} from '@/lib/import-options/types';

// POST /api/engagements/[id]/ai-populate-current
// Triggers a current-year AI population using prior-period data (when
// available) plus the engagement's own already-populated fields.
// EXCLUDES tabs in AI_POPULATE_EXCLUDED_TABS (rmm + tb) per the user's
// hard rule. The applier additionally tags __fieldmeta so populated
// fields render with the orange dashed surround.
//
// IMPORTANT: this endpoint does not perform live web searches. The AI
// only sees data that already exists in the engagement / prior-period
// engagement. We do not invent facts about the client.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ engagementId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: {
      id: true, firmId: true,
      priorPeriodEngagementId: true,
      importOptions: true,
      client: { select: { clientName: true } },
      period: { select: { startDate: true, endDate: true } },
    },
  });
  if (!engagement || engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  }

  // Build an evidence pack for the AI from in-tool data only.
  const [ethicsRow, materialityRow, continuanceRow, priorPeriodRows] = await Promise.all([
    prisma.auditEthics.findUnique({ where: { engagementId } }),
    prisma.auditMateriality.findUnique({ where: { engagementId } }),
    prisma.auditContinuance.findUnique({ where: { engagementId } }),
    engagement.priorPeriodEngagementId
      ? prisma.auditPermanentFile.findMany({
          where: { engagementId: engagement.priorPeriodEngagementId },
        })
      : Promise.resolve([]),
  ]);

  const evidencePack = {
    client: engagement.client?.clientName,
    periodStart: engagement.period?.startDate?.toISOString().slice(0, 10),
    periodEnd: engagement.period?.endDate?.toISOString().slice(0, 10),
    currentEthics: ethicsRow?.data || {},
    currentMateriality: materialityRow?.data || {},
    currentContinuance: continuanceRow?.data || {},
    priorPermanentFile: priorPeriodRows.reduce<Record<string, unknown>>((acc, r) => {
      if (!r.sectionKey.startsWith('__')) acc[r.sectionKey] = r.data;
      return acc;
    }, {}),
  };

  // Allowed tabs — every audit tab EXCEPT rmm and tb.
  const ALLOWED = [
    'opening', 'prior-period', 'permanent-file', 'ethics', 'continuance',
    'new-client', 'materiality', 'par', 'walkthroughs', 'documents',
    'outstanding', 'communication', 'tax-technical', 'subsequent-events',
  ].filter(k => !AI_POPULATE_EXCLUDED_TABS.has(k));

  const result = await aiExtractProposals({
    structured: evidencePack,
    allowedTabKeys: ALLOWED,
  });

  // Defensive double-filter: drop anything the AI tried to put in an
  // excluded tab even if our prompt was ignored.
  const safeProposals = result.proposals.filter(p => !AI_POPULATE_EXCLUDED_TABS.has(p.destination.tabKey));

  const apply = await applyProposals(engagementId, safeProposals, {
    userId: session.user.id,
    userName: session.user.name || session.user.email || 'Unknown',
    source: 'current_year_ai',
  });

  // Audit-log on engagement.importOptions.history.
  const at = new Date().toISOString();
  const me = { userId: session.user.id, userName: session.user.name || session.user.email || null };
  const prev = (engagement.importOptions as ImportOptionsState | null) || null;
  const next: ImportOptionsState = {
    ...(prev || { prompted: true, selections: [], status: 'pending' }),
    history: [
      ...(prev?.history || []),
      {
        event: 'current_year_populated',
        at,
        by: me,
        note: `applied=${apply.applied}, skipped=${apply.skipped}, model=${result.model || 'unknown'}`,
      },
    ],
  };
  await prisma.auditEngagement.update({
    where: { id: engagementId },
    data: { importOptions: next as unknown as object },
  });

  return NextResponse.json({
    applied: apply.applied,
    skipped: apply.skipped,
    warnings: apply.warnings,
    aiModel: result.model,
  });
}
