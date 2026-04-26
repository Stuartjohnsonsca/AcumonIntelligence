import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/engagements/:engagementId/ai-polish
 *
 * Takes a free-text answer the auditor wrote into a schedule cell and
 * returns the SAME content rewritten in formal UK audit language —
 * suitable for pasting straight into a client-facing document.
 *
 * The endpoint is per-engagement so we can authorise the call against
 * the firm scope (the auditor must already have access to the
 * engagement). The polishing itself is generic: the AI sees the
 * auditor's text plus the optional question context (so it knows
 * what the answer is FOR — "key judgements in setting materiality",
 * "threats to objectivity", etc.) and produces a single rewritten
 * paragraph.
 *
 * The endpoint never INVENTS facts the auditor didn't write — it only
 * polishes the language. If the input is empty we return early
 * (nothing to polish).
 *
 * Body: { text: string, questionContext?: string }
 * Response: { polished: string } | { error: string }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { engagementId } = await params;
  // Firm-scope gate. AI polishing potentially leaks audit-file text
  // into Together AI prompts, so we check that the caller actually
  // has access to this engagement before forwarding. Mirrors the
  // permission check on the rest of the engagement endpoints.
  const eng = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!eng) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (eng.firmId !== session.user.firmId && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text : '';
  const questionContext = typeof body?.questionContext === 'string' ? body.questionContext.slice(0, 400) : '';

  // Trim and bail early on empty / whitespace-only input — nothing
  // useful to polish, and the auditor probably clicked the button by
  // accident.
  const trimmed = text.trim();
  if (!trimmed) {
    return NextResponse.json({ polished: '' });
  }
  // Keep the prompt size sensible. 8 KB of free text is plenty for
  // every prose cell on a schedule and prevents accidental DoS via
  // pasted PDFs.
  if (trimmed.length > 8000) {
    return NextResponse.json({ error: 'Text is too long to polish (limit: 8000 characters).' }, { status: 400 });
  }

  const systemPrompt = `You are an editor for a UK statutory audit firm. The user is an auditor who has typed a free-text answer into an audit schedule field. Your job is to rewrite their text in FORMAL UK AUDIT LANGUAGE — suitable for a client-facing document — without changing the underlying facts or conclusions.

Rules:
- Use British spelling (organisation, recognise, behaviour, judgement).
- Third-person, professional register. No first-person pronouns ("I", "we") unless they appear in the source text and removing them would change meaning. The audit firm refers to itself as "we" or "the auditors" — keep that voice if present.
- Concise but complete. Keep the same factual content; rewrite the WORDING, not the content.
- No new facts, figures, dates, names, or conclusions that weren't in the source.
- No disclaimers, no preamble ("Here is the polished version:"). Return ONLY the polished prose, ready to paste straight into a document.
- Preserve any line breaks the auditor used as paragraph separators.
- If the source is bullet points, keep bullet points. If prose, keep prose.

Return ONLY the polished text. No JSON. No commentary. No quotation marks around the result.`;

  const userPrompt = questionContext
    ? `Context — the schedule field this answer is for:\n${questionContext}\n\nAuditor's text:\n${trimmed}`
    : `Auditor's text:\n${trimmed}`;

  try {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({
      apiKey: process.env.TOGETHER_API_KEY || '',
      baseURL: 'https://api.together.xyz/v1',
    });
    const response = await client.chat.completions.create({
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 1500,
      temperature: 0.2,
    });
    const polished = (response.choices[0]?.message?.content || '').trim();
    if (!polished) {
      return NextResponse.json({ error: 'AI returned an empty response — try again.' }, { status: 502 });
    }
    return NextResponse.json({ polished });
  } catch (err: any) {
    console.error('[ai-polish] failed:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'AI polish failed' }, { status: 500 });
  }
}
