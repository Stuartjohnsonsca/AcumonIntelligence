import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { defaultIndependenceQuestions, type IndependenceQuestion } from '@/lib/independence';

/**
 * Firm-Wide Independence Questions CRUD.
 *
 * Persisted as a `MethodologyTemplate` row:
 *   firmId / templateType='independence_questions' / auditType='ALL'
 *   items = IndependenceQuestion[]
 *
 * GET — returns the question list (seeds with defaults on first call).
 * PUT — replaces the question list with whatever the admin sent.
 */

const TEMPLATE_KEY = { templateType: 'independence_questions', auditType: 'ALL' as const };

function sanitise(list: unknown): IndependenceQuestion[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter(q => q && typeof q === 'object')
    .map((q: any): IndependenceQuestion => ({
      id: String(q.id || '').trim() || `indep_${Math.random().toString(36).slice(2, 10)}`,
      text: String(q.text || '').trim(),
      helpText: q.helpText ? String(q.helpText) : undefined,
      answerType: q.answerType === 'text' ? 'text' : 'boolean',
      requiresNotesOnNo: Boolean(q.requiresNotesOnNo),
      hardFail: Boolean(q.hardFail),
    }))
    .filter(q => q.text.length > 0);
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const firmId = session.user.firmId;
  let row = await prisma.methodologyTemplate.findUnique({
    where: { firmId_templateType_auditType: { firmId, ...TEMPLATE_KEY } },
  }).catch(() => null);

  // First-time visit: seed defaults so the admin sees a starting point.
  if (!row) {
    try {
      row = await prisma.methodologyTemplate.create({
        data: { firmId, ...TEMPLATE_KEY, items: defaultIndependenceQuestions() as any },
      });
    } catch {
      // Race or schema quirk — fall back to in-memory defaults.
      return NextResponse.json({ questions: defaultIndependenceQuestions(), seeded: false });
    }
  }

  const items = Array.isArray(row.items) ? (row.items as unknown as IndependenceQuestion[]) : [];
  return NextResponse.json({ questions: items });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const firmId = session.user.firmId;
  const body = await req.json().catch(() => ({}));
  const questions = sanitise(body.questions);

  await prisma.methodologyTemplate.upsert({
    where: { firmId_templateType_auditType: { firmId, ...TEMPLATE_KEY } },
    create: { firmId, ...TEMPLATE_KEY, items: questions as any },
    update: { items: questions as any },
  });
  return NextResponse.json({ ok: true, questions });
}
