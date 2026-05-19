import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';

/**
 * Per-engagement-tab Questionnaire dispatcher.
 *
 * Each tab on the engagement workspace (Ethics, Continuance, etc.)
 * mounts a small picker UI that lists the firm's Questionnaire
 * templates and lets the auditor fire one off to the Client Portal.
 * Each dispatched questionnaire becomes a PortalRequest with
 * `section = `questionnaire:${tabKey}`` and a JSON payload in
 * metadata carrying the questionnaire id + name + sign-off
 * records so the engagement-side dispatcher can render the response
 * + sign-off dots without joining any extra tables.
 *
 * Routes:
 *   POST   send a questionnaire — { questionnaireId, tabKey, tabLabel? }
 *   GET    list dispatches for this engagement — ?tabKey=...
 *   PUT    toggle a sign-off — ?id=requestId  body: { signOffRole: 'preparer'|'reviewer'|'ri' }
 */
type Ctx = { params: Promise<{ engagementId: string }> };

const ROLES = ['preparer', 'reviewer', 'ri'] as const;
type SignOffRole = typeof ROLES[number];

async function loadEngagement(engagementId: string) {
  return prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { id: true, firmId: true, clientId: true, auditType: true },
  });
}

function sectionFor(tabKey: string): string {
  return `questionnaire:${tabKey}`;
}

/** Flatten a questionnaire's groups → questions into a single text
 *  block the client can read in the Portal Outstanding tab. We post
 *  the questionnaire AS the request body rather than asking the
 *  client to navigate elsewhere, because Outstanding-tab UI already
 *  supports free-text responses, file attachments and chat. */
function renderQuestionnaireAsText(name: string, description: string | null, groups: any[]): string {
  const lines: string[] = [];
  lines.push(name || 'Questionnaire');
  if (description && String(description).trim()) {
    lines.push('');
    lines.push(String(description).trim());
  }
  for (const g of Array.isArray(groups) ? groups : []) {
    const title = g?.title ? String(g.title) : '';
    if (title) {
      lines.push('');
      lines.push(`— ${title} —`);
    }
    for (const [i, q] of (Array.isArray(g?.questions) ? g.questions : []).entries()) {
      const text = q?.text ? String(q.text) : `Question ${i + 1}`;
      lines.push(`${i + 1}. ${text}`);
    }
  }
  // Subject (first line) + body (rest) — Outstanding tab's
  // cleanQuestion() splits on the first blank line.
  const subject = lines[0];
  const rest = lines.slice(1).join('\n');
  return `${subject}\n\n${rest}`;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await ctx.params;
  const guard = await assertEngagementWriteAccess(engagementId, session);
  if (guard instanceof NextResponse) return guard;

  const engagement = await loadEngagement(engagementId);
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const questionnaireId = typeof body?.questionnaireId === 'string' ? body.questionnaireId : '';
  const tabKey = typeof body?.tabKey === 'string' ? body.tabKey : '';
  const tabLabel = typeof body?.tabLabel === 'string' ? body.tabLabel : tabKey;
  if (!questionnaireId || !tabKey) {
    return NextResponse.json({ error: 'questionnaireId and tabKey are required' }, { status: 400 });
  }

  // The questionnaire must belong to this firm (admin-templates are
  // firm-scoped) — no cross-firm leakage even if the client guesses
  // an id from another tenant.
  const template = await prisma.methodologyTemplate.findUnique({ where: { id: questionnaireId } });
  if (!template || template.firmId !== engagement.firmId || template.templateType !== 'questionnaire') {
    return NextResponse.json({ error: 'Questionnaire not found for this firm' }, { status: 404 });
  }

  const items = (template.items as any) || {};
  const name = String(items.name || 'Questionnaire');
  const description = items.description ? String(items.description) : null;
  const groups = Array.isArray(items.groups) ? items.groups : [];
  const questionText = renderQuestionnaireAsText(`[${tabLabel}] ${name}`, description, groups);

  const portalRequest = await (prisma.portalRequest as any).create({
    data: {
      clientId: engagement.clientId,
      engagementId,
      section: sectionFor(tabKey),
      question: questionText,
      status: 'outstanding',
      requestedById: session.user.id,
      requestedByName: session.user.name || 'Audit Team',
      // Stash the questionnaire id + name + empty sign-off slots in
      // metadata so the engagement-side dispatcher can render
      // everything it needs without joining anything else.
      metadata: {
        kind: 'questionnaire_dispatch',
        questionnaireId,
        questionnaireName: name,
        tabKey,
        tabLabel,
        signOffs: {},
      },
    },
  });

  return NextResponse.json({ id: portalRequest.id, section: portalRequest.section });
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await ctx.params;
  const engagement = await loadEngagement(engagementId);
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const tabKey = new URL(req.url).searchParams.get('tabKey') || '';
  if (!tabKey) return NextResponse.json({ error: 'tabKey required' }, { status: 400 });

  const dispatches = await prisma.portalRequest.findMany({
    where: { engagementId, section: sectionFor(tabKey) },
    orderBy: { requestedAt: 'desc' },
    take: 50,
  });
  return NextResponse.json({ dispatches });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await ctx.params;
  const guard = await assertEngagementWriteAccess(engagementId, session);
  if (guard instanceof NextResponse) return guard;

  const engagement = await loadEngagement(engagementId);
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const requestId = new URL(req.url).searchParams.get('id') || '';
  if (!requestId) return NextResponse.json({ error: 'id query param required' }, { status: 400 });

  const body = await req.json().catch(() => null);
  const role = typeof body?.signOffRole === 'string' ? body.signOffRole : '';
  if (!ROLES.includes(role as SignOffRole)) {
    return NextResponse.json({ error: 'signOffRole must be one of preparer | reviewer | ri' }, { status: 400 });
  }

  const existing = await prisma.portalRequest.findUnique({ where: { id: requestId } }) as any;
  if (!existing || existing.engagementId !== engagementId) {
    return NextResponse.json({ error: 'Dispatch not found for this engagement' }, { status: 404 });
  }
  const data = (existing.metadata as any) || {};
  if (data.kind !== 'questionnaire_dispatch') {
    return NextResponse.json({ error: 'Not a questionnaire dispatch' }, { status: 400 });
  }

  // Toggle: if this role already signed, unsign. Otherwise stamp the
  // current user + timestamp.
  const signOffs: Record<string, any> = { ...(data.signOffs || {}) };
  if (signOffs[role]?.timestamp) {
    delete signOffs[role];
  } else {
    signOffs[role] = {
      userId: session.user.id,
      userName: session.user.name || session.user.email || 'User',
      timestamp: new Date().toISOString(),
    };
  }
  const nextResponseData = { ...data, signOffs };

  const updated = await (prisma.portalRequest as any).update({
    where: { id: requestId },
    data: { metadata: nextResponseData },
  });
  return NextResponse.json({ id: updated.id, signOffs: nextResponseData.signOffs });
}
