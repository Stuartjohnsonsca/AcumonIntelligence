import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const session = await auth();
  // All authenticated users can READ templates (needed for audit tabs)
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const templateType = searchParams.get('type') || searchParams.get('templateType');
  const auditType = searchParams.get('auditType');
  const engagementId = searchParams.get('engagementId');

  const where: Record<string, unknown> = { firmId: session.user.firmId };
  if (templateType) where.templateType = templateType;

  // ── engagementId-based resolution ──────────────────────────────────
  // Engagement tabs hit this endpoint to load their Q&A template. They
  // used to hardcode `auditType=ALL`, which silently dropped any
  // template saved against a specific audit type (SME / GRANT / CASS /
  // GROUP) — those tabs then rendered as "no questions configured"
  // even when the admin clearly configured them.
  //
  // Now: if engagementId is supplied, look up the engagement's audit
  // type and pick the most-specific match. Preference order:
  //   1. templateType + engagement's auditType
  //   2. templateType + 'ALL'
  //   3. templateType + any auditType (last resort — don't leave the
  //      tab blank when SOME template clearly exists)
  //
  // Also enforces firm scope — the engagement must belong to the
  // caller's firm. Cross-firm access returns 404.
  if (engagementId && templateType) {
    const eng = await prisma.auditEngagement.findUnique({
      where: { id: engagementId },
      select: { firmId: true, auditType: true },
    });
    if (!eng || (eng.firmId !== session.user.firmId && !session.user.isSuperAdmin)) {
      return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
    }

    // Exact-match first. If nothing's there, try variant spellings —
    // firms have historically created schedules with inconsistent
    // naming (e.g. 'new_client_takeon_questions' vs
    // 'new_client_take_on_questions' vs 'new_client_take_on'), and
    // the engagement tab's hardcoded templateType doesn't always
    // agree with what the admin saved. Rather than returning zero
    // rows and surfacing a blank tab, normalise both sides
    // (lowercase, strip all non-alphanumerics, strip trailing
    // 'questions'/'categories' suffix) and match. Typical case
    // this catches: the admin built their questions under a
    // master-schedule key that had underscores the tab's key
    // doesn't expect.
    let candidates = await prisma.methodologyTemplate.findMany({
      where: { firmId: session.user.firmId, templateType },
    });
    if (candidates.length === 0) {
      const all = await prisma.methodologyTemplate.findMany({ where: { firmId: session.user.firmId } });
      const target = normaliseTemplateType(templateType);
      candidates = all.filter(t => normaliseTemplateType(t.templateType) === target);
    }

    const template =
      candidates.find(t => t.auditType === eng.auditType)
      ?? candidates.find(t => t.auditType === 'ALL')
      ?? candidates[0]
      ?? null;
    return NextResponse.json({
      template,
      templates: candidates,
      resolvedAuditType: template?.auditType ?? null,
      resolvedTemplateType: template?.templateType ?? null,
    });
  }

  if (auditType) where.auditType = auditType;

  const templates = await prisma.methodologyTemplate.findMany({ where: where as any });

  // If requesting a single template type, return it directly for convenience
  if (templateType && auditType && templates.length > 0) {
    return NextResponse.json({ template: templates[0], templates });
  }

  return NextResponse.json({ templates });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { templateType, auditType, items } = await req.json();
  const firmId = session.user.firmId;

  // For types that allow multiple records (e.g. questionnaire), use a unique auditType suffix
  const uniqueAuditType = templateType === 'questionnaire'
    ? `${auditType}_${Date.now()}`
    : auditType;

  const template = await prisma.methodologyTemplate.create({
    data: { firmId, templateType, auditType: uniqueAuditType, items },
  });

  return NextResponse.json(template, { status: 201 });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { templateType, auditType, items } = await req.json();
  const firmId = session.user.firmId;

  const template = await prisma.methodologyTemplate.upsert({
    where: {
      firmId_templateType_auditType: { firmId, templateType, auditType },
    },
    create: { firmId, templateType, auditType, items },
    update: { items },
  });

  return NextResponse.json({ template });
}

/**
 * DELETE /api/methodology-admin/templates
 * Body: { templateType, auditType }
 *
 * Removes the methodology_template row for a specific (templateType,
 * auditType) on the caller's firm. Used by the Schedule Designer
 * "Delete from this audit type" action so admins can retire a
 * schedule's copy under one type without affecting copies under
 * other types.
 */
export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { templateType, auditType } = await req.json().catch(() => ({}));
  if (!templateType || !auditType) {
    return NextResponse.json({ error: 'templateType and auditType required' }, { status: 400 });
  }
  const firmId = session.user.firmId;

  try {
    await prisma.methodologyTemplate.delete({
      where: { firmId_templateType_auditType: { firmId, templateType, auditType } },
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    // P2025 = "not found" — treat as a no-op success so the UI
    // doesn't error out when the admin tries to delete a row that's
    // already been removed.
    if (err?.code === 'P2025') {
      return NextResponse.json({ ok: true, note: 'Already removed' });
    }
    console.error('[templates/DELETE] failed:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Delete failed' }, { status: 500 });
  }
}

/**
 * Compare two templateType strings while tolerating the real-world
 * inconsistencies firms accumulate over time:
 *
 *   new_client_takeon_questions
 *   new_client_take_on_questions
 *   new_client_take_on
 *   NewClientTakeOn
 *   new-client-take-on
 *
 * All collapse to the same normalised form (lowercase, alphanumerics
 * only, trailing 'questions' / 'categories' suffix stripped) so
 * exact-match lookups don't return empty just because the admin UI
 * and the tab code disagree on a single underscore.
 */
function normaliseTemplateType(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/(questions|categories)$/, '');
}
