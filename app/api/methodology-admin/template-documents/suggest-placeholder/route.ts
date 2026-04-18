import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { MERGE_FIELDS } from '@/lib/template-merge-fields';
import { prisma } from '@/lib/db';

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

  // ── Static catalog ─────────────────────────────────────────────────
  // Render the catalog as a compact "menu" so the AI can pick from it.
  // Arrays expose their itemFields so the model knows what to put
  // inside a `{{#each}}` block.
  const staticMenu = MERGE_FIELDS.map(f => {
    const itemFields = Array.isArray(f.itemFields) && f.itemFields.length > 0
      ? ` [loop fields: ${f.itemFields.map(i => i.key).join(', ')}]`
      : '';
    return `- ${f.key} (${f.type}${f.group ? ', group=' + f.group : ''})${itemFields}${f.description ? ' — ' + f.description : ''}`;
  }).join('\n');

  // ── Dynamic questionnaire questions ────────────────────────────────
  // Every question the firm has defined in ANY of its questionnaire
  // schemas is addressable as `questionnaires.<type>.<question.key>`.
  // The catalog of types is open-ended — firms can add new ones
  // (audit summary memo, new client take-on, subsequent events, etc.)
  // so we discover them dynamically: any MethodologyTemplate row with
  // `templateType` ending in `_questions` is treated as a
  // questionnaire schema. This is what the admin means when they say
  // "don't limit to 4" — the suggester now surfaces every question
  // the firm has defined, not just the hardcoded core four.
  type QuestionnaireMenuEntry = {
    path: string;
    label: string;            // the question text
    group: string;            // e.g. "Materiality Questionnaire · Justification"
    type: 'scalar' | 'date' | 'currency';
    description?: string;
  };
  const dynamicEntries: QuestionnaireMenuEntry[] = [];

  /** Convert a `*_questions` templateType to the key used in the
   *  template context (`questionnaires.<key>`). The four canonical
   *  ones have well-known camelCase forms; everything else is
   *  derived by stripping `_questions` and camelCasing the rest. */
  function contextKeyFor(templateType: string): string {
    const canonical: Record<string, string> = {
      permanent_file_questions:   'permanentFile',
      ethics_questions:           'ethics',
      continuance_questions:      'continuance',
      materiality_questions:      'materiality',
      new_client_takeon_questions:'newClientTakeOn',
      subsequent_events_questions:'subsequentEvents',
      audit_summary_memo_questions:'auditSummaryMemo',
    };
    if (canonical[templateType]) return canonical[templateType];
    const stem = templateType.replace(/_questions$/, '');
    // snake_case → camelCase
    return stem.replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase());
  }
  /** Best-effort human label for the group header. */
  function labelFor(templateType: string): string {
    const stem = templateType.replace(/_questions$/, '').replace(/_/g, ' ');
    return stem.replace(/\b\w/g, c => c.toUpperCase()) + ' Questionnaire';
  }

  try {
    const schemas = await prisma.methodologyTemplate.findMany({
      where: {
        firmId: session.user.firmId,
        templateType: { endsWith: '_questions' },
      },
    });
    for (const schema of schemas) {
      const ctxKey = contextKeyFor(schema.templateType);
      const typeLabel = labelFor(schema.templateType);
      const items = Array.isArray(schema.items) ? schema.items as any[] : [];
      for (const item of items) {
        // Newer questionnaire schemas nest questions inside groups:
        // items = [{ id, title, questions: [{ id, key?, text, answerType }] }]
        // Older schemas store questions flat. Handle both shapes.
        const questions: any[] = Array.isArray(item?.questions) ? item.questions : [item];
        const groupTitle: string = item?.title || '';
        for (const q of questions) {
          if (!q) continue;
          // Prefer an explicit `key`; fall back to slugified text for
          // legacy schemas that only stored question text.
          let key: string = q.key || q.questionKey || '';
          if (!key && typeof q.text === 'string') {
            key = q.text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
          }
          if (!key) continue;
          const questionText: string = q.text || q.questionText || q.label || key;
          // Map answerType → scalar/date/currency so the AI can pick
          // the right formatter helper (formatDate for dates, etc.).
          const answerType: string = q.answerType || '';
          const kind: 'scalar' | 'date' | 'currency' =
            /date/i.test(answerType) ? 'date'
            : /currency|amount|money/i.test(answerType) ? 'currency'
            : 'scalar';
          dynamicEntries.push({
            path: `questionnaires.${ctxKey}.${key}`,
            label: questionText,
            group: `${typeLabel}${groupTitle ? ' · ' + groupTitle : ''}`,
            type: kind,
            description: answerType ? `answer type: ${answerType}` : undefined,
          });
        }
      }
    }
  } catch (err) {
    // Tolerant: if the schemas table is unavailable or malformed we
    // still answer with the static catalog — worse suggestions, not
    // a hard failure.
    console.error('[suggest-placeholder] failed loading questionnaire schemas', err);
  }

  const dynamicMenu = dynamicEntries.length === 0
    ? '  (no firm-specific questionnaire questions found)'
    : dynamicEntries.map(e => `- ${e.path} (${e.type}, group=${e.group})${e.description ? ' — ' + e.description : ''} — QUESTION: "${e.label.replace(/"/g, '\\"').slice(0, 200)}"`).join('\n');

  const menu = `Static catalog (fixed paths):\n${staticMenu}\n\nFirm-specific questionnaire questions (match on QUESTION text — these are LIVE questions in this firm's questionnaire schemas, always prefer one of these when the admin describes a specific question):\n${dynamicMenu}`;

  const systemPrompt = `You are a merge-field matcher for a UK audit platform's document template editor. The admin types a natural-language description of what they want to appear in the template. Your job is to pick the best Handlebars placeholder snippet from the catalog below (or say NO_MATCH if the catalog doesn't cover it).

The catalog has TWO parts:
  1. A STATIC catalog of known paths that always exist (engagement metadata, TB figures, error schedule, etc.).
  2. A DYNAMIC list of the firm's actual questionnaire questions — these have a QUESTION text to match the admin's description against. PREFER a dynamic entry when the admin describes a specific question (e.g. "key judgements in setting materiality" should match a question labelled along those lines).

When matching a questionnaire question, use semantic similarity on the QUESTION text, not just keyword overlap.

Catalog:
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
