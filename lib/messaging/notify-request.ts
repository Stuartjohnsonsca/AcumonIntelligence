/**
 * notifyOnPortalRequestCreated — convenience wrapper that resolves the
 * recipient portal user(s) for a freshly-created PortalRequest and
 * dispatches a WhatsApp / Telegram / SMS nudge across whichever
 * channels they've opted into.
 *
 * Usage from a route handler / action:
 *
 *   const request = await prisma.portalRequest.create({ … });
 *   await notifyOnPortalRequestCreated(request.id);
 *
 * The function never throws — channel-level failures are logged via
 * the underlying portal_messages persistence so the call site stays
 * simple. Email sends remain the caller's responsibility (the
 * existing email helpers fire separately).
 */

import { prisma } from '@/lib/db';
import { notifyPortalUser } from './index';
import { sendWeComGroupMessage } from './wecom';
import { resolvePortalPublicUrl } from '@/lib/portal-public-url';

interface NotifyOpts {
  /** Override the portal URL embedded in the message. When omitted
   *  we resolve dynamically (PORTAL_PUBLIC_URL env, then Vercel's
   *  auto-set VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL, then null
   *  for "no link"). See lib/portal-public-url.ts. */
  portalBaseUrl?: string;
  /** Optional request host (e.g. req.headers.host) — when the caller
   *  has request context this beats every env-var-derived fallback. */
  requestHost?: string | null;
  /** Override the message body. When omitted, a short default is built
   *  from the request's section + question. */
  body?: string;
}

export async function notifyOnPortalRequestCreated(
  requestId: string,
  opts: NotifyOpts = {},
): Promise<void> {
  const req = await prisma.portalRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      clientId: true,
      engagementId: true,
      section: true,
      question: true,
      assignedPortalUserId: true,
    },
  });
  if (!req) return;

  // Engagement-level lookup happens once and is reused for the two
  // delivery channels:
  //   1. Per-user notifyPortalUser (SMS / WhatsApp / Telegram / WeChat
  //      via per-user opt-ins).
  //   2. The engagement's WeCom Group Robot, when configured. Posts
  //      the same body so every group member (audit team + clients
  //      added via External Contact) sees the alert.
  const engagement = req.engagementId
    ? await prisma.auditEngagement.findUnique({
        where: { id: req.engagementId },
        select: { portalPrincipalId: true, wecomGroupWebhookUrl: true },
      })
    : null;

  // Resolution rule for the per-user channels:
  //   1. Use the assigned portal user if set (work-allocation routing
  //      will have written this for FS-line-tagged requests).
  //   2. Else fall back to the engagement's Portal Principal so
  //      someone gets a heads-up.
  const portalUserId = req.assignedPortalUserId || engagement?.portalPrincipalId || null;

  const portalBase = opts.portalBaseUrl
    ? opts.portalBaseUrl.replace(/\/+$/, '')
    : resolvePortalPublicUrl({ requestHost: opts.requestHost });
  const link = portalBase
    ? `${portalBase}/portal/dashboard?clientId=${encodeURIComponent(req.clientId)}`
    : null;

  const body = opts.body || (() => {
    const sectionLabel = sectionToLabel(req.section);
    const preview = req.question.length > 140 ? req.question.slice(0, 137) + '…' : req.question;
    const lines = [
      `New ${sectionLabel} request from your auditors:`,
      preview,
    ];
    if (link) lines.push('Open the portal: ' + link);
    return lines.join('\n\n');
  })();

  // Per-user channels (fires only when we resolved a user).
  if (portalUserId) {
    await notifyPortalUser({
      portalUserId,
      body,
      relatedRequestId: req.id,
    });
  }

  // Per-engagement WeCom Group Robot — independent of per-user
  // resolution so the audit firm + client group sees the alert even
  // when nobody is assigned yet. Failures are logged; never throw
  // (the email + per-user channels above are the user-facing
  // contract).
  if (engagement?.wecomGroupWebhookUrl) {
    try {
      const result = await sendWeComGroupMessage({
        channel: 'wechat',
        to: engagement.wecomGroupWebhookUrl,
        webhookUrl: engagement.wecomGroupWebhookUrl,
        body,
      });
      if (!result.ok) {
        console.error('[notifyOnPortalRequestCreated] WeCom post failed', result.error);
      }
    } catch (err) {
      console.error('[notifyOnPortalRequestCreated] WeCom post threw', err);
    }
  }
}

function sectionToLabel(section: string): string {
  switch (section) {
    case 'questions': return 'question';
    case 'calculations': return 'calculation';
    case 'evidence': return 'evidence';
    case 'connections': return 'connections';
    default: return section || 'portal';
  }
}
