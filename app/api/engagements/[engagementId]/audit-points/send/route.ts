import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { logEngagementAction, resolveActor } from '@/lib/engagement-action-log';
import { AUDIT_POINT_SAFE_SELECT } from '@/lib/audit-points-select';
import { buildRoutingForNewRequest } from '@/lib/portal-request-routing';

/**
 * POST /api/engagements/[engagementId]/audit-points/send
 *
 * Send an existing audit-point (typically an RI matter) to one of
 * three external surfaces. Body shape:
 *
 *   { id, target: 'portal' | 'technical' | 'ethics', message?, summary? }
 *
 *   target = 'portal'
 *     Creates a PortalRequest linked to the engagement, section=
 *     'ri_matters'. Question text is the caller's covering message
 *     (falls back to the matter's description). Client responds via
 *     the normal portal flow; responses sync back to the matter via
 *     the existing chatHistory plumbing on the portal side.
 *
 *   target = 'technical' | 'ethics'
 *     Sends an email to the firm's configured specialist role,
 *     carrying the matter's chat history, attachments, and an
 *     AI-generated (or user-edited) summary plus the caller's
 *     covering message. No DB-side state change on the matter
 *     itself beyond the audit-log entry.
 *
 * All three land in the engagement audit log with a distinct action
 * slug so the Outstanding-tab audit trail captures who sent what to
 * whom, when.
 */
type Ctx = { params: Promise<{ engagementId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await ctx.params;

  const eng = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    include: {
      client: { select: { id: true, clientName: true } },
      period: { select: { endDate: true } },
      firm: { select: { id: true, name: true } },
    },
  });
  if (!eng || (eng.firmId !== session.user.firmId && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json();
  const { id, target, message, summary } = body as {
    id: string; target: 'portal' | 'technical' | 'ethics'; message?: string; summary?: string;
  };
  if (!id || !target) return NextResponse.json({ error: 'id and target required' }, { status: 400 });

  const point = await prisma.auditPoint.findUnique({ where: { id }, select: { ...AUDIT_POINT_SAFE_SELECT } });
  if (!point || point.engagementId !== engagementId) {
    return NextResponse.json({ error: 'Audit point not found' }, { status: 404 });
  }

  const actor = await resolveActor(engagementId, session);

  // ── Portal ──────────────────────────────────────────────────────
  // Simple question creation on the client portal. The covering
  // message is the question text; attachments on the matter are
  // surfaced as evidence tags in the chat history so the client can
  // see what the auditor was referring to.
  if (target === 'portal') {
    const question = (message?.trim() || point.description || '').slice(0, 2000);
    if (!question) return NextResponse.json({ error: 'Covering message or matter description required' }, { status: 400 });

    const attachments = Array.isArray(point.attachments) ? (point.attachments as any[]) : [];
    const initialChat = [
      {
        from: 'firm',
        name: session.user.name || session.user.email || 'Auditor',
        message: question,
        timestamp: new Date().toISOString(),
        attachments: attachments.map(a => ({ name: a?.name || 'attachment', url: a?.url, uploadId: a?.uploadId, storagePath: a?.storagePath })),
      },
    ];

    // Portal Principal routing — RI matters don't carry FS-Line
    // context by design (they're cross-cutting), so the routing
    // helper will land this with the Portal Principal who can then
    // manually reassign if it's actually FS-specific. That matches
    // the spec's "messages outside FS Lines go to the Principal".
    const routing = await buildRoutingForNewRequest({ engagementId });

    const created = await prisma.portalRequest.create({
      data: {
        clientId: eng.clientId,
        engagementId,
        section: 'ri_matters',
        question: `[RI matter #${point.chatNumber}] ${question}`,
        status: 'outstanding',
        requestedById: session.user.id,
        requestedByName: session.user.name || session.user.email || '',
        chatHistory: initialChat as any,
        ...routing,
      } as any,
    });

    if (actor) {
      await logEngagementAction({
        engagementId,
        firmId: actor.firmId,
        actorUserId: actor.actorUserId,
        actorName: actor.actorName,
        action: 'audit-point.send-portal',
        summary: `Sent RI matter #${point.chatNumber} to client portal`,
        targetType: 'portal_request',
        targetId: created.id,
        metadata: { riMatterId: point.id, riMatterChatNumber: point.chatNumber },
      });
    }

    return NextResponse.json({ ok: true, portalRequestId: created.id });
  }

  // ── Technical / Ethics ─────────────────────────────────────────
  // Both land in the same email-based path. The target role is
  // looked up on the firm's specialist_roles template; the role
  // slug is the only difference between the two.
  if (target === 'technical' || target === 'ethics') {
    const roleSlug = target === 'technical' ? 'technical' : 'ethics_partner';
    const rolesRow = await prisma.methodologyTemplate.findUnique({
      where: {
        firmId_templateType_auditType: { firmId: eng.firmId, templateType: 'specialist_roles', auditType: 'ALL' },
      },
    }).catch(() => null);
    const roles = Array.isArray(rolesRow?.items) ? rolesRow!.items as any[] : [];
    // Accept either the exact slug or a loose label match — admins
    // sometimes configure 'technical_advisor' instead of 'technical'.
    const match = roles.find((r: any) =>
      r.isActive !== false
      && (r.key === roleSlug
        || (target === 'technical' && /technical/i.test(String(r.key || r.label || '')))
        || (target === 'ethics' && /ethics/i.test(String(r.key || r.label || '')))
      )
    );
    const toEmail = (match?.email || '').toLowerCase();
    const toName = match?.name || '';
    if (!toEmail) {
      return NextResponse.json({
        error: `No ${target === 'technical' ? 'Technical' : 'Ethics Partner'} email configured. Ask the Methodology Admin to set one under Methodology Admin → Specialist Roles.`,
      }, { status: 422 });
    }

    const covering = (message || '').trim();
    const aiSummary = (summary || '').trim();
    const responses = Array.isArray(point.responses) ? (point.responses as any[]) : [];
    const attachments = Array.isArray(point.attachments) ? (point.attachments as any[]) : [];

    // Build the email body. Plain HTML, inline rather than templated —
    // specialist review uses the same pattern in /api/engagements/…/
    // schedule-reviews so the look is consistent.
    const periodEnd = eng.period?.endDate ? new Date(eng.period.endDate).toLocaleDateString('en-GB') : '';
    const subject = `${target === 'technical' ? 'Technical' : 'Ethics'} review — ${eng.client.clientName} RI matter #${point.chatNumber}`;
    const chatHtml = responses.length === 0
      ? '<p style="color:#94a3b8;font-style:italic">No thread yet.</p>'
      : responses.map((r: any) => `
          <div style="border-left:3px solid #cbd5e1;padding:6px 10px;margin:8px 0;color:#334155">
            <div style="font-size:11px;color:#64748b"><strong>${escapeHtml(r.userName || 'unknown')}</strong> · ${escapeHtml(new Date(r.createdAt || '').toLocaleString('en-GB'))}</div>
            <div style="white-space:pre-wrap;font-size:13px">${escapeHtml(r.message || '')}</div>
          </div>`).join('');
    const attHtml = attachments.length === 0 ? '' : `
        <h4 style="margin:16px 0 4px;color:#1e40af">Attachments</h4>
        <ul style="font-size:12px;color:#475569">${attachments.map((a: any) => `<li>${escapeHtml(a?.name || 'attachment')}${a?.url ? ` — <a href="${escapeHtml(a.url)}">open</a>` : ''}</li>`).join('')}</ul>`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#334155">
        <h2 style="color:#1e40af;margin-bottom:4px">${subject}</h2>
        <p style="color:#64748b;font-size:12px">
          Client: <strong>${escapeHtml(eng.client.clientName)}</strong>${periodEnd ? ` · Period ended ${escapeHtml(periodEnd)}` : ''}<br>
          Sent by ${escapeHtml(session.user.name || 'auditor')} on ${escapeHtml(new Date().toLocaleString('en-GB'))}
        </p>
        ${covering ? `<h4 style="margin:14px 0 4px">Covering message</h4><p style="white-space:pre-wrap">${escapeHtml(covering)}</p>` : ''}
        ${aiSummary ? `<h4 style="margin:14px 0 4px">Summary</h4><p style="white-space:pre-wrap;background:#f1f5f9;border-radius:6px;padding:8px 10px">${escapeHtml(aiSummary)}</p>` : ''}
        <h4 style="margin:16px 0 4px">Original matter</h4>
        <p style="white-space:pre-wrap;font-size:13px">${escapeHtml(point.description || '')}</p>
        <h4 style="margin:16px 0 4px">Thread</h4>
        ${chatHtml}
        ${attHtml}
      </div>`;

    let messageId: string | undefined;
    try {
      const result = await sendEmail(toEmail, subject, html, { displayName: toName });
      messageId = result?.messageId;
    } catch (err: any) {
      return NextResponse.json({ error: `Email failed: ${err?.message || 'unknown'}` }, { status: 500 });
    }

    if (actor) {
      await logEngagementAction({
        engagementId,
        firmId: actor.firmId,
        actorUserId: actor.actorUserId,
        actorName: actor.actorName,
        action: target === 'technical' ? 'audit-point.send-technical' : 'audit-point.send-ethics',
        summary: `Sent RI matter #${point.chatNumber} to ${target === 'technical' ? 'Technical' : 'Ethics Partner'} (${toName || toEmail})`,
        targetType: 'audit_point',
        targetId: point.id,
        metadata: { riMatterId: point.id, role: roleSlug, toEmail, messageId },
      });
    }

    return NextResponse.json({ ok: true, messageId, to: { name: toName, email: toEmail } });
  }

  return NextResponse.json({ error: 'Unknown target' }, { status: 400 });
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
