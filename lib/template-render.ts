/**
 * Render pipeline for document templates.
 *
 *   body (Handlebars HTML)  →  Handlebars  →  filled HTML
 *                           →  html-to-docx  →  OOXML body fragment
 *                           →  docxtemplater → final .docx (with skeleton)
 *
 * The firm-uploaded skeleton .docx must contain the raw-XML tag
 * `{@body}` (note the @) at the point where the rendered body should
 * appear. docxtemplater replaces that tag with the fragment as raw
 * XML so the body is rendered inline, not escaped.
 */

import { prisma } from '@/lib/db';
import { buildTemplateContext } from '@/lib/template-context';
import { renderBody, extractReferencedPaths } from '@/lib/template-handlebars';
import { htmlToDocxBody } from '@/lib/template-html-to-docx';
import { contextHasPath, buildSampleContext } from '@/lib/template-merge-fields';

// Dynamic imports for server-only packages (docxtemplater + pizzip
// use Node APIs that must not be bundled into client chunks).
async function loadDocxtemplater() {
  const [{ default: PizZip }, { default: Docxtemplater }] = await Promise.all([
    import('pizzip') as any,
    import('docxtemplater') as any,
  ]);
  return { PizZip, Docxtemplater };
}

export interface RenderResult {
  buffer: Buffer;
  fileName: string;
  skeletonName: string;
  templateName: string;
  /** True when the render used the live engagement context; false when it
   *  fell back to (or started from) the firm's sample context. */
  usedLiveContext: boolean;
  /** Placeholder dotted paths the template referenced but that aren't in
   *  the merge-field catalogue. Typos or paths for fields that were
   *  removed from the data model. */
  missingPlaceholders: string[];
  /** Placeholder dotted paths that DO exist in the context but resolved
   *  to null / undefined / empty string / empty array. Most common cause
   *  of "the Word doc has a blank where a value should be" — the admin
   *  usually just needs to fill in the missing data on the source form
   *  (e.g. a client address that's never been entered). */
  emptyPlaceholders: string[];
  /** The resolved client name + period, surfaced so the UI can confirm
   *  which engagement the render ran against. */
  resolvedClientName: string;
  resolvedPeriodEnd: string | null;
  /** Identifiers for deep-linking to source forms from the diagnostics
   *  UI. Null when running against sample context. */
  resolvedClientId: string | null;
  resolvedPeriodId: string | null;
  resolvedAuditType: string | null;
}

/**
 * Produce a .docx Buffer for a given template + engagement. Throws
 * with a clear message on any unrecoverable error — callers map the
 * message to a 4xx/5xx response.
 */
export async function renderTemplateToDocx(templateId: string, engagementId: string | null): Promise<RenderResult> {
  const template = await prisma.documentTemplate.findUnique({
    where: { id: templateId },
    include: { skeleton: true, firm: { select: { name: true } } },
  });
  if (!template) throw new Error('Template not found');
  if (template.kind !== 'document') throw new Error('Template kind must be "document" to render as Word');
  const skeleton = template.skeleton ?? await pickDefaultSkeleton(template.firmId, template.auditType);
  if (!skeleton) throw new Error('No firm skeleton attached to this template and no default skeleton exists for this firm / audit type. Upload one first.');

  // 1. Build context — live from the engagement if supplied, otherwise
  //    the firm's dynamic sample context (same thing preview uses).
  //    On live-context failure we also fall back to sample so a single
  //    missing column / FK bug doesn't block the admin getting a Word
  //    file out. usedLiveContext tracks which path we landed on so the
  //    caller can warn the user when the download isn't real data.
  let context: any;
  let usedLiveContext = false;
  if (engagementId) {
    try {
      context = await buildTemplateContext(engagementId);
      usedLiveContext = true;
    } catch (err) {
      console.error('[template-render] live context failed, falling back to sample:', err);
      context = await buildDynamicSampleContext(template.firmId);
    }
  } else {
    context = await buildDynamicSampleContext(template.firmId);
  }

  // 2. Handlebars render the body.
  const bodyHtml = template.content || '';
  const { html, error: hbError } = renderBody(bodyHtml, context);
  if (hbError) throw new Error(`Template render failed: ${hbError}`);

  // 3. Convert the rendered HTML into a docx body XML fragment.
  const bodyXml = htmlToDocxBody(html);

  // 4. Load skeleton from blob + run docxtemplater to inject `{@body}`.
  const { downloadBlob } = await import('@/lib/azure-blob');
  const skeletonBuffer = await downloadBlob(skeleton.storagePath, skeleton.containerName);
  const { PizZip, Docxtemplater } = await loadDocxtemplater();
  const zip = new PizZip(skeletonBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });
  // docxtemplater v3 expects `.render({...data})` and raw XML via
  // `{@tag}` auto-detect when parser is default. We pass the XML
  // directly — docxtemplater recognises the @ prefix.
  try {
    doc.render({ body: bodyXml });
  } catch (err: any) {
    const detail = err?.properties?.errors
      ? err.properties.errors.map((e: any) => e.properties?.explanation || e.message).join('; ')
      : (err?.message || 'docxtemplater render failed');
    throw new Error(`Skeleton stitching failed: ${detail}. Make sure the skeleton contains a literal {@body} tag.`);
  }
  const buffer = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });

  const clientNamePart = (context as any)?.client?.name || 'sample';
  const periodPart = (context as any)?.period?.periodEnd || 'sample';
  const fileNameSafe = `${slugify(template.name)}__${slugify(clientNamePart)}__${periodPart}.docx`;

  // Diagnostics — which placeholders the template body referenced and
  // what happened to them.
  //   - missing: path isn't in the context at all AND can't plausibly be
  //     one (typo / removed field). For questionnaire sub-paths we're
  //     generous: if the top-level `questionnaires.<type>` exists we
  //     treat unknown sub-keys as empty rather than typos, because the
  //     valid sub-keys depend on the firm's schema — and that's data
  //     missing, not a catalog error.
  //   - empty: path resolves to null / undefined / "" / [], OR is an
  //     expected-shape questionnaire/… sub-path with no answer supplied.
  const referenced = extractReferencedPaths(bodyHtml);
  const missingPlaceholders: string[] = [];
  const emptyPlaceholders: string[] = [];
  for (const p of referenced) {
    if (contextHasPath(context, p)) {
      const v = resolvePath(context, p);
      if (v === null || v === undefined
          || (typeof v === 'string' && v.trim() === '')
          || (Array.isArray(v) && v.length === 0)) {
        emptyPlaceholders.push(p);
      }
      continue;
    }
    // Sub-path of an existing top-level branch — likely an unpopulated
    // answer or a section key we haven't filled, not a catalog typo.
    // Applies to questionnaires specifically (most common case) but we
    // extend the rule to any dotted path whose first segment resolves.
    const dotIdx = p.indexOf('.');
    if (dotIdx > 0) {
      const top = p.slice(0, dotIdx);
      const rest = p.slice(dotIdx + 1);
      if ((top === 'questionnaires' || contextHasPath(context, top)) && rest.length) {
        emptyPlaceholders.push(p);
        continue;
      }
    }
    missingPlaceholders.push(p);
  }

  return {
    buffer,
    fileName: fileNameSafe,
    skeletonName: skeleton.name,
    templateName: template.name,
    usedLiveContext,
    missingPlaceholders,
    emptyPlaceholders,
    resolvedClientName: String(clientNamePart),
    resolvedPeriodEnd: (context as any)?.period?.periodEnd || null,
    resolvedClientId: (context as any)?.client?.id || null,
    resolvedPeriodId: (context as any)?.period?.id || null,
    resolvedAuditType: (context as any)?.engagement?.auditType || null,
  };
}

/** Walk a dotted path to a value. Returns undefined when any segment
 *  can't be resolved. Matches contextHasPath semantics. */
function resolvePath(ctx: any, path: string): any {
  const parts = path.split('.');
  let cur: any = ctx;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * Preview: run Handlebars only, return HTML + the list of referenced
 * paths that aren't in the live or sample context. No docx produced.
 * Used by the admin preview pane to iterate quickly on the body.
 */
export interface PreviewResult {
  html: string;
  error: string | null;
  missingPlaceholders: string[];
  usedLiveContext: boolean;
}

export async function previewTemplate(
  templateId: string,
  engagementId: string | null,
): Promise<PreviewResult> {
  const template = await prisma.documentTemplate.findUnique({ where: { id: templateId } });
  if (!template) throw new Error('Template not found');

  let context: any;
  let usedLiveContext = false;
  if (engagementId) {
    try {
      context = await buildTemplateContext(engagementId);
      usedLiveContext = true;
    } catch {
      context = await buildDynamicSampleContext(template.firmId);
    }
  } else {
    context = await buildDynamicSampleContext(template.firmId);
  }

  const bodyHtml = template.content || '';
  const referenced = extractReferencedPaths(bodyHtml);
  const missing = referenced.filter(p => !contextHasPath(context, p));
  const { html, error } = renderBody(bodyHtml, context);
  return { html, error, missingPlaceholders: missing, usedLiveContext };
}

/**
 * Build a preview context whose `questionnaires.*` branches reflect the
 * firm's ACTUAL methodology templates, not a hardcoded sample. For each
 * `*_questions` template defined by the firm, we emit one `asList`
 * entry per question with a placeholder answer chosen to make the most
 * common template patterns actually render:
 *
 *   - Y/N-style questions (inputType 'yesno' or dropdown options
 *     containing "Y"/"N" or "Yes"/"No") → answered "Y" / "Yes" so
 *     filterWhere(… "answer" "eq" "Y") actually matches in preview.
 *   - Dropdown with other options → the first option, so preview sees
 *     a realistic value rather than the sample literal.
 *   - Numeric / currency / date → sensible defaults (0, today).
 *   - Everything else → the question text reused as the answer, which
 *     makes templates that show (service name | threats) patterns
 *     render visibly distinct rows even without a real engagement.
 *
 * Falls back to the static buildSampleContext (everything else) when
 * the firm has no `*_questions` templates — better than rendering
 * nothing in an otherwise-valid template.
 */
async function buildDynamicSampleContext(firmId: string): Promise<Record<string, any>> {
  // Start from the static sample for every non-questionnaire branch
  // (engagement / client / period / materiality figures / etc.). We
  // only overwrite the `questionnaires` branch so preview still shows
  // realistic values for merge fields that don't live inside a
  // questionnaire schema.
  const base: Record<string, any> = buildSampleContext();

  try {
    const schemas = await prisma.methodologyTemplate.findMany({
      where: { firmId, templateType: { endsWith: '_questions' } },
    });
    if (schemas.length === 0) return base;

    const questionnaires: Record<string, any> = { ...(base.questionnaires || {}) };
    for (const schema of schemas) {
      const ctxKey = templateTypeToCtxKey(schema.templateType);

      // ── Items shape detection ────────────────────────────────────
      // Two production shapes:
      //   1. Array<TemplateQuestion> — flat list, each question carries
      //      its sectionKey. No top-level sectionMeta.
      //   2. { questions: TemplateQuestion[], sectionMeta: Record<sectionKey,
      //      { columnHeaders, layout, label, ... }> } — newer shape that
      //      lets a section declare table-layout + column headers.
      // Generic detection here so any new firm-defined schedule
      // automatically gets a populated preview without code changes.
      let items: any[] = [];
      let sectionMeta: Record<string, any> = {};
      if (Array.isArray(schema.items)) {
        items = schema.items as any[];
      } else if (schema.items && typeof schema.items === 'object') {
        const root = schema.items as any;
        items = Array.isArray(root.questions) ? root.questions
          : Array.isArray(root) ? root : [];
        sectionMeta = (root.sectionMeta && typeof root.sectionMeta === 'object') ? root.sectionMeta : {};
      }
      if (items.length === 0) { questionnaires[ctxKey] = questionnaires[ctxKey] || { asList: [] }; continue; }

      // Stable sort by sortOrder so previousAnswer / nextAnswer
      // pointers reflect the order the admin sees in the schedule.
      const sorted = [...items].sort((a, b) => (Number(a?.sortOrder) || 0) - (Number(b?.sortOrder) || 0));

      interface SampleItem {
        question: string; key: string; answer: any; section: string | null; sortOrder: number;
        previousKey: string | null; previousQuestion: string | null; previousAnswer: any;
        nextKey: string | null; nextQuestion: string | null; nextAnswer: any;
        itemIndex: number; isEmpty: boolean;
        // Multi-column cells. Always present when the section's layout
        // has columnHeaders, alongside slug + verbatim aliases. Indexed
        // by colKey ('col1', 'col2', …) so every preview row exposes
        // every storage cell — even the ones the admin hasn't iterated
        // yet, since asList is the canonical loop source.
        [k: string]: any;
      }

      // Round-robin counter for col1 Y/N alternation when the section
      // is table-layout with a yesno trigger column. Keeps preview
      // visibly varied — some rows match a Y filter, some don't —
      // matching how a real engagement looks.
      let columnYesCounter = 0;

      const asList: SampleItem[] = sorted.map((item, i) => {
        const sectionName: string | null = item?.sectionKey ? String(item.sectionKey) : null;
        const meta = sectionName
          ? (sectionMeta[sectionName] || sectionMeta[slugifySection(sectionName)])
          : null;
        const headers: string[] = Array.isArray(meta?.columnHeaders) ? meta.columnHeaders : [];

        const row: SampleItem = {
          question: String(item?.questionText ?? item?.label ?? item?.key ?? `Question ${i + 1}`),
          key: String(item?.key ?? `q_${i + 1}`),
          answer: placeholderAnswerFor(item),
          section: sectionName,
          sortOrder: Number(item?.sortOrder) || i,
          previousKey: null, previousQuestion: null, previousAnswer: null,
          nextKey: null, nextQuestion: null, nextAnswer: null,
          itemIndex: i, isEmpty: false,
        };

        // ── Multi-column cells (col1, col2, col3, …) ─────────────────
        // When a question has a `columns` array (any layout that
        // declares per-cell input types) we synthesise placeholder
        // values per cell so filterWhere/render snippets can match
        // and produce visible output. The mapping mirrors live
        // storage:
        //   columns[0]  → col1
        //   columns[1]  → col2
        //   columns[2]  → col3
        // (the row-label column / question text is col0 →
        // {{question}} and has no stored cell).
        const columns: any[] = Array.isArray(item?.columns) ? item.columns : [];
        const cellValues: Record<string, any> = {};
        if (columns.length > 0) {
          const firstIsYesNo = String(columns[0]?.inputType || '').toLowerCase() === 'yesno';
          // Alternate the trigger column Y/N every other row when
          // the layout has a leading yesno column. Lets a Preview
          // of `filterWhere ... col1 == Y` produce *some* rows
          // while still showing rows that fail the filter when
          // unfiltered.
          for (let ci = 0; ci < columns.length; ci++) {
            const colN = ci + 1;
            const colKey = `col${colN}`;
            const cellInputType = String(columns[ci]?.inputType || '').toLowerCase();
            let cellValue: any;
            if (cellInputType === 'yesno') {
              if (ci === 0 && firstIsYesNo) {
                cellValue = (columnYesCounter++ % 2 === 0) ? 'Y' : 'N';
              } else {
                cellValue = 'Y';
              }
            } else if (cellInputType === 'currency' || cellInputType === 'number'
                       || cellInputType === 'percentage' || cellInputType === 'decimal') {
              cellValue = 0;
            } else if (cellInputType === 'date') {
              cellValue = new Date().toISOString().slice(0, 10);
            } else if (Array.isArray(columns[ci]?.dropdownOptions) && columns[ci].dropdownOptions.length > 0) {
              cellValue = columns[ci].dropdownOptions[0];
            } else {
              // Free-text cell. Use the matching column header as the
              // sample text so preview columns are visibly distinct
              // ("Threat Description", "Safeguard", …) and the admin
              // can see exactly which column ended up where.
              const header = headers[colN] || `Sample ${colKey}`;
              cellValue = `[sample ${header}]`;
            }
            cellValues[colKey] = cellValue;
            row[colKey] = cellValue;
          }
        }

        // ── Header-slug + verbatim header aliases ────────────────────
        // Same logic as enrichQuestionnaire on the live render path —
        // mirroring it here means preview behaves identically to the
        // generated document for filterWhere arguments and per-cell
        // {{slug}} placeholders.
        if (headers.length > 0) {
          const seenSlug = new Map<string, number>();
          const seenVerbatim = new Set<string>();
          for (let h = 1; h < headers.length; h++) {
            const verbatim = String(headers[h] || '');
            const slug = slugifyHeaderText(verbatim);
            if (!slug) continue;
            const count = (seenSlug.get(slug) || 0) + 1;
            seenSlug.set(slug, count);
            const finalSlug = count === 1 ? slug : `${slug}_${count}`;
            const colKey = `col${h}`;
            const v = cellValues[colKey];
            if (v !== undefined) {
              row[finalSlug] = v;
              if (verbatim && verbatim !== finalSlug && !seenVerbatim.has(verbatim)) {
                seenVerbatim.add(verbatim);
                row[verbatim] = v;
              }
            }
          }
        }

        return row;
      });
      // Neighbour pointers — same post-pass as the real
      // `enrichQuestionnaire`, so templates that use
      // previousAnswer / nextAnswer behave identically in preview
      // and in the generated document.
      for (let i = 0; i < asList.length; i++) {
        const prev = i > 0 ? asList[i - 1] : null;
        const next = i < asList.length - 1 ? asList[i + 1] : null;
        asList[i].previousKey = prev?.key ?? null;
        asList[i].previousQuestion = prev?.question ?? null;
        asList[i].previousAnswer = prev?.answer ?? null;
        asList[i].nextKey = next?.key ?? null;
        asList[i].nextQuestion = next?.question ?? null;
        asList[i].nextAnswer = next?.answer ?? null;
      }

      // Flat key → answer map and per-section grouping. Matches the
      // shape `enrichQuestionnaire` returns so {{questionnaires.ethics.threat_identified}}
      // works in preview as well as live.
      const flat: Record<string, any> = {};
      const bySection: Record<string, Record<string, any>> = {};
      for (const e of asList) {
        flat[e.key] = e.answer;
        if (e.section) {
          const sec = slugifySection(e.section);
          if (!bySection[sec]) bySection[sec] = {};
          bySection[sec][e.key] = e.answer;
        }
      }
      questionnaires[ctxKey] = { ...flat, asList, bySection };
    }
    base.questionnaires = questionnaires;
  } catch (err) {
    // Dynamic build is best-effort — never fail the preview over it.
    // eslint-disable-next-line no-console
    console.warn('[previewTemplate] dynamic sample context failed, falling back to static:', err);
  }
  return base;
}

/** Header-text → Handlebars-safe slug. Matches the slugify rule used
 *  in enrichQuestionnaire (lib/template-context.ts) so preview and
 *  live render identical aliases for the same column headers. */
function slugifyHeaderText(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Pick a plausible placeholder answer for a single template question
 * so preview renders MEANINGFUL data rather than "(sample)" stubs.
 * The heuristics are deliberately simple — the goal is visible-but-
 * unambiguous, not a perfect stand-in for real answers.
 */
function placeholderAnswerFor(item: any): string | number | boolean {
  const inputType = String(item?.inputType || '').toLowerCase();
  const options: string[] = Array.isArray(item?.dropdownOptions) ? item.dropdownOptions : [];

  // Y/N question — pick the "Yes" value so templates that filter on
  // =="Y" or =="Yes" actually render rows in preview.
  const isYesNoLike = inputType === 'yesno' || inputType === 'boolean'
    || options.some(o => /^y(es)?$/i.test(o));
  if (isYesNoLike) {
    const ys = options.find(o => /^y(es)?$/i.test(o));
    return ys ?? 'Y';
  }

  // Explicit dropdown with options — take the first one. Gives the
  // preview a realistic value rather than the sample literal.
  if (options.length > 0) return options[0];

  // Numeric family — zero is safer than a magic number.
  if (['number', 'currency', 'percentage', 'decimal'].includes(inputType)) return 0;

  // Date — today, ISO yyyy-mm-dd, so {{formatDate}} handles it.
  if (inputType === 'date') return new Date().toISOString().slice(0, 10);

  // Long-text / free-text / anything else — emit a clearly-labelled
  // placeholder rather than reusing the question text. Previously the
  // preview was pulling question text into {{previousAnswer}} /
  // {{nextAnswer}} cells, which read as "the template is returning
  // questions, not answers". Square brackets make it visibly a
  // sample, and including the question key (or the question text when
  // there's no key) lets the auditor trace each placeholder back to
  // its source row at a glance.
  const key = String(item?.key ?? '').trim();
  const qtext = String(item?.questionText ?? item?.label ?? '').trim();
  if (key) return `[sample: ${key}]`;
  if (qtext) return `[sample answer for "${qtext.slice(0, 60)}${qtext.length > 60 ? '…' : ''}"]`;
  return '[sample answer]';
}

/** Turn `permanent_file_questions` into `permanentFile`. Mirrors the
 *  canonical mapping in template-context.ts so the preview exposes
 *  the same `questionnaires.<key>` keys the live path uses. */
function templateTypeToCtxKey(templateType: string): string {
  const canonical: Record<string, string> = {
    permanent_file_questions: 'permanentFile',
    ethics_questions: 'ethics',
    continuance_questions: 'continuance',
    materiality_questions: 'materiality',
    new_client_takeon_questions: 'newClientTakeOn',
    subsequent_events_questions: 'subsequentEvents',
  };
  if (canonical[templateType]) return canonical[templateType];
  const stem = templateType.replace(/_questions$/, '');
  return stem.replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase());
}

function slugifySection(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'section';
}

/**
 * Render an EMAIL-kind template against a live engagement. Returns
 * the rendered subject + HTML body (both through Handlebars). Used by
 * the Planning Letter send endpoint to produce a covering email.
 *
 * Unlike `renderTemplateToDocx`, this does not touch skeletons and
 * does not produce a Word file — it's pure Handlebars over the
 * template's `subject` and `content` fields.
 */
export interface EmailRenderResult {
  subject: string;
  html: string;
  templateName: string;
}
export async function renderEmailTemplate(templateId: string, engagementId: string): Promise<EmailRenderResult> {
  const template = await prisma.documentTemplate.findUnique({ where: { id: templateId } });
  if (!template) throw new Error('Email template not found');
  if (template.kind !== 'email') throw new Error('Template kind must be "email" to render as an email body');

  const context = await buildTemplateContext(engagementId);
  // Render subject and body separately so a Handlebars error in one
  // doesn't mask the other. Subject falls back to the template name
  // when the template has no subject configured.
  const rawSubject = template.subject || template.name;
  const { html: subjectHtml, error: subjectError } = renderBody(rawSubject, context);
  if (subjectError) throw new Error(`Email subject render failed: ${subjectError}`);
  // Subjects are plain text — strip any tags Handlebars didn't consume.
  const subject = stripHtml(subjectHtml).trim() || template.name;

  const { html, error: bodyError } = renderBody(template.content || '', context);
  if (bodyError) throw new Error(`Email body render failed: ${bodyError}`);
  return { subject, html, templateName: template.name };
}
function stripHtml(s: string): string {
  return String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
}

/** Return the default skeleton for a firm+auditType, falling back to
 *  any default skeleton for ALL audit types, then any active skeleton
 *  at all. Null if the firm has nothing uploaded. */
async function pickDefaultSkeleton(firmId: string, auditType: string) {
  const candidates = await prisma.firmDocumentSkeleton.findMany({
    where: { firmId, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
  return candidates.find(s => s.isDefault && s.auditType === auditType)
    || candidates.find(s => s.isDefault && s.auditType === 'ALL')
    || candidates.find(s => s.auditType === auditType)
    || candidates.find(s => s.auditType === 'ALL')
    || candidates[0]
    || null;
}

/** Simple filename slug — strips anything that isn't filename-safe. */
function slugify(s: string): string {
  return String(s || 'file').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'file';
}

/**
 * Probe a skeleton .docx to make sure it contains a `{@body}` tag.
 * Used by the upload endpoint to reject skeletons that would render
 * into nothing and confuse the admin.
 */
export async function skeletonHasBodyPlaceholder(buffer: Buffer): Promise<boolean> {
  const { PizZip } = await loadDocxtemplater();
  try {
    const zip = new PizZip(buffer);
    const doc = zip.file('word/document.xml');
    if (!doc) return false;
    const xml = doc.asText();
    // Word can wrap `{@body}` across multiple runs; check both exact
    // and a more tolerant regex that allows runs between the braces.
    if (xml.includes('{@body}')) return true;
    return /\{[^}]*@[^}]*body[^}]*\}/.test(xml);
  } catch {
    return false;
  }
}
