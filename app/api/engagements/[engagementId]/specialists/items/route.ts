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

    // Resolve the action's hardcoded specialistRoleKey against the
    // firm's actual configured specialist roles. Reason: SCHEDULE_ACTIONS
    // ships fixed keys like 'tax_technical', but firms in the wild
    // may have set up a role with a different key (e.g. 'custom_role'
    // labelled 'Tax Specialist'). Without this lookup, schedule-action
    // chats land in a ghost bucket the SpecialistsTab can't merge with
    // the firm-configured role, producing a duplicate sub-tab.
    //
    // We fetch the engagement + firm roles up-front so storage,
    // idempotency check, recipient lookup, portal URL, and audit-log
    // metadata all use the SAME resolved key. Falls back to the
    // hardcoded action.specialistRoleKey when no firm role plausibly
    // matches — the chat still gets created (under the original key);
    // an admin can map roles later and re-fire.
    const engagementForResolve = await prisma.auditEngagement.findUnique({
      where: { id: engagementId },
      select: { firmId: true },
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
    const resolvedRoleKey = resolveFirmRoleKey(action, firmRoles);

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

    const opening = renderOpeningMessage(action, {
      questionText: typeof body.questionText === 'string' ? body.questionText : '',
      response: typeof body.response === 'string' ? body.response : '',
    });
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
        // Reuse the firm-roles list we already loaded for the resolver
        // — saves a round trip and keeps recipient lookup consistent
        // with the storage key. If the resolver fell back to the
        // hardcoded action key (no firm role matched) the role
        // lookup here will also miss; in that case emailStatus
        // becomes 'no_recipient' and the audit log captures it.
        const role = firmRoles.find((r: any) => r.key === resolvedRoleKey && r.isActive !== false);
        const lead = role?.email ? { name: role.name || '', email: String(role.email).toLowerCase() } : null;
        const firstMember = Array.isArray(role?.members)
          ? role.members.find((m: any) => m?.email)
          : null;
        const recipient = lead || (firstMember ? { name: firstMember.name || '', email: String(firstMember.email).toLowerCase() } : null);
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
          const resolvedRoleLabel = (role?.label && String(role.label).trim()) || resolvedRoleKey.replace(/_/g, ' ');
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
 * Map a hardcoded SCHEDULE_ACTIONS specialistRoleKey to a key that
 * actually exists in the firm's specialist-roles config.
 *
 * Strategy:
 *   1. Exact key match wins (e.g. 'ethics_partner' on a firm that
 *      kept the seed key).
 *   2. Otherwise, score each firm role by how many stem-words from
 *      the action's role-key + label appear in the firm role's
 *      key + label (case-insensitive). Stems shorter than 3 chars
 *      are dropped to avoid noise like 'it', 'a', 'on'.
 *   3. Highest non-zero scoring firm role wins. Ties resolved by
 *      first occurrence in the firm-roles list.
 *   4. If nothing scores, fall back to the action's hardcoded key —
 *      the chat still gets created (under that key) and an admin
 *      can map roles later.
 */
function resolveFirmRoleKey(
  action: { key: string; label: string; specialistRoleKey: string },
  firmRoles: Array<{ key: string; label?: string; isActive?: boolean }>,
): string {
  const active = firmRoles.filter(r => r && r.key && r.isActive !== false);
  // 1. Exact key match
  const exact = active.find(r => r.key === action.specialistRoleKey);
  if (exact) return exact.key;

  // 2. Score by overlapping stems
  const STOPWORDS = new Set(['consult', 'specialist', 'with', 'and', 'the', 'role']);
  const stems = `${action.specialistRoleKey} ${action.label}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(s => s.length >= 3 && !STOPWORDS.has(s));
  if (stems.length === 0) return action.specialistRoleKey;

  let bestKey = action.specialistRoleKey;
  let bestScore = 0;
  for (const r of active) {
    const haystack = `${r.key} ${r.label || ''}`.toLowerCase();
    const score = stems.reduce((s, stem) => s + (haystack.includes(stem) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestKey = r.key;
    }
  }
  return bestKey;
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
