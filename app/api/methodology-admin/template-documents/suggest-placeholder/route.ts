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
          // And the prior-period counterpart — attached under the
          // top-level `priorPeriod.*` mirror that buildTemplateContext
          // creates for us. Suffix the label so the AI picks the
          // right one when the admin says "prior period …".
          dynamicEntries.push({
            path: `priorPeriod.questionnaires.${ctxKey}.${key}`,
            label: `${questionText} (prior period)`,
            group: `${typeLabel}${groupTitle ? ' · ' + groupTitle : ''} (prior period)`,
            type: kind,
            description: answerType ? `answer type: ${answerType} — prior period` : 'prior period value',
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

  // Sections known on each of this firm's questionnaires — derived from
  // the dynamic entries above. Feeding these to the AI explicitly helps
  // it produce `filterBySection` calls with the RIGHT section name
  // rather than guessing. Kept compact: one line per (questionnaire,
  // section-name) pair.
  const sectionsByCtxKey = new Map<string, Set<string>>();
  for (const e of dynamicEntries) {
    if (e.path.startsWith('priorPeriod.')) continue;
    const m = e.path.match(/^questionnaires\.([^.]+)\./);
    if (!m) continue;
    // group format: "<Type Label> · <Section Name>"
    const parts = e.group.split('·').map(s => s.trim());
    const sectionName = parts[1];
    if (!sectionName) continue;
    if (!sectionsByCtxKey.has(m[1])) sectionsByCtxKey.set(m[1], new Set());
    sectionsByCtxKey.get(m[1])!.add(sectionName);
  }
  const sectionsCatalog = sectionsByCtxKey.size === 0
    ? '  (no sections discovered yet — admin hasn\'t added grouped questions)'
    : Array.from(sectionsByCtxKey.entries())
        .map(([ck, set]) => `- questionnaires.${ck}: [${Array.from(set).map(s => `"${s}"`).join(', ')}]`)
        .join('\n');

  const menu = `Static catalog (fixed paths):\n${staticMenu}\n\nFirm-specific questionnaire questions (match on QUESTION text — these are LIVE questions in this firm's questionnaire schemas, always prefer one of these when the admin describes a specific question):\n${dynamicMenu}\n\nQuestionnaire sections available for filterBySection:\n${sectionsCatalog}`;

  const systemPrompt = `You are a merge-field matcher AND Handlebars-snippet generator for a UK audit platform's document template editor. The admin types a natural-language description of what they want to appear in the template. Your job is to return a snippet they can paste directly into the editor.

The catalog has THREE parts:
  1. A STATIC catalog of known paths that always exist (engagement metadata, TB figures, error schedule, etc.).
  2. A DYNAMIC list of the firm's actual questionnaire questions — these have a QUESTION text to match the admin's description against. PREFER a dynamic entry when the admin describes a specific question (e.g. "key judgements in setting materiality" should match a question labelled along those lines).
  3. A list of SECTIONS within each questionnaire — use these as the second argument to \`filterBySection\` when the admin asks for "each <section-name>" or "table of <section-name>".

When matching a questionnaire question, use semantic similarity on the QUESTION text, not just keyword overlap.

PRIOR-PERIOD MIRROR RULE: every current-period path has an equivalent prior-period path prefixed with \`priorPeriod.\` — e.g.:
  materiality.overall              ↔  priorPeriod.materiality.overall
  errorSchedule                    ↔  priorPeriod.errorSchedule
  questionnaires.materiality.X     ↔  priorPeriod.questionnaires.materiality.X
  auditPlan.significantRisks       ↔  priorPeriod.auditPlan.significantRisks
If the admin's description mentions "prior period", "prior year", "last year", "PY", or similar, return the \`priorPeriod.\`-prefixed path. First-year engagements have priorPeriod = null, but the admin's intent is still to reference the prior-period value.

Catalog:
${menu}

Formatter helpers you can wrap scalars in:
- formatDate <path> "dd MMMM yyyy"       → e.g. 31 December 2025
- formatCurrency <path>                  → £1,234
- formatNumber <path>                    → 1,234
- formatPercent <path>                   → 42.0%

Collection / filter helpers you can use inside \`{{#each …}}\` sub-expressions:
- (filterBySection <asList> "<Section Name>")
    Keep only questionnaire items from the named section. Case- and
    punctuation-tolerant. USE THIS when the admin wants "each X from
    <section>".
- (filterWhere <arr> "<field>" "<op>" <value>)
    General filter. Ops: eq / ne / gt / lt / gte / lte / contains /
    isEmpty / isNotEmpty. Compose with filterBySection for "each Y=yes
    item in <section>" patterns.
- (sumField <arr> "<field>") / (sumFieldWhere <arr> "<sum-field>" "<filter-field>" "<op>" <value>)
    For totals rows.
- (length <arr>) / (isEmpty <v>) / (isNotEmpty <v>) / (join <arr> "<sep>")

Every questionnaire's \`asList\` entry has these fields you can use inside the loop:
  {{question}}          question text
  {{answer}}            user's answer
  {{key}}               question key
  {{section}}           section name (verbatim, not slugified)
  {{sortOrder}}         integer
  {{previousAnswer}}    answer to the item immediately before this one in asList
  {{nextAnswer}}        answer to the item immediately after this one in asList
  {{previousKey}} / {{previousQuestion}} / {{nextKey}} / {{nextQuestion}}
  {{itemIndex}}         0-based index
  {{isEmpty}}           boolean

For ARRAY fields (type=array) the admin can also just say "list each X" — emit a short {{#each <path>}}…{{/each}} block referencing item fields. For a "table" request emit an inline <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%"> with a <thead> header row and {{#each}} inside <tbody> producing one <tr> per item.

============================================================
WORKED EXAMPLES (mirror these shapes)

Example A — "Each ethics question" (plain list):
  <ul>
    {{#each questionnaires.ethics.asList}}
      <li>{{question}} — {{answer}}</li>
    {{/each}}
  </ul>

Example B — "Non Audit Services table with service name and threats":
  The Non Audit Services section typically has triplets of questions:
  service name / Y-or-N flag / threats text. Loop every row where the
  Y/N answer is "Y" and use previousAnswer (service name) and
  nextAnswer (threats) to fill the two cells.
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
      <thead>
        <tr>
          <th style="text-align:left;background:#f1f5f9">Service Provided</th>
          <th style="text-align:left;background:#f1f5f9">Threats to objectivity and Safeguard implemented</th>
        </tr>
      </thead>
      <tbody>
        {{#each (filterWhere (filterBySection questionnaires.ethics.asList "Non Audit Services") "answer" "eq" "Y")}}
        <tr>
          <td>{{previousAnswer}}</td>
          <td>{{nextAnswer}}</td>
        </tr>
        {{/each}}
      </tbody>
    </table>

Example C — "Every error on the error schedule as a table":
  {{{errorScheduleTable errorSchedule}}}
  (the helper emits the full table including header row; triple-braces stop escaping)

Example D — "Total of the current-year TB movements only":
  {{formatCurrency (sumFieldWhere tbRows "currentYear" "fsStatement" "eq" "Profit & Loss")}}
============================================================

Choose the right idiom:
- Admin says "table of <section name>" → Example B shape (filterBySection, sometimes filterWhere for Y-only items).
- Admin says "list each …" → Example A shape (<ul><li>).
- Admin says "each section's …" (across all sections) → plain {{#each asList}}.
- Admin describes a single value/question → a single {{placeholder}}, wrapped in a formatter when useful.
- Admin asks for a total / sum → sumField / sumFieldWhere.

Return ONLY JSON:
{
  "snippet": "the Handlebars text to drop into the editor — valid, balanced, ready to paste. May contain HTML (<table>, <ul>, <tr>, etc.) when appropriate.",
  "path": "the primary dotted path chosen (the path without Handlebars braces). For a looped snippet, this is the array path that feeds the loop.",
  "label": "a short human label describing the chosen field or pattern",
  "rationale": "short (<=20 words) explanation of why this shape matches",
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
