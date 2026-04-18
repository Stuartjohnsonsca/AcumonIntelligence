import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { MERGE_FIELDS } from '@/lib/template-merge-fields';

/**
 * AI placeholder-lookup for the document-template editor.
 *
 * The admin types a plain-English description ("the date the
 * engagement letter was signed", "client's registered address",
 * "each error on the error schedule with amount") and this endpoint
 * asks Llama 3.3 70B to pick the best Handlebars snippet from the
 * catalog (lib/template-merge-fields.ts) — adding a formatter where
 * that makes sense (`formatDate`, `formatCurrency`) and wrapping an
 * array in `{{#each}}` when appropriate.
 *
 * POST body: { description: string, context?: string }
 *   `description` — required; the admin's words.
 *   `context`     — optional; surrounding sentence so the AI can
 *                   pick a sensible wrapper (e.g. inside a list vs
 *                   a prose paragraph).
 *
 * Response:
 *   { snippet, path, label, rationale, confidence, alternatives }
 * or
 *   { error }
 *
 * Auth: superAdmin || methodologyAdmin (editor page is already
 * behind that gate, but we re-check at the API layer defensively).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  const surroundingContext = typeof body?.context === 'string' ? body.context.trim().slice(0, 600) : '';
  if (!description) return NextResponse.json({ error: 'description is required' }, { status: 400 });

  // Render the catalog as a compact "menu" so the AI can pick from it.
  // Arrays expose their itemFields so the model knows what to put
  // inside a `{{#each}}` block.
  const menu = MERGE_FIELDS.map(f => {
    const itemFields = Array.isArray(f.itemFields) && f.itemFields.length > 0
      ? ` [loop fields: ${f.itemFields.map(i => i.key).join(', ')}]`
      : '';
    return `- ${f.key} (${f.type}${f.group ? ', group=' + f.group : ''})${itemFields}${f.description ? ' — ' + f.description : ''}`;
  }).join('\n');

  const systemPrompt = `You are a merge-field matcher for a UK audit platform's document template editor. The admin types a natural-language description of what they want to appear in the template. Your job is to pick the best Handlebars placeholder snippet from the catalog below (or say NO_MATCH if the catalog doesn't cover it).

Catalog (dotted path, type, description):
${menu}

Formatter helpers you can wrap scalars in:
- formatDate <path> "dd MMMM yyyy"       → e.g. 31 December 2025
- formatCurrency <path>                  → £1,234
- formatNumber <path>                    → 1,234
- formatPercent <path>                   → 42.0%

For ARRAY fields (type=array), wrap in a {{#each <path>}}…{{/each}} block and reference the loop's item fields inside (e.g. {{fsLine}}, {{description}}). If the admin asks for "each <thing>" produce a short bulleted loop; if they ask for a "table", produce an inline <table> with a header row.

Return ONLY JSON:
{
  "snippet": "the Handlebars text to drop into the editor — valid, balanced, ready to paste",
  "path": "the primary dotted path chosen (the path without Handlebars braces)",
  "label": "the catalog label for the chosen field",
  "rationale": "short (<=20 words) explanation of why this path matches",
  "confidence": 0.0-1.0,
  "alternatives": [{"path": "...", "label": "...", "snippet": "..."}]   // up to 2 runners-up, or []
}

If the catalog has no suitable field at all, return:
{ "snippet": "", "path": "", "label": "", "rationale": "No match in catalog.", "confidence": 0, "alternatives": [] }`;

  const userPrompt = `Description: ${description}${surroundingContext ? `\n\nSurrounding text in the template (for context): ${surroundingContext}` : ''}`;

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
      max_tokens: 1000,
      temperature: 0.1,
    });
    const text = response.choices[0]?.message?.content || '';
    const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return NextResponse.json({ error: 'AI returned non-JSON response', raw: cleaned }, { status: 502 });
    const parsed = JSON.parse(match[0]);
    return NextResponse.json(parsed);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Suggest failed' }, { status: 500 });
  }
}
