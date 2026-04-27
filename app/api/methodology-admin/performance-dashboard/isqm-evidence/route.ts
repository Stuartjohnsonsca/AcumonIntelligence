import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { assertAdmin, clipString, jsonError, parseDate, parseInteger } from '../_auth';

const OBJECTIVES = [
  'governance_leadership',
  'ethics',
  'acceptance_continuance',
  'engagement_performance',
  'resources',
  'information_communication',
  'monitoring_remediation',
  'risk_assessment',
];
const RAG = ['green', 'amber', 'red', 'grey'];

export async function GET() {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const items = await prisma.perfIsqmEvidence.findMany({
    where: { firmId: gate.session.user.firmId },
  });
  return NextResponse.json({ items });
}

// Upsert by (firmId, objective). One row per quality objective.
export async function PUT(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => null);
  if (!body) return jsonError('JSON body required');
  if (!OBJECTIVES.includes(body.objective)) return jsonError(`objective must be one of: ${OBJECTIVES.join(', ')}`);

  const evidenceCount = parseInteger(body.evidenceCount) ?? 0;
  const targetCount = parseInteger(body.targetCount) ?? 0;
  const ragManual = body.ragManual === true;
  const rag = ragManual && RAG.includes(body.rag) ? body.rag : 'grey';

  const item = await prisma.perfIsqmEvidence.upsert({
    where: { firmId_objective: { firmId: gate.session.user.firmId, objective: body.objective } },
    create: {
      firmId: gate.session.user.firmId,
      objective: body.objective,
      evidenceCount,
      targetCount,
      rag,
      ragManual,
      notes: clipString(body.notes, 5000),
      reviewedDate: parseDate(body.reviewedDate),
    },
    update: {
      evidenceCount,
      targetCount,
      rag,
      ragManual,
      notes: clipString(body.notes, 5000),
      reviewedDate: parseDate(body.reviewedDate),
    },
  });
  return NextResponse.json({ item });
}
