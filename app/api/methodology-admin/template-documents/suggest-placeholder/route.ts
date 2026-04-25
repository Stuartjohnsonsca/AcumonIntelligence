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
  // Optional: when the admin is refining an existing snippet inside
  // the Insert HTML modal, the client passes the current draft so the
  // AI can MODIFY it rather than start from scratch ("add a third
  // column showing the section name", "only show rows where col2 is
  // 'Yes'", "restyle the header row in slate", etc.). Empty / missing
  // means "generate a new snippet" — the original behaviour.
  const currentSnippet = typeof body?.currentSnippet === 'string' ? body.currentSnippet.trim().slice(0, 4000) : '';
  if (!description) return NextResponse.json({ error: 'description is required' }, { status: 400 });

  // ── Static catalog ─────────────────────────────────────────────────
  // Render the catalog as a compact "menu" so the AI can pick from it.
  // Arrays expose their itemFields so the model knows what to put
  // inside a `{{#each}}` block.
  //
  // Anti-hallucination discipline: paths marked `excludeFromSuggester`
  // (MyAccount client record, firm admin settings, anything whose data
  // source lives outside the audit file) are dropped here so the LLM
  // can't suggest them. Admins can still type them by hand, but AI
  // proposals will only ever surface audit-file-sourced paths.
  const staticMenu = MERGE_FIELDS
    .filter(f => !f.excludeFromSuggester)
    .map(f => {
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

  // Per-section column-header catalog. Surfacing this lets the AI
  // resolve queries like "the WP Reference column on the procedures
  // section" — historically those failed because column header text
  // (Item / Procedures Performed / Conclusion / WP Reference) lives
  // on sectionMeta, not on the questions themselves.
  type SectionColumnEntry = {
    questionnaireKey: string;       // ctxKey, e.g. 'ethics'
    questionnaireLabel: string;     // human label, e.g. 'Ethics Questionnaire'
    sectionName: string;            // section's verbatim name
    sectionSlug: string;            // slugified for filterBySection / bySection
    columnHeaders: string[];        // header text per column (col0..colN)
    layout: string;                 // 'standard' | 'table_3col' | 'table_4col' | 'table_5col'
  };
  const sectionColumns: SectionColumnEntry[] = [];

  /** Slugify section name to match what filterBySection / bySection expects. */
  function slugifySection(s: string): string {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
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

      // ── Items shape detection ────────────────────────────────────
      // Two production shapes:
      //   1. Array<TemplateQuestion> — flat list, each question carries
      //      its sectionKey. No top-level sectionMeta.
      //   2. { questions: TemplateQuestion[], sectionMeta: Record<sectionKey,
      //      { columnHeaders, layout, label, ... }> } — newer shape that
      //      lets a section declare table-layout + column headers.
      let questions: any[] = [];
      let sectionMeta: Record<string, any> = {};
      if (Array.isArray(schema.items)) {
        questions = schema.items as any[];
      } else if (schema.items && typeof schema.items === 'object') {
        const items = schema.items as any;
        questions = Array.isArray(items.questions) ? items.questions
          : Array.isArray(items) ? items : [];
        sectionMeta = (items.sectionMeta && typeof items.sectionMeta === 'object') ? items.sectionMeta : {};
      }

      // Index sections we've seen so we record one column-headers
      // entry per (schedule, section) pair even when the same
      // sectionKey appears across many questions.
      const seenSections = new Set<string>();

      for (const rawItem of questions) {
        // Legacy "grouped" shape — items = [{ title, questions: [...] }] —
        // is handled inside the same loop by descending into rawItem.questions
        // when present. Keeps back-compat with very old firm schemas.
        const innerQs: any[] = Array.isArray(rawItem?.questions) ? rawItem.questions : [rawItem];
        const groupTitle: string = rawItem?.title || '';

        for (const q of innerQs) {
          if (!q) continue;
          // Prefer an explicit `key`; fall back to slugified text for
          // legacy schemas that only stored question text.
          let key: string = q.key || q.questionKey || '';
          if (!key && typeof q.text === 'string') {
            key = q.text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
          }
          if (!key) continue;
          const questionText: string = q.text || q.questionText || q.label || key;
          const sectionName: string = q.sectionKey || groupTitle || '';
          const answerType: string = q.answerType || '';
          const kind: 'scalar' | 'date' | 'currency' =
            /date/i.test(answerType) ? 'date'
            : /currency|amount|money/i.test(answerType) ? 'currency'
            : 'scalar';
          dynamicEntries.push({
            path: `questionnaires.${ctxKey}.${key}`,
            label: questionText,
            group: `${typeLabel}${sectionName ? ' · ' + sectionName : ''}`,
            type: kind,
            description: answerType ? `answer type: ${answerType}` : undefined,
          });
          // Prior-period mirror.
          dynamicEntries.push({
            path: `priorPeriod.questionnaires.${ctxKey}.${key}`,
            label: `${questionText} (prior period)`,
            group: `${typeLabel}${sectionName ? ' · ' + sectionName : ''} (prior period)`,
            type: kind,
            description: answerType ? `answer type: ${answerType} — prior period` : 'prior period value',
          });

          // Record this section's column metadata once. `sectionMeta`
          // is keyed by the literal sectionKey OR by the slug — try
          // both lookups for tolerance to older firm data.
          if (sectionName && !seenSections.has(sectionName)) {
            seenSections.add(sectionName);
            const slug = slugifySection(sectionName);
            const meta = sectionMeta[sectionName] || sectionMeta[slug];
            const layout = meta?.layout || 'standard';
            // Column headers come from sectionMeta when set; otherwise
            // we infer the count from any question's `columns` array
            // (rows in a multi-col layout always have one entry per
            // column) and emit blank header strings — better than
            // dropping the section entirely.
            let columnHeaders: string[] = [];
            if (Array.isArray(meta?.columnHeaders) && meta.columnHeaders.length > 0) {
              columnHeaders = meta.columnHeaders.map((h: any) => String(h || ''));
            } else if (Array.isArray(q?.columns) && q.columns.length > 0) {
              columnHeaders = q.columns.map((_: any, i: number) => `Column ${i + 1}`);
            }
            if (columnHeaders.length > 0) {
              sectionColumns.push({
                questionnaireKey: ctxKey,
                questionnaireLabel: typeLabel,
                sectionName,
                sectionSlug: slug,
                columnHeaders,
                layout,
              });
            }
          }
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

  // Per-section column-headers catalog. The AI uses this to resolve
  // queries like "the WP Reference column", "the Conclusion column on
  // the procedures section" — matching admin descriptions to header
  // text the firm has actually configured.
  //
  // Storage layout (CRITICAL — admins and storage disagree on whether
  // the label column counts as a column):
  //   • header[0] = label column → render as {{question}} (it's the
  //     row's questionText, NOT a stored cell)
  //   • header[1] → cell stored at <id>_col1 → render as {{col1}} (or
  //     a slug alias if the header text is set)
  //   • header[2] → cell stored at <id>_col2 → render as {{col2}}
  //   • etc.
  // So the FIRST data cell — the cell admins often call "column 2"
  // because they count the label column as #1 — is col1, not col2.
  // The AI must look up the header in this catalog rather than
  // mapping admin "column N" speech to col<N>.
  function slugifyHeader(h: string): string {
    return String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }
  const sectionColumnsCatalog = sectionColumns.length === 0
    ? '  (no multi-column sections configured)'
    : sectionColumns.map(s => {
        const headers = s.columnHeaders.map((h, i) => {
          if (i === 0) return `col0={{question}} "${(h || 'Item').replace(/"/g, '\\"')}" [LABEL — row question text, not a cell]`;
          const slug = slugifyHeader(h);
          const slugAlias = slug ? `, alias {{${slug}}}` : '';
          return `col${i}={{col${i}}}${slugAlias} "${(h || '').replace(/"/g, '\\"')}"`;
        }).join('\n    ');
        return `- questionnaires.${s.questionnaireKey} · "${s.sectionName}" (layout=${s.layout}):\n    ${headers}`;
      }).join('\n');

  const menu = `Static catalog (fixed paths):
${staticMenu}

Firm-specific questionnaire questions (match on QUESTION text — these are LIVE questions in this firm's questionnaire schemas, always prefer one of these when the admin describes a specific question):
${dynamicMenu}

Questionnaire sections available for filterBySection:
${sectionsCatalog}

Section column headers (for table-layout sections — use these to map "the <header-text> column" descriptions to {{col1}} / {{col2}} / … inside an asList loop, and to render <thead><th> rows verbatim):
${sectionColumnsCatalog}`;

  const systemPrompt = `You are a merge-field matcher AND Handlebars-snippet generator for a UK audit platform's document template editor. The admin types a natural-language description of what they want to appear in the template. Your job is to return a snippet they can paste directly into the editor.

ARCHITECTURAL PRINCIPLE — AUDIT FILE ONLY:
Document-template data must come from the engagement's audit file (the engagement itself, its period, team, schedules, questionnaires, materiality, error schedule, audit plan, trial balance, etc.). You MUST NOT suggest paths that resolve against firm-wide or MyAccount data (firm admin settings, Clients admin record, CRM fields, portfolio-manager assignments). The catalog below has already been filtered to audit-file-scoped paths — only use paths present in the catalog. Never invent paths (e.g. client.name, firm.address) that aren't listed.

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
  {{answer}}            user's answer (row-level — used by Q+A and by rows that haven't been configured as multi-column)
  {{key}}               question key
  {{section}}           section name (verbatim, not slugified)
  {{sortOrder}}         integer
  {{col1}} / {{col2}} / {{col3}} / {{col4}} / {{col5}}
                        Per-column cell values for rows in a
                        multi-column (3/4/5-col) table section. The
                        label column (col 0) is the question text; col1
                        onward are the editable cells. Use these inside
                        the loop to render multiple cells per row or to
                        pair a trigger column with a detail column.
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

  CRITICAL — when {{#each}} / {{/each}} / {{#if}} / {{/if}} sit
  DIRECTLY inside <table>, <tbody>, <thead>, <tr>, <tfoot>, or
  <colgroup>, they MUST be wrapped in HTML comments (<!--…-->).
  Without the wrappers the browser's HTML parser foster-parents the
  stray text out of the table and the loop breaks. The renderer
  strips the comments before compiling the Handlebars, so the
  template works correctly. Inside <td>, <p>, <div>, <li>, <span>
  — no wrapper is needed.

    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
      <thead>
        <tr>
          <th style="text-align:left;background:#f1f5f9">Service Provided</th>
          <th style="text-align:left;background:#f1f5f9">Threats to objectivity and Safeguard implemented</th>
        </tr>
      </thead>
      <tbody>
        <!--{{#each (filterWhere (filterBySection questionnaires.ethics.asList "Non Audit Services") "answer" "eq" "Y")}}-->
        <tr>
          <td>{{previousAnswer}}</td>
          <td>{{nextAnswer}}</td>
        </tr>
        <!--{{/each}}-->
      </tbody>
    </table>

Example C — "Every error on the error schedule as a table":
  {{{errorScheduleTable errorSchedule}}}
  (the helper emits the full table including header row; triple-braces stop escaping)

Example D — "Total of the current-year TB movements only":
  {{formatCurrency (sumFieldWhere tbRows "currentYear" "fsStatement" "eq" "Profit & Loss")}}

Example E — "Rows in a 4-column section where column 2 is 'Y', render columns 3 & 4 as a table":
  When the admin says things like 'only where col 2 is Y', or 'for
  each row where the third column answer is Yes, show the fourth
  column' — the rows live in a 4/5-col table-layout section and each
  row's cells are on the asList item as col1..col5. Filter with
  filterWhere on 'col2', render with {{col3}} / {{col4}}.

    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
      <thead>
        <tr>
          <th style="text-align:left;background:#f1f5f9">Procedure</th>
          <th style="text-align:left;background:#f1f5f9">Conclusion</th>
        </tr>
      </thead>
      <tbody>
        <!--{{#each (filterWhere questionnaires.<schedule>.asList "col2" "eq" "Y")}}-->
        <tr>
          <td>{{col3}}</td>
          <td>{{col4}}</td>
        </tr>
        <!--{{/each}}-->
      </tbody>
    </table>

  Pair filterWhere with filterBySection when the admin says 'each row
  in <section> where column N is Y' — compose them exactly like
  Example B.
============================================================

OUTPUT FORMAT RULES (always apply):
- Snippets are HTML + Handlebars. NEVER emit Markdown syntax. \`**bold**\`, \`__italic__\`, \`# Heading\`, \`* bullet\` all render as LITERAL TEXT in the editor — they are bugs, not formatting. Use <strong>…</strong>, <em>…</em>, <h2>…</h2>, <ul><li>…</li></ul> instead.
- Inside a <table>, when {{#each}} / {{/each}} / {{#if}} / {{/if}} sit DIRECTLY between <table>/<tbody>/<thead>/<tr>/<tfoot>, wrap them in HTML comments — \`<!--{{#each …}}-->\` etc. The renderer strips the comments before compiling. Inside <td>, <p>, <div>, <li>, <span>, no wrapper is needed.

Choose the right idiom:
- Admin says "table of <section name>" → Example B shape (filterBySection, sometimes filterWhere for Y-only items).
- Admin says "list each …" → Example A shape (<ul><li>).
- Admin says "each section's …" (across all sections) → plain {{#each asList}}.
- Admin describes a single value/question → a single {{placeholder}}, wrapped in a formatter when useful.
- Admin asks for a total / sum → sumField / sumFieldWhere.
- Admin names a column by its HEADER TEXT (e.g. "the Conclusion column", "the WP Reference column", "the Threat column") → CONSULT THE SECTION COLUMN HEADERS CATALOG ABOVE. The catalog tells you which col<N> each header maps to, AND the slug alias to prefer. NEVER infer from a count like "column 2" — the admin and storage disagree on whether the label column counts.

CRITICAL — column-index off-by-one rule:
The label column (col0) is the row's question text and has NO stored cell. Storage cells are col1, col2, col3, ... The admin's "column 2" almost always means the SECOND VISIBLE COLUMN, which is col1 in storage (because the label column is column 1 to them). When the admin says "column 2 called Threats", the catalog will show col1="Threat" — use col1, not col2. ALWAYS resolve the header text via the catalog rather than the admin's column number.

Prefer the SLUG alias over col<N> when both exist:
  good:  {{#each (filterWhere (filterBySection questionnaires.ethics.asList "Non Audit Services") "threat" "eq" "Y")}}<tr><td>{{threat_description}}</td><td>{{safeguard}}</td></tr>{{/each}}
  okay:  {{#each (filterWhere (filterBySection questionnaires.ethics.asList "Non Audit Services") "col1" "eq" "Y")}}<tr><td>{{col2}}</td><td>{{col3}}</td></tr>{{/each}}
The slug form is admin-readable and survives column reordering; the col<N> form is a fallback when no header is set.

- Admin asks for "the column headers" or "the field names of <section>" → emit a <thead><tr> row pulling header strings literally from the Section column headers catalog (those header strings are STATIC text inside <th>, not Handlebars references).

CONSTRUCTIVE FALLBACKS — DO NOT GIVE UP EASILY:
The catalog is comprehensive — every static path PLUS every firm-specific question PLUS every section + column-header. Before returning the empty "no match" response, try:
  1. Did the admin describe a question semantically? Match on QUESTION text in the dynamic catalog.
  2. Did they describe a section? Match on the section names in the sections catalog and emit a filterBySection loop using \`asList\` with col1..colN cells.
  3. Did they describe a column? Match on header text in the section-column-headers catalog and emit the corresponding {{col<N>}} reference.
  4. Did they describe an array operation (each / list / table / total)? Map to the corresponding pattern in Examples A / B / C / D / E.
  5. Even with a vaguely-worded request, propose your best guess at confidence ≥ 0.3 with a clear rationale — the admin can edit before pasting. Only return the empty response when the request is plainly OUTSIDE the audit file (e.g. firm admin settings, MyAccount data, hypothetical paths not in any catalog).

Return ONLY JSON:
{
  "snippet": "the Handlebars text to drop into the editor — valid, balanced, ready to paste. May contain HTML (<table>, <ul>, <tr>, etc.) when appropriate.",
  "path": "the primary dotted path chosen (the path without Handlebars braces). For a looped snippet, this is the array path that feeds the loop.",
  "label": "a short human label describing the chosen field or pattern",
  "rationale": "short (<=20 words) explanation of why this shape matches",
  "confidence": 0.0-1.0,
  "alternatives": [{"path": "...", "label": "...", "snippet": "..."}]   // up to 2 runners-up, or []
}

Reserve the empty response for genuinely off-catalog requests — and even then include 1-2 alternatives that are the closest in-catalog matches:
{ "snippet": "", "path": "", "label": "", "rationale": "Outside the audit file — describe what audit-file data you want instead.", "confidence": 0, "alternatives": [/* closest 1-2 in-catalog suggestions */] }`;

  const userPrompt = currentSnippet
    ? `REFINE the snippet below according to the description. Preserve the parts that work; only change what the description asks for. Return the full revised snippet (not a diff) under "snippet" in the JSON response.

Existing snippet:
\`\`\`
${currentSnippet}
\`\`\`

Description of the change wanted: ${description}${surroundingContext ? `\n\nSurrounding text in the template (for context): ${surroundingContext}` : ''}`
    : `Description: ${description}${surroundingContext ? `\n\nSurrounding text in the template (for context): ${surroundingContext}` : ''}`;

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

    // Anti-hallucination post-validation: reject any primary path that
    // references a MyAccount / firm-wide merge field (excludeFromSuggester
    // flag). The LLM was instructed not to pick those, but we enforce.
    // Same check against each alternative. If EVERYTHING the AI picked is
    // invalid we fail the call so the admin isn't tempted to use
    // off-audit-file data.
    const excludedKeys = new Set(MERGE_FIELDS.filter(f => f.excludeFromSuggester).map(f => f.key));
    function isExcludedPath(p: any): boolean {
      if (typeof p !== 'string' || !p) return false;
      const base = p.replace(/^priorPeriod\./, '');
      return excludedKeys.has(base);
    }
    if (isExcludedPath(parsed.path)) {
      parsed.path = '';
      parsed.snippet = '';
      parsed.rationale = (parsed.rationale || '') + ' (rejected: path is outside the audit file)';
      parsed.confidence = 0;
    }
    if (Array.isArray(parsed.alternatives)) {
      parsed.alternatives = parsed.alternatives.filter((a: any) => !isExcludedPath(a?.path));
    }
    return NextResponse.json(parsed);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Suggest failed' }, { status: 500 });
  }
}
