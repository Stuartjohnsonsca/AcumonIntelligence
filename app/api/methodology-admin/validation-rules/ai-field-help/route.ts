import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { slugifyQuestionText } from '@/lib/formula-engine';

/**
 * AI Help for Validation Rule field names — grounded edition.
 *
 * Anti-hallucination discipline:
 *   1. Fetch the REAL question list from the firm's MethodologyTemplate
 *      rows matching the target schedule. Slugs come from the actual
 *      question text via slugifyQuestionText(), which is the same
 *      function the formula engine uses to build aliases — so what the
 *      AI sees as "existing" here is exactly what resolves at evaluation
 *      time.
 *   2. Pass the real slug list to the LLM as an explicit vocabulary.
 *      Tell it never to invent existing slugs and to clearly flag any
 *      new proposals as "not yet on the schedule".
 *   3. Post-validate every suggestion against the real set:
 *        - Strip any `{{...}}` document-template syntax (wrong vocabulary).
 *        - Reject dotted paths like `client.registeredAddress` (those are
 *          Handlebars placeholders, not validation-rule identifiers).
 *        - Force `isExisting` from server-side membership — never trust
 *          the LLM's claim here.
 *        - Drop suggestions that contain characters other than snake_case
 *          alphanumerics once cleaned.
 *   4. Return `verified` (drawn from real data) and `proposed` (AI's new
 *      ideas) as separate arrays so the UI can show a clear visual
 *      distinction between "this exists on your schedule" and "this is
 *      the AI's suggestion — add a question first".
 *
 * POST body:
 *   {
 *     scheduleKey: string,
 *     scheduleLabel?: string,
 *     existingExpression?: string,
 *     userHint?: string,
 *   }
 *
 * Response:
 *   {
 *     verified:  Array<{ slug, label, description, source: 'real' }>,
 *     proposed:  Array<{ slug, label, description, source: 'ai' }>,
 *     realSlugCount: number,
 *     model: string,
 *     usage: { promptTokens, completionTokens, totalTokens },
 *   }
 *
 * Guarded: methodology-admin or super-admin only.
 */

const MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

interface RawSuggestion {
  slug: string;
  label: string;
  description: string;
  isExisting?: boolean;
}

interface Suggestion {
  slug: string;
  label: string;
  description: string;
  source: 'real' | 'ai';
}

function getClient(): OpenAI {
  const key = process.env.TOGETHER_DOC_SUMMARY_KEY || process.env.TOGETHER_API_KEY;
  if (!key) throw new Error('No Together AI key: set TOGETHER_DOC_SUMMARY_KEY or TOGETHER_API_KEY');
  return new OpenAI({ apiKey: key, baseURL: 'https://api.together.xyz/v1' });
}

/** Same normalisation app/api/methodology-admin/templates/route.ts uses. */
function normaliseTemplateType(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/(questions|categories)$/, '');
}

/** Reject values that look like Handlebars placeholders rather than
 *  plain snake_case identifiers — validation rules DON'T use {{...}}. */
function isDottedOrBraced(s: string): boolean {
  return /[{}.]/.test(s);
}

/** Fetch the real question list for the firm's target schedule. */
async function loadRealSlugs(firmId: string, scheduleKey: string): Promise<
  Array<{ slug: string; questionText: string }>
> {
  const target = normaliseTemplateType(scheduleKey);
  // First try exact templateType match, then fall back to normalised.
  const all = await prisma.methodologyTemplate.findMany({ where: { firmId } });
  const matching = all.filter(t => normaliseTemplateType(t.templateType) === target);
  if (matching.length === 0) return [];

  // Prefer the ALL audit type row when multiple exist.
  const row = matching.find(t => t.auditType === 'ALL') ?? matching[0];
  const items = row.items as unknown;
  if (!Array.isArray(items)) return [];

  const seen = new Set<string>();
  const out: Array<{ slug: string; questionText: string }> = [];
  for (const it of items as any[]) {
    if (!it || typeof it !== 'object') continue;
    const questionText = String(it.questionText || it.text || '').trim();
    if (!questionText) continue;
    const slug = slugifyQuestionText(questionText);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, questionText });
  }
  return out;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const scheduleKey: string = (body.scheduleKey || '').trim();
  const scheduleLabel: string = (body.scheduleLabel || scheduleKey).trim();
  const existingExpression: string = (body.existingExpression || '').trim();
  const userHint: string = (body.userHint || '').trim();

  if (!scheduleKey) {
    return NextResponse.json({ error: 'scheduleKey is required' }, { status: 400 });
  }

  // Ground truth — the actual slugs on this firm's schedule. This is the
  // whitelist everything is validated against.
  const realSlugRows = await loadRealSlugs(session.user.firmId, scheduleKey);
  const realSlugSet = new Set(realSlugRows.map(r => r.slug));

  const realSlugsList = realSlugRows.length > 0
    ? realSlugRows.map(r => `- ${r.slug}  ← "${r.questionText}"`).join('\n')
    : '(no questions configured on this schedule yet)';

  const systemPrompt = `You are an assistant helping a UK audit-methodology admin write validation-rule expressions.

A validation rule targets one engagement schedule. Its expression references the slugs of questions on that schedule — bare snake_case identifiers like audit_fee or total_fees. NEVER use Handlebars placeholders like {{...}}, dotted paths like client.registeredAddress, or camelCase names. Those are for a different feature and are invalid here.

You will be given the EXACT list of slugs that currently exist on the target schedule. You may ONLY mark a suggestion as "existing" if its slug appears verbatim in that list. Any slug you output that is not in the list MUST be marked isExisting=false — it is a proposal for a new question the admin would need to add before using it.

Do NOT invent slugs that claim to come from the schedule. Do NOT output slugs that aren't plausibly question slugs for an audit schedule.

Return 4–8 suggestions:
- Prioritise slugs from the existing list when they match the user's intent.
- If the draft expression or admin hint suggests fields that aren't yet on the schedule, propose snake_case slug names for those — mark isExisting=false.

Respond with ONLY a JSON object:
{ "suggestions": [ { "slug": "snake_case_identifier", "label": "Short title", "description": "One-line meaning.", "isExisting": true | false } ] }
No markdown, no code fences, no prose outside the JSON.`;

  const userPrompt = `Target schedule: "${scheduleLabel}" (key: ${scheduleKey}).

EXISTING slugs on this schedule (authoritative list — these are the ONLY slugs you may mark isExisting=true):
${realSlugsList}

${existingExpression ? `Draft expression so far: ${existingExpression}` : 'No draft expression yet.'}

${userHint ? `Admin's hint: ${userHint}` : ''}

Suggest slugs from the list above where they match, and propose additional snake_case slugs only when the admin's intent clearly implies a field that should exist. Every suggestion outside the authoritative list MUST have isExisting=false.`;

  let aiSuggestions: RawSuggestion[] = [];
  let usage: any = null;
  try {
    const client = getClient();
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2, // low — we don't want creative invention
      max_tokens: 800,
      response_format: { type: 'json_object' },
    });
    const raw = completion.choices?.[0]?.message?.content || '';
    usage = completion.usage;
    let parsed: { suggestions?: RawSuggestion[] } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    }
    aiSuggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  } catch (err: any) {
    console.error('[ai-field-help] AI call failed:', err);
    // Fall through — we'll still return real slugs as verified suggestions.
  }

  // Post-validation — this is the anti-hallucination gate. Every output is
  // either a real slug from the firm's data or a clearly-labelled proposal.
  const verified: Suggestion[] = [];
  const proposed: Suggestion[] = [];
  const seenSlugs = new Set<string>();

  for (const s of aiSuggestions) {
    if (!s || typeof s !== 'object') continue;
    const rawSlug = String(s.slug || '').trim();
    if (!rawSlug) continue;
    // Reject Handlebars / dotted paths outright — wrong vocabulary.
    if (isDottedOrBraced(rawSlug)) continue;
    // Normalise to canonical snake_case — what the formula engine uses.
    const slug = rawSlug.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!slug || seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);

    const entry: Suggestion = {
      slug,
      label: String(s.label || slug).trim() || slug,
      description: String(s.description || '').trim(),
      source: realSlugSet.has(slug) ? 'real' : 'ai',
    };
    if (entry.source === 'real') verified.push(entry);
    else proposed.push(entry);
  }

  // Always include any real slug that the AI didn't surface — makes sure the
  // admin can always see their actual question list, even if the AI's
  // suggestions skewed one way.
  for (const r of realSlugRows) {
    if (seenSlugs.has(r.slug)) continue;
    seenSlugs.add(r.slug);
    verified.push({
      slug: r.slug,
      label: r.questionText,
      description: '',
      source: 'real',
    });
  }

  return NextResponse.json({
    verified,
    proposed,
    realSlugCount: realSlugRows.length,
    model: MODEL,
    usage,
  });
}
