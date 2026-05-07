import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { findScheduleAction, renderOpeningMessage } from '@/lib/schedule-actions';
import { buildPortalUrl } from '@/lib/specialist-portal-token';
import { sendEmail } from '@/lib/email';
import { logEngagementAction } from '@/lib/engagement-action-log';

/**
 * Specialists items — server-side helper for creating items in
 * the Specialists tab (PF section `specialists_items`). The tab
 * itself persists user actions client-side; this endpoint is for
 * cases where the engagement runtime needs to create an item on
 * behalf of the user (e.g. when a Schedule Action fires from a
 * triggered answer on a schedule question).
 *
 * POST body shapes:
 *   1. Direct create — full item shape (kind, title, body, etc.)
 *      The endpoint appends it to the role's items list.
 *   2. Schedule-action create — `{ scheduleActionKey, response,
 *      questionText, questionId }`. The endpoint resolves the
 *      action from lib/schedule-actions, renders the opening
 *      message, and creates a chat item under that action's
 *      specialist role.
 *
 * Idempotency: when called with `{ scheduleActionKey, questionId }`
 * we tag the created item with a `sourceQuestionId` and skip
 * duplicate creation if an open item already exists for the same
 * question + action.
 */

const SECTION_KEY = 'specialists_items';

interface SignOffMap { [role: string]: { userId?: string; userName?: string; timestamp?: string } | undefined }
interface SpecialistItem {
  id: string;
  kind: 'chat' | 'report' | 'conclusion';
  title: string;
  createdAt: string;
  createdByName: string;
  body: string;
  messages: any[];
  signOffs: SignOffMap;
  status: 'open' | 'completed';
  // Tag the source question so re-firing the same trigger doesn't
  // duplicate the chat. Only set when the item was created via a
  // Schedule Action.
  sourceQuestionId?: string;
  sourceActionKey?: string;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> }
) {
  const session = await auth();
  const { engagementId } = await params;
  const access = await assertEngagementWriteAccess(engagementId, session);
  if (access instanceof NextResponse) return access;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Body required' }, { status: 400 });

  // Schedule-action shape: resolves the action and creates a chat
  // item under its specialist role. Idempotent on (action,
  // question) so a re-fire with the same answer doesn't pile up
  // duplicate chats.
  if (typeof body.scheduleActionKey === 'string') {
    const action = findScheduleAction(body.scheduleActionKey);
    if (!action) return NextResponse.json({ error: 'Unknown scheduleActionKey' }, { status: 400 });

    // Resolve the action target to the engagement's assigned
    // specialist on the Opening tab — NOT the firm-wide role config.
    // Reason: each engagement may have a specific specialist booked
    // (JST as the Tax Specialist for client X, AB&Co as the Tax
    // Specialist for client Y) and the schedule action must reach
    // the person actually assigned to THIS engagement. Firm-wide
    // config is only consulted to read the role's label so we can
    // fuzzy-match the action's hardcoded role-key to whichever
    // engagement specialist plays that role.
    const engagementForResolve = await prisma.auditEngagement.findUnique({
      where: { id: engagementId },
      select: {
        firmId: true,
        specialists: { select: { specialistType: true, name: true, email: true } },
      },
    });
    let firmRoles: any[] = [];
    if (engagementForResolve) {
      const rolesRow = await prisma.methodologyTemplate.findUnique({
        where: {
          firmId_templateType_auditType: {
            firmId: engagementForResolve.firmId,
            templateType: 'specialist_roles',
            auditType: 'ALL',
          },
        },
      });
      firmRoles = Array.isArray(rolesRow?.items) ? (rolesRow!.items as any[]) : [];
    }
    const engagementSpecialists = engagementForResolve?.specialists || [];
    const target = resolveActionTarget(action, engagementSpecialists, firmRoles);
    const resolvedRoleKey = target.storageKey;

    const existing = await prisma.auditPermanentFile.findUnique({
      where: { engagementId_sectionKey: { engagementId, sectionKey: SECTION_KEY } },
    });
    const blob = ((existing?.data ?? {}) as unknown) as Record<string, { items: SpecialistItem[] }>;
    const roleEntry = blob[resolvedRoleKey] || { items: [] };

    // Idempotency check — if there's already an OPEN chat for
    // this (questionId, actionKey) pair we don't create a new
    // one. Closed chats are exempt (the auditor may want to
    // reopen the conversation after re-answering).
    const questionId = typeof body.questionId === 'string' ? body.questionId : '';
    if (questionId) {
      const dupe = roleEntry.items.find(i =>
        i.sourceQuestionId === questionId &&
        i.sourceActionKey === action.key &&
        i.status === 'open'
      );
      if (dupe) return NextResponse.json({ created: false, item: dupe });
    }

    // Prefer the auditor-facing context body the form constructs
    // — it walks the trigger's sub-heading and lists every Q+A in
    // that block, giving the specialist full context. Falls back
    // to the action's hardcoded openingMessage template (single
    // Q+A) when the caller didn't supply one (legacy callers, or
    // edge cases where the form couldn't build it).
    const contextBody = typeof body.contextBody === 'string' ? body.contextBody.trim() : '';
    const renderedTemplate = renderOpeningMessage(action, {
      questionText: typeof body.questionText === 'string' ? body.questionText : '',
      response: typeof body.response === 'string' ? body.response : '',
    });
    const opening = contextBody
      ? `${action.label}\n\n${contextBody}`
      : renderedTemplate;
    const item: SpecialistItem = {
      id: `it_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      kind: 'chat',
      title: action.label,
      createdAt: new Date().toISOString(),
      createdByName: session?.user?.name || 'System',
      body: opening,
      messages: [],
      signOffs: {},
      status: 'open',
      sourceQuestionId: questionId || undefined,
      sourceActionKey: action.key,
    };
    const nextBlob = {
      ...blob,
      [resolvedRoleKey]: { items: [...roleEntry.items, item] },
    };
    await prisma.auditPermanentFile.upsert({
      where: { engagementId_sectionKey: { engagementId, sectionKey: SECTION_KEY } },
      create: { engagementId, sectionKey: SECTION_KEY, data: nextBlob as any },
      update: { data: nextBlob as any },
    });

    // Notify the specialist by email — the message includes a
    // magic-link to the External Specialist Portal scoped to this
    // engagement + role. Resolve the recipient from the firm's
    // specialist_roles config (Lead first, fall back to the first
    // member). Best-effort: an email failure logs but doesn't roll
    // back the chat creation, because the auditor can resend or
    // share the URL by hand if the provider is briefly down.
    //
    // Logging mirrors the schedule-reviews route so `[specialists/items]`
    // is greppable in Vercel logs for both success and failure, and
    // every fire writes a row to engagement_action_logs (action key
    // 'specialist.fire' / 'specialist.fire-failed') so the audit trail
    // captures who triggered what without depending on the email
    // provider's UI.
    let recipientEmail: string | null = null;
    let recipientName: string | null = null;
    let messageId: string | undefined;
    let emailStatus: 'sent' | 'failed' | 'no_recipient' | 'no_engagement' = 'no_engagement';
    let emailError: string | null = null;
    try {
      const engagement = await prisma.auditEngagement.findUnique({
        where: { id: engagementId },
        select: {
          firmId: true,
          client: { select: { clientName: true } },
          period: { select: { endDate: true } },
        },
      });
      if (engagement) {
        // Recipient comes from the engagement's assigned specialist
        // (resolved above). The firm-wide role config is only
        // consulted for the LABEL — never for the recipient — so a
        // schedule action always emails the person assigned on the
        // Opening tab.
        const recipient = target.recipientEmail
          ? { name: target.recipientName || '', email: target.recipientEmail }
          : null;
        if (recipient?.email) {
          recipientEmail = recipient.email;
          recipientName = recipient.name || null;
          const baseUrl = (process.env.NEXTAUTH_URL || 'https://acumon-website.vercel.app').replace(/\/+$/, '');
          const portalUrl = buildPortalUrl(baseUrl, {
            engagementId,
            roleKey: resolvedRoleKey,
            email: recipient.email,
          });
          const periodEnd = engagement.period?.endDate
            ? new Date(engagement.period.endDate).toLocaleDateString('en-GB')
            : '';
          const subject = `Specialist input requested — ${engagement.client.clientName}`;
          // Prefer the firm's role label over the resolved key — e.g.
          // 'Tax Specialist' rather than 'custom_role'. Falls back to
          // the resolved key spaced out if the firm role doesn't carry
          // a label.
          // Prefer the firm-role label for the resolved key — e.g.
          // 'Tax Specialist' rather than 'custom_role'. Falls back
          // to the resolved key spaced-out when no label is set.
          const firmRoleForLabel = firmRoles.find((r: any) => r?.key === resolvedRoleKey);
          const resolvedRoleLabel = (firmRoleForLabel?.label && String(firmRoleForLabel.label).trim()) || resolvedRoleKey.replace(/_/g, ' ');
          const html = `
            <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#334155">
              <h2 style="color:#1e40af;margin-bottom:4px">Specialist input requested</h2>
              <p>Hi ${escapeHtml(recipient.name || recipient.email)},</p>
              <p>
                The audit team for <strong>${escapeHtml(engagement.client.clientName)}</strong>${periodEnd ? ` (period ended ${escapeHtml(periodEnd)})` : ''}
                has opened a chat with you for the <strong>${escapeHtml(resolvedRoleLabel)}</strong> role.
              </p>
              <p><strong>Action:</strong> ${escapeHtml(action.label)}</p>
              <blockquote style="border-left:3px solid #cbd5e1;padding:8px 12px;color:#475569;margin:16px 0">
                ${escapeHtml(opening).replace(/\n/g, '<br>')}
              </blockquote>
              <p>Click below to open your scoped portal — read the question, reply, and attach files:</p>
              <p style="text-align:center;margin:24px 0">
                <a href="${portalUrl}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">Open specialist portal</a>
              </p>
              <p style="font-size:12px;color:#94a3b8">
                This link is private — it gives you access to this engagement and this role only. Do not forward it.
              </p>
            </div>`;
          console.log(`[specialists/items] Sending portal email — engagement=${engagementId} action=${action.key} actionRole=${action.specialistRoleKey} resolvedRole=${resolvedRoleKey} to=${recipient.email}`);
          try {
            const result = await sendEmail(recipient.email, subject, html, { displayName: recipient.name });
            messageId = result?.messageId;
            emailStatus = 'sent';
            console.log(`[specialists/items] Portal email accepted by provider — messageId=${messageId || '(none)'} to=${recipient.email}`);
          } catch (sendErr: any) {
            emailStatus = 'failed';
            emailError = sendErr?.message || String(sendErr);
            console.error(`[specialists/items] Portal email FAILED — to=${recipient.email} — ${emailError}`);
          }
        } else {
          emailStatus = 'no_recipient';
          console.warn(`[specialists/items] No recipient configured for resolvedRole=${resolvedRoleKey} (action role=${action.specialistRoleKey}) — chat created but no email sent. Add a Lead email or active member under Methodology Admin → Specialist Roles.`);
        }

        // Engagement action log — single row per fire, success OR
        // failure, so the audit trail tells the auditor "the chat for
        // this trigger went out at 10:42 to alice@firm.com" even if
        // they don't have access to Vercel logs.
        await logEngagementAction({
          engagementId,
          firmId: engagement.firmId,
          actorUserId: session?.user?.id || null,
          actorName: session?.user?.name || session?.user?.email || 'system',
          action: emailStatus === 'sent' ? 'specialist.fire' : `specialist.fire-${emailStatus}`,
          summary: emailStatus === 'sent'
            ? `Schedule action "${action.label}" fired — chat opened with ${resolvedRoleKey.replace(/_/g, ' ')} (${recipientEmail})`
            : emailStatus === 'failed'
              ? `Schedule action "${action.label}" fired — chat created but email to ${recipientEmail} FAILED: ${emailError}`
              : `Schedule action "${action.label}" fired — chat created but no email sent (${emailStatus === 'no_recipient' ? 'no recipient configured' : 'engagement lookup failed'})`,
          targetType: 'specialist_chat',
          targetId: item.id,
          metadata: {
            actionKey: action.key,
            actionRoleKey: action.specialistRoleKey,
            resolvedRoleKey,
            resolvedSource: target.resolvedSource,
            sourceQuestionId: questionId || null,
            recipientEmail,
            recipientName,
            messageId: messageId || null,
            emailStatus,
            emailError,
          },
        });
      }
    } catch (emailErr: any) {
      console.error('[specialists/items] portal email block threw:', emailErr?.message || emailErr);
      // Swallow — the chat is created and the auditor can still
      // share the URL manually or trigger again.
    }

    return NextResponse.json({ created: true, item, messageId, emailStatus });
  }

  // Direct shape: caller supplies the full item. Used by the
  // SpecialistsTab itself when persisting via this endpoint
  // (although today the tab uses /permanent-file directly — kept
  // here for symmetry).
  if (typeof body.roleKey === 'string' && body.item && typeof body.item === 'object') {
    const existing = await prisma.auditPermanentFile.findUnique({
      where: { engagementId_sectionKey: { engagementId, sectionKey: SECTION_KEY } },
    });
    const blob = ((existing?.data ?? {}) as unknown) as Record<string, { items: SpecialistItem[] }>;
    const roleEntry = blob[body.roleKey] || { items: [] };
    const item: SpecialistItem = body.item;
    const nextBlob = {
      ...blob,
      [body.roleKey]: { items: [...roleEntry.items, item] },
    };
    await prisma.auditPermanentFile.upsert({
      where: { engagementId_sectionKey: { engagementId, sectionKey: SECTION_KEY } },
      create: { engagementId, sectionKey: SECTION_KEY, data: nextBlob as any },
      update: { data: nextBlob as any },
    });
    return NextResponse.json({ created: true, item });
  }

  return NextResponse.json({ error: 'Provide either scheduleActionKey + question fields, or roleKey + item' }, { status: 400 });
}

/**
 * Resolve a schedule-action target to the engagement's assigned
 * specialist (set on the Opening tab). The hardcoded
 * `action.specialistRoleKey` (e.g. 'tax_technical' from
 * SCHEDULE_ACTIONS) is matched against the role key + the firm's
 * configured label for that key, against each engagement specialist
 * — the highest-scoring engagement specialist becomes the target.
 *
 * Why this routing instead of the firm-wide config: each engagement
 * may have its own specialist booked (different Tax Specialist for
 * different clients), and the schedule action MUST reach the person
 * actually assigned to THIS engagement, not the firm-default lead.
 *
 * Strategy:
 *   1. Exact match on engagement specialistType. Wins immediately.
 *   2. Otherwise, score each engagement specialist by overlap of
 *      stem words from the action (role-key + label) against that
 *      specialist's specialistType + the firm-role label for that
 *      key. Stops words ('consult', 'specialist', 'with', etc) and
 *      stems shorter than 3 chars are dropped to avoid noise.
 *   3. Highest non-zero scoring engagement specialist wins. The
 *      storage key is that specialist's specialistType, and the
 *      recipient is its name + email.
 *   4. If no engagement specialist plausibly matches, fall back to
 *      the firm-role config (lead / first member email) — same
 *      shape the firm-wide flow used historically. Records
 *      `resolvedSource: 'firm-role'` so the audit log captures it.
 *   5. Last resort: hardcoded action key, no recipient. The chat
 *      is still created so the work isn't lost; emailStatus will
 *      be 'no_recipient' in the audit log.
 */
function resolveActionTarget(
  action: { key: string; label: string; specialistRoleKey: string },
  engagementSpecialists: Array<{ specialistType: string; name: string; email: string | null }>,
  firmRoles: Array<{ key: string; label?: string; name?: string; email?: string; members?: Array<{ name?: string; email?: string }>; isActive?: boolean }>,
): {
  storageKey: string;
  recipientEmail: string | null;
  recipientName: string | null;
  resolvedRoleKey: string;
  resolvedSource: 'engagement-specialist' | 'firm-role' | 'fallback';
} {
  // Build a key→label index from the firm-role config for matching.
  const firmLabelByKey: Record<string, string> = {};
  for (const r of firmRoles) {
    if (r?.key) firmLabelByKey[r.key] = String(r.label || '');
  }

  // 1. Exact specialistType match against an engagement specialist.
  const exactSpec = engagementSpecialists.find(s => s.specialistType === action.specialistRoleKey);
  if (exactSpec) {
    return {
      storageKey: exactSpec.specialistType,
      recipientEmail: exactSpec.email || null,
      recipientName: exactSpec.name || null,
      resolvedRoleKey: exactSpec.specialistType,
      resolvedSource: 'engagement-specialist',
    };
  }

  // 2. Stem-overlap score against each engagement specialist.
  const STOPWORDS = new Set(['consult', 'specialist', 'with', 'and', 'the', 'role']);
  const stems = `${action.specialistRoleKey} ${action.label}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(s => s.length >= 3 && !STOPWORDS.has(s));

  if (stems.length > 0 && engagementSpecialists.length > 0) {
    let best: { spec: typeof engagementSpecialists[number]; score: number } | null = null;
    for (const spec of engagementSpecialists) {
      const haystack = `${spec.specialistType} ${firmLabelByKey[spec.specialistType] || ''}`.toLowerCase();
      const score = stems.reduce((s, stem) => s + (haystack.includes(stem) ? 1 : 0), 0);
      if (score > 0 && (!best || score > best.score)) best = { spec, score };
    }
    if (best) {
      return {
        storageKey: best.spec.specialistType,
        recipientEmail: best.spec.email || null,
        recipientName: best.spec.name || null,
        resolvedRoleKey: best.spec.specialistType,
        resolvedSource: 'engagement-specialist',
      };
    }
  }

  // 3. Fallback: firm-role lead / first-member. This keeps the chat
  //    addressable when no specialist has been assigned to the
  //    engagement yet but the firm has the role configured.
  const activeFirmRoles = firmRoles.filter(r => r && r.key && r.isActive !== false);
  const firmExact = activeFirmRoles.find(r => r.key === action.specialistRoleKey);
  const firmFuzzy = !firmExact && stems.length > 0
    ? activeFirmRoles
      .map(r => ({
        r,
        score: stems.reduce((s, stem) => s + (`${r.key} ${r.label || ''}`.toLowerCase().includes(stem) ? 1 : 0), 0),
      }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.r
    : undefined;
  const firmRole = firmExact || firmFuzzy;
  if (firmRole) {
    const lead = firmRole.email ? { name: firmRole.name || '', email: String(firmRole.email).toLowerCase() } : null;
    const firstMember = Array.isArray(firmRole.members)
      ? firmRole.members.find(m => m?.email)
      : null;
    const recipient = lead || (firstMember ? { name: firstMember.name || '', email: String(firstMember.email).toLowerCase() } : null);
    return {
      storageKey: firmRole.key,
      recipientEmail: recipient?.email || null,
      recipientName: recipient?.name || null,
      resolvedRoleKey: firmRole.key,
      resolvedSource: 'firm-role',
    };
  }

  // 4. Last resort.
  return {
    storageKey: action.specialistRoleKey,
    recipientEmail: null,
    recipientName: null,
    resolvedRoleKey: action.specialistRoleKey,
    resolvedSource: 'fallback',
  };
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
