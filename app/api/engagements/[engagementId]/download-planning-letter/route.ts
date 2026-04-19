import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { renderTemplateToDocx } from '@/lib/template-render';

/**
 * POST /api/engagements/:engagementId/download-planning-letter
 *
 * Simpler cousin of send-planning-letter — renders the chosen
 * Planning Letter document template for this engagement and streams
 * the .docx straight to the browser. No email, no portal upload,
 * no recipient gate; the auditor just wants a copy locally (e.g.
 * to review, edit in Word, or attach somewhere outside the system).
 *
 * Still logs an ActivityLog entry so the (future) Communication tab
 * can show "Planning Letter downloaded by <user> on <date>" alongside
 * the Send events.
 *
 * Body: { templateId: string }   (document-kind template only)
 * Response: streamed .docx with Content-Disposition: attachment
 */
type Ctx = { params: Promise<{ engagementId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const templateId = typeof body?.templateId === 'string' ? body.templateId : '';
  if (!templateId) return NextResponse.json({ error: 'templateId required' }, { status: 400 });

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, clientId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { buffer, fileName } = await renderTemplateToDocx(templateId, engagementId);

    // Fire-and-forget audit log — don't block the download on it.
    (prisma as any).activityLog?.create?.({
      data: {
        userId: session.user.id,
        firmId: engagement.firmId,
        clientId: engagement.clientId,
        action: 'download_planning_letter',
        tool: 'rmm',
        detail: { engagementId, templateId, fileName },
      },
    }).catch(() => { /* tolerant */ });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Render failed' }, { status: 422 });
  }
}
