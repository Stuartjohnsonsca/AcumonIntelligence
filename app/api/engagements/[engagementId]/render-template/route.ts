import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { renderTemplateToDocx } from '@/lib/template-render';

/**
 * Render a DocumentTemplate (kind='document') into a Word file for a
 * specific engagement.
 *
 *   POST /api/engagements/:engagementId/render-template
 *   body: { templateId: string }
 *
 * Response is a streamed .docx with Content-Disposition: attachment.
 *
 * Auth: any user with 2FA verified who belongs to the same firm as
 * the engagement (audit staff can generate documents they need for
 * their own engagement; it's template CREATION that's admin-gated).
 */
type Ctx = { params: Promise<{ engagementId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const templateId = typeof body?.templateId === 'string' ? body.templateId : '';
  if (!templateId) return NextResponse.json({ error: 'templateId required' }, { status: 400 });

  // Tenant check — user must belong to the engagement's firm.
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const result = await renderTemplateToDocx(templateId, engagementId);
    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${result.fileName}"`,
        'Access-Control-Expose-Headers': 'X-Template-Diagnostics',
        'X-Template-Diagnostics': encodeURIComponent(JSON.stringify({
          usedLiveContext: result.usedLiveContext,
          missingPlaceholders: result.missingPlaceholders,
          emptyPlaceholders: result.emptyPlaceholders,
          resolvedClientName: result.resolvedClientName,
          resolvedPeriodEnd: result.resolvedPeriodEnd,
        })),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Render failed' }, { status: 422 });
  }
}
