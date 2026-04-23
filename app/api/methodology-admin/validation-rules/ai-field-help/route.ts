import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { auth } from '@/lib/auth';

/**
 * AI Help for Validation Rule field names.
 *
 * The Validation Rules editor lets admins type free-text formula expressions
 * whose identifiers are question slugs on a target schedule. Admins often
 * don't know which slugs exist — or want to introduce additional fields
 * beyond the ones currently on the schedule. This endpoint asks an LLM to
 * suggest sensible field names given the schedule context, existing slugs,
 * and any draft expression the admin has started.
 *
 * POST body:
 *   {
 *     scheduleKey: string,               // e.g. "fees", "materiality"
 *     scheduleLabel?: string,            // human label if different
 *     existingSlugs?: string[],          // slugs already defined on the schedule
 *     existingExpression?: string,       // draft expression (for context)
 *     userHint?: string,                 // free-text nudge from the admin
 *   }
 *
 * Response:
 *   {
 *     suggestions: Array<{ slug, label, description, isExisting }>
 *   }
 *
 * Guarded: methodology-admin or super-admin only.
 */

const MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

interface Suggestion {
  slug: string;
  label: string;
  description: string;
  isExisting: boolean;
}

function getClient(): OpenAI {
  const key = process.env.TOGETHER_DOC_SUMMARY_KEY || process.env.TOGETHER_API_KEY;
  if (!key) throw new Error('No Together AI key: set TOGETHER_DOC_SUMMARY_KEY or TOGETHER_API_KEY');
  return new OpenAI({ apiKey: key, baseURL: 'https://api.together.xyz/v1' });
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/%/g, ' pct ').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const scheduleKey: string = (body.scheduleKey || '').trim();
  const scheduleLabel: string = (body.scheduleLabel || scheduleKey).trim();
  const existingSlugs: string[] = Array.isArray(body.existingSlugs)
    ? body.existingSlugs.filter((s: any) => typeof s === 'string')
    : [];
  const existingExpression: string = (body.existingExpression || '').trim();
  const userHint: string = (body.userHint || '').trim();

  if (!scheduleKey) {
    return NextResponse.json({ error: 'scheduleKey is required' }, { status: 400 });
  }

  const systemPrompt = `You are an assistant helping a UK audit-methodology admin write validation rules.
A validation rule targets an engagement schedule (e.g. "fees", "materiality", "ethics") and evaluates a formula against question slugs on that schedule.

Your job: given the schedule context, suggest field names (snake_case slugs) the admin might want to reference in their rule — INCLUDING new fields the schedule doesn't currently have, if they'd be useful.

Rules for suggestions:
- Each slug MUST be snake_case (lowercase, underscores, no spaces).
- Provide a short human-readable label (title case) and a one-sentence description of what the field represents.
- Return 6–10 suggestions: a mix of commonly-referenced fields for that type of schedule AND any additional fields the draft expression or user hint implies would be useful.
- If a suggestion matches an existing slug exactly, mark it as existing.
- Do not invent nonsense. Stick to realistic audit-methodology concepts.

Respond with ONLY a JSON object of the form:
{ "suggestions": [ { "slug": "...", "label": "...", "description": "...", "isExisting": false } ] }
No markdown, no code fences, no prose outside the JSON.`;

  const userPrompt = `Target schedule: "${scheduleLabel}" (key: ${scheduleKey}).

Existing slugs on this schedule: ${existingSlugs.length ? existingSlugs.join(', ') : '(none supplied)'}.

${existingExpression ? `Draft expression so far: ${existingExpression}` : 'No draft expression yet.'}

${userHint ? `Admin's hint: ${userHint}` : ''}

Suggest field names the admin can use. Include common ones for this schedule type and any additional fields the draft expression or hint implies.`;

  try {
    const client = getClient();
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 800,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices?.[0]?.message?.content || '';
    let parsed: { suggestions?: Suggestion[] } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Llama sometimes wraps the JSON in prose — try to extract the object.
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    }

    const out = (parsed.suggestions || [])
      .map((s): Suggestion => ({
        slug: slugify(String(s.slug || s.label || '')),
        label: String(s.label || s.slug || '').trim(),
        description: String(s.description || '').trim(),
        isExisting: existingSlugs.includes(slugify(String(s.slug || s.label || ''))) || Boolean(s.isExisting),
      }))
      .filter(s => s.slug && s.label)
      .slice(0, 12);

    return NextResponse.json({
      suggestions: out,
      model: MODEL,
      usage: completion.usage,
    });
  } catch (err: any) {
    console.error('[ai-field-help] failed:', err);
    return NextResponse.json({ error: err?.message || 'AI request failed' }, { status: 500 });
  }
}
