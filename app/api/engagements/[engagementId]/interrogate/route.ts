import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildTemplateContext } from '@/lib/template-context';
import { askInterrogateBot, type InterrogateMessage } from '@/lib/interrogate-bot';

/**
 * POST /api/engagements/:engagementId/interrogate
 *
 * Strict, file-only Q&A over an engagement. Anyone with read access to
 * the engagement (firm members + super admins) can interrogate; the bot
 * itself is bounded to AUDIT_FILE content so it can't leak data the
 * caller isn't already entitled to see — but we still require firm
 * membership as a defence-in-depth gate.
 *
 * Body: { question: string, history?: Array<{ role, content }> }
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await ctx.params;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 });
  }
  // Sanitise history — only accept the two roles we ship and trim each
  // entry's content to a sensible cap so a runaway client can't blow
  // the prompt budget.
  const rawHistory = Array.isArray(body.history) ? body.history : [];
  const history: InterrogateMessage[] = rawHistory
    .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));

  let templateContext;
  try {
    templateContext = await buildTemplateContext(engagementId);
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to load engagement context: ${err?.message || 'unknown'}` }, { status: 500 });
  }

  try {
    const result = await askInterrogateBot(templateContext, question, history);
    return NextResponse.json({
      answer: result.answer,
      model: result.model,
      usage: result.usage,
    });
  } catch (err: any) {
    return NextResponse.json({ error: `InterrogateBot failed: ${err?.message || 'unknown'}` }, { status: 500 });
  }
}
