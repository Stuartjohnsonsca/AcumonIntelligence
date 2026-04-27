import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { assertAdmin, clipString, jsonError, parseDate, parseInteger } from '../_auth';

const PILLARS = ['goodwill', 'governance', 'growth', 'quality'];

export async function GET() {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const items = await prisma.perfPillarScore.findMany({
    where: { firmId: gate.session.user.firmId },
  });
  return NextResponse.json({ items });
}

// Upsert by (firmId, pillar) — one row per pillar.
export async function PUT(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => null);
  if (!body) return jsonError('JSON body required');
  if (!PILLARS.includes(body.pillar)) return jsonError(`pillar must be one of: ${PILLARS.join(', ')}`);

  const manualScore = parseInteger(body.manualScore);
  if (manualScore !== null && (manualScore < 0 || manualScore > 100)) return jsonError('manualScore must be 0-100');

  const item = await prisma.perfPillarScore.upsert({
    where: { firmId_pillar: { firmId: gate.session.user.firmId, pillar: body.pillar } },
    create: {
      firmId: gate.session.user.firmId,
      pillar: body.pillar,
      manualScore,
      strapline: clipString(body.strapline, 240),
      reviewedDate: parseDate(body.reviewedDate),
      notes: clipString(body.notes, 5000),
    },
    update: {
      manualScore,
      strapline: clipString(body.strapline, 240),
      reviewedDate: parseDate(body.reviewedDate),
      notes: clipString(body.notes, 5000),
    },
  });
  return NextResponse.json({ item });
}
