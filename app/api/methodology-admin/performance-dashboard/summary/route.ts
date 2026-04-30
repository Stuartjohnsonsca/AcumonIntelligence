import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { assertAdmin } from '../_auth';

/**
 * Single consolidated read for the Performance Dashboard. Returns every
 * piece of firm-scoped data the dashboard renders. Aggregates / derived
 * KPIs are computed on the client to keep the API plain.
 */
export async function GET() {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const firmId = gate.session.user.firmId;

  const [
    monitoringActivities,
    findings,
    remediations,
    csfs,
    peopleSnapshots,
    activitySchedule,
    isqmEvidence,
    pillarScores,
    aiTools,
    aiUsage,
    aiValidations,
  ] = await Promise.all([
    prisma.perfMonitoringActivity.findMany({ where: { firmId }, orderBy: [{ plannedDate: 'desc' }, { createdAt: 'desc' }] }),
    prisma.perfFinding.findMany({ where: { firmId }, orderBy: [{ raisedDate: 'desc' }] }),
    prisma.perfRemediation.findMany({ where: { firmId }, orderBy: [{ dueDate: 'asc' }] }),
    prisma.perfCsf.findMany({ where: { firmId }, orderBy: [{ pillar: 'asc' }, { sortOrder: 'asc' }] }),
    prisma.perfPeopleSnapshot.findMany({ where: { firmId }, orderBy: [{ periodEnd: 'desc' }] }),
    prisma.perfActivitySchedule.findMany({ where: { firmId }, orderBy: [{ year: 'asc' }, { monthIndex: 'asc' }, { sortOrder: 'asc' }] }),
    prisma.perfIsqmEvidence.findMany({ where: { firmId } }),
    prisma.perfPillarScore.findMany({ where: { firmId } }),
    prisma.perfAiTool.findMany({ where: { firmId }, orderBy: [{ riskRating: 'desc' }, { name: 'asc' }] }),
    prisma.perfAiUsage.findMany({ where: { firmId }, orderBy: [{ usedDate: 'desc' }], take: 1000 }),
    prisma.perfAiValidation.findMany({ where: { firmId }, orderBy: [{ testDate: 'desc' }] }),
  ]);

  return NextResponse.json({
    monitoringActivities,
    findings,
    remediations,
    csfs,
    peopleSnapshots,
    activitySchedule,
    isqmEvidence,
    pillarScores,
    aiTools,
    aiUsage,
    aiValidations,
  });
}
