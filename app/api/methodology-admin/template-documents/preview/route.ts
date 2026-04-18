import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { previewTemplate } from '@/lib/template-render';

/**
 * Preview a document template's body against either a live engagement
 * or the canned sample context. Returns the rendered HTML + a list of
 * `{{placeholders}}` in the body that aren't in the catalog so the
 * admin can spot typos before shipping.
 *
 * POST body: { templateId: string, engagementId?: string }
 *
 * Auth: superAdmin || methodologyAdmin (matches the rest of the
 * template-documents admin API).
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
    const result = await previewTemplate(templateId, engagementId);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Preview failed' }, { status: 500 });
  }
}
