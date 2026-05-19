import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { sendEmail } from '@/lib/email';

/**
 * POST /api/engagements/[id]/info-requests/run-action
 *
 * Executes one of the three action kinds the Schedule Designer can
 * attach to an Initial Information Request item. Body:
 *
 *   { itemId: string,
 *     action: 'request_portal' | 'message_client' | 'third_party',
 *     thirdPartyEmail?: string,      // required when action='third_party'
 *     thirdPartyName?: string,        // optional display name
 *     thirdPartyMessage?: string }    // optional extra body text
 *
 * On success the auditInformationRequest row's `lastActionAt` is
 * stamped so the UI can grey out the Run button and surface "last sent
 * on" tooltip detail.
 */

type Ctx = { params: Promise<{ engagementId: string }> };
type ActionKind = 'request_portal' | 'message_client' | 'third_party';

const VALID_ACTIONS: ReadonlyArray<ActionKind> = ['request_portal', 'message_client', 'third_party'];

export async function POST(req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { engagementId } = await ctx.params;
  const guard = await assertEngagementWriteAccess(engagementId, session);
  if (guard instanceof NextResponse) return guard;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: {
      id: true, firmId: true, clientId: true,
      teamMembers: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (engagement.firmId !== session.user.firmId && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const itemId: string = typeof body?.itemId === 'string' ? body.itemId : '';
  const action: ActionKind | '' = typeof body?.action === 'string' ? body.action : '';
  if (!itemId || !VALID_ACTIONS.includes(action as ActionKind)) {
    return NextResponse.json({ error: 'itemId and a valid action are required' }, { status: 400 });
  }

  const item = await prisma.auditInformationRequest.findUnique({ where: { id: itemId } });
  if (!item || item.engagementId !== engagementId) {
    return NextResponse.json({ error: 'Info request item not found for this engagement' }, { status: 404 });
  }

  let outcome: Record<string, unknown> = {};

  if (action === 'request_portal') {
    outcome = await runRequestPortal(engagement.clientId, engagementId, item.description, session.user);
  } else if (action === 'message_client') {
    outcome = await runMessageClient(engagement, item.description, session.user);
  } else if (action === 'third_party') {
    const to = typeof body?.thirdPartyEmail === 'string' ? body.thirdPartyEmail.trim() : '';
    if (!/.+@.+\..+/.test(to)) {
      return NextResponse.json({ error: 'thirdPartyEmail is required for third-party actions' }, { status: 400 });
    }
    const name = typeof body?.thirdPartyName === 'string' ? body.thirdPartyName : '';
    const extra = typeof body?.thirdPartyMessage === 'string' ? body.thirdPartyMessage : '';
    outcome = await runThirdParty(to, name, item.description, extra, session.user);
  }

  // Stamp the row so the Opening tab can show "last sent on" / grey out
  // the Run button. Using `as any` because the column was added in a
  // recent schema change; not every dev DB has had `prisma db push`
  // run against it yet.
  await (prisma.auditInformationRequest as any).update({
    where: { id: itemId },
    data: { lastActionAt: new Date() },
  });

  return NextResponse.json({ ok: true, action, ...outcome });
}

/** Action 1: post an Outstanding portal request asking the client to
 *  supply the named item. Mirrors what the walkthrough-request route
 *  does for walkthroughs. */
async function runRequestPortal(
  clientId: string,
  engagementId: string,
  description: string,
  user: { id: string; name?: string | null; email?: string | null },
) {
  const subject = `Information request: ${description}`;
  // OutstandingTab parses subject \n\n body, so the formatting we use
  // here matters — keep the subject single-line, drop a one-sentence
  // body underneath.
  const question = `${subject}\n\nPlease upload or describe how this is covered for this engagement.`;
  const created = await prisma.portalRequest.create({
    data: {
      clientId,
      engagementId,
      section: 'questions',
      question,
      status: 'outstanding',
      requestedById: user.id,
      requestedByName: user.name || user.email || 'Audit Team',
    },
  });
  return { portalRequestId: created.id, kind: 'request_portal' };
}

/** Action 2: like request_portal, but the description is interpreted
 *  into a richer message body by a small registry. Add a new entry to
 *  `INTERPRETATIONS` below to wire up a new natural-language item.
 *  Items the registry doesn't recognise fall through to a plain
 *  request_portal-style ask so nothing silently fails. */
async function runMessageClient(
  engagement: {
    id: string;
    clientId: string;
    teamMembers: Array<{ role: string; user: { id: string; name: string | null; email: string | null } | null }>;
  },
  description: string,
  user: { id: string; name?: string | null; email?: string | null },
) {
  const interpretation = matchInterpretation(description);
  let subject = description;
  let body = '';

  if (interpretation === 'team_notification') {
    // Exclude specialists — only proper team members. Specialists live
    // in AuditEngagement.specialists, not teamMembers, so filtering by
    // teamMembers is already correct on that score; we also drop any
    // bench rows without a resolved user.
    const team = engagement.teamMembers
      .filter(m => m.user)
      .map(m => `• ${m.user!.name || '—'} — ${m.role}`)
      .join('\n');
    subject = 'Notification of Audit Team';
    body = team.length > 0
      ? `Please note the team that will be carrying out your audit:\n\n${team}\n\nPlease let us know if you have any questions.`
      : 'Your audit team will be confirmed shortly. We\'ll send another notification once it\'s finalised.';
  } else {
    // No registry hit — treat as a regular portal ask so the auditor
    // isn't left wondering what happened.
    body = `Please provide / confirm: ${description}.`;
  }

  const question = `${subject}\n\n${body}`;
  const created = await prisma.portalRequest.create({
    data: {
      clientId: engagement.clientId,
      engagementId: engagement.id,
      section: 'questions',
      question,
      status: 'outstanding',
      requestedById: user.id,
      requestedByName: user.name || user.email || 'Audit Team',
    },
  });
  return { portalRequestId: created.id, kind: 'message_client', interpretation };
}

/** Action 3: send the item to an external email address (third party
 *  expert, bank, lawyer etc.). Uses the same Azure-backed sendEmail
 *  helper everything else uses. */
async function runThirdParty(
  to: string,
  displayName: string,
  description: string,
  extraMessage: string,
  user: { id: string; name?: string | null; email?: string | null },
) {
  const subject = `Information request from your audit team: ${description}`;
  const html = `
    <p>${displayName ? `Dear ${displayName},` : 'Hello,'}</p>
    <p>We are carrying out the audit and would be grateful for the following information:</p>
    <blockquote style="border-left: 3px solid #6366f1; padding-left: 12px; margin: 12px 0; color: #334155;">
      ${escapeHtml(description)}
    </blockquote>
    ${extraMessage ? `<p>${escapeHtml(extraMessage).replace(/\n/g, '<br/>')}</p>` : ''}
    <p>Please reply to this email or contact ${user.name || user.email || 'your audit team'} directly with the requested information.</p>
    <p>Many thanks,<br/>${user.name || 'Audit Team'}</p>
  `;
  const { messageId } = await sendEmail(to, subject, html, { displayName: displayName || undefined });
  return { messageId, kind: 'third_party', to };
}

/** Maps the description text to an interpretation handler. Keep this
 *  list lower-case + trimmed; matching is case-insensitive substring
 *  to tolerate the slight wording differences firms use. */
const INTERPRETATIONS: Array<{ phrases: string[]; key: 'team_notification' }> = [
  { phrases: ['notification of team', 'notification of audit team', 'audit team notification'], key: 'team_notification' },
];

function matchInterpretation(description: string): 'team_notification' | null {
  const norm = description.toLowerCase().trim();
  for (const entry of INTERPRETATIONS) {
    for (const phrase of entry.phrases) {
      if (norm.includes(phrase)) return entry.key;
    }
  }
  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
