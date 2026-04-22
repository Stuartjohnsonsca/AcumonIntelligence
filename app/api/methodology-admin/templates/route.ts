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
    const candidates = await prisma.methodologyTemplate.findMany({
      where: { firmId: session.user.firmId, templateType },
    });
    const template =
      candidates.find(t => t.auditType === eng.auditType)
      ?? candidates.find(t => t.auditType === 'ALL')
      ?? candidates[0]
      ?? null;
    return NextResponse.json({ template, templates: candidates, resolvedAuditType: template?.auditType ?? null });
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
