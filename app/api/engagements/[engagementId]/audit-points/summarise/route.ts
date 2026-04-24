import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { AUDIT_POINT_SAFE_SELECT } from '@/lib/audit-points-select';

/**
 * POST /api/engagements/[engagementId]/audit-points/summarise
 * Body: { id }
 *
 * Produces an AI-generated summary of an audit-point's chat thread
 * suitable for inclusion in a Send-to-Technical / Send-to-Ethics
 * email. Caller can edit the returned text before sending — the
 * endpoint returns the draft only; it never persists.
 *
 * Uses the same Together AI setup as other summarisation helpers
 * in the codebase.
 */
type Ctx = { params: Promise<{ engagementId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await ctx.params;

  const eng = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!eng || (eng.firmId !== session.user.firmId && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json();
  const { id } = body as { id: string };
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const point = await prisma.auditPoint.findUnique({ where: { id }, select: { ...AUDIT_POINT_SAFE_SELECT } });
  if (!point || point.engagementId !== engagementId) {
    return NextResponse.json({ error: 'Audit point not found' }, { status: 404 });
  }

  const responses = Array.isArray(point.responses) ? (point.responses as any[]) : [];
  // Build a plain-text transcript the model can reason over. No HTML,
  // no metadata the model will hallucinate around — just chronological
  // messages prefixed with the speaker's name.
  const transcript = [
    `[${point.createdByName || 'raised by'} on ${new Date(point.createdAt).toLocaleString('en-GB')}]`,
    point.description || '',
    ...responses.map((r: any) =>
      `[${r.userName || 'reply'} on ${new Date(r.createdAt || '').toLocaleString('en-GB')}]\n${r.message || ''}`
    ),
  ].join('\n\n---\n\n');

  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });
  }

  try {
    const response = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Llama 3.3 70B Turbo — the current recommended serverless
        // model for audit-context summarisation on this firm's
        // Together AI setup.
        model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        messages: [
          {
            role: 'system',
            content:
              'You are an audit quality assistant. Summarise the discussion thread below for forwarding to a technical reviewer or ethics partner. Keep it concise (3–5 sentences), capture the core issue, what\'s been considered, any decisions reached, and any open questions. Neutral tone; no opinion; no preamble — output only the summary text.',
          },
          { role: 'user', content: transcript.slice(0, 6000) },
        ],
        max_tokens: 400,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ error: `AI returned ${response.status}` }, { status: 502 });
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim() || '';
    return NextResponse.json({ summary });
  } catch (err: any) {
    console.error('[audit-points/summarise] failed:', err);
    return NextResponse.json({ error: err?.message || 'Summary generation failed' }, { status: 500 });
  }
}
