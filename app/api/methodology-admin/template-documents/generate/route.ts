import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { renderTemplateToDocx } from '@/lib/template-render';

/**
 * Admin generate — produce a .docx for a document template against
 * either a live engagement or the firm's dynamic sample context (same
 * context the Preview pane uses).
 *
 * Purpose: the template editor's "Generate Word" button — so the admin
 * can iterate on a template and download a real .docx to check styling
 * and merge-field behaviour without needing to pick an engagement
 * first. If an engagementId IS supplied we render against the live
 * engagement; otherwise sample context.
 *
 * Separate from /api/engagements/[id]/render-template because this
 * endpoint exists in the admin area, makes the engagement parameter
 * optional, and is gated on SuperAdmin / MethodologyAdmin.
 *
 * POST body: { templateId: string, engagementId?: string }
 * Response: streamed .docx attachment
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const templateId = typeof body?.templateId === 'string' ? body.templateId : '';
  const engagementId = typeof body?.engagementId === 'string' && body.engagementId.length > 0 ? body.engagementId : null;
  if (!templateId) return NextResponse.json({ error: 'templateId required' }, { status: 400 });

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
