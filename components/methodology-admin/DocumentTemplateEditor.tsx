'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Save, Eye, Download, AlertTriangle,
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Table, FileDown, Minus,
  SquareDashedBottom, Repeat, Variable, Sparkles, X, Check,
  ArrowUpToLine, ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine,
  Trash2, Merge, Split, Code,
} from 'lucide-react';
import { mergeFieldsByGroup, MERGE_FIELDS, type MergeField } from '@/lib/template-merge-fields';
import { AUDIT_TYPE_LABELS, type AuditType } from '@/types/methodology';
import type { Skeleton } from './FirmSkeletonManager';

/**
 * Document-template editor.
 *
 * What the admin sees:
 *   • A formatting toolbar (paragraph style / bold / italic / lists /
 *     alignment / insert table / insert page break / Handlebars scaffolds).
 *   • A contentEditable surface that renders HTML as it's typed —
 *     what they see is close to what the Word file will look like.
 *   • A merge-field palette grouped by category; click a pill to
 *     insert the matching `{{path}}` at the cursor.
 *   • A preview pane that renders the body against a real engagement
 *     (or canned sample data) and flags any placeholder that didn't
 *     resolve.
 *   • Save + Generate-Word buttons at the top.
 *
 * Implementation notes:
 *   • We use `document.execCommand` for formatting. It's deprecated
 *     in the spec but remains universally supported and is vastly
 *     simpler than rolling our own selection / DOM manipulation. The
 *     few cases it can't handle (page-break, custom blocks) we
 *     implement by splicing into the editable ourselves.
 *   • On save we read `innerHTML` verbatim. The HTML→docx converter
 *     (`lib/template-html-to-docx.ts`) handles the editor's output
 *     directly — no intermediate cleanup layer.
 *   • Pasted content is sanitised (plain text only by default) to
 *     stop Word inline-styles / MSO junk bloating the template.
 */

export interface DocumentTemplate {
  id: string;
  firmId: string;
  name: string;
  description: string | null;
  category: string;
  auditType: string;
  content: string;
  mergeFields: any[];
  recipients: any[];
  kind: string;
  skeletonId: string | null;
  version: number;
  isActive: boolean;
  updatedAt: string;
}

/**
 * One engagement option as supplied by the manager. Enriched shape
 * carries the clientId + periodId so the editor can power cascading
 * Client → Period dropdowns without needing a second round-trip. Older
 * callers that still hand back just {id, clientName, periodEnd} still
 * work — the cascade falls back to showing one row per engagement.
 */
interface EngagementOption {
  id: string;
  clientName: string;
  periodEnd: string | null;
  clientId?: string;
  periodId?: string;
  periodStart?: string | null;
  auditType?: string | null;
}

const CATEGORIES = [
  // Specific workflow categories at the top — picking one of these
  // makes the template visible in the corresponding tab action (e.g.
  // RMM's Send/Download Planning Letter popup filters by
  // `audit_planning_letter`).
  { value: 'audit_planning_letter', label: 'Audit Planning Letter' },
  { value: 'engagement_letter',     label: 'Engagement Letter' },
  { value: 'management_letter',     label: 'Management Letter' },
  // Generic buckets below.
  { value: 'general',          label: 'General' },
  { value: 'engagement',       label: 'Engagement' },
  { value: 'reporting',        label: 'Reporting' },
  { value: 'correspondence',   label: 'Correspondence' },
  { value: 'compliance',       label: 'Compliance' },
  { value: 'checklist',        label: 'Checklist' },
];
const AUDIT_TYPES = [
  { value: 'ALL', label: 'All types' },
  { value: 'SME', label: 'Statutory (SME)' },
  { value: 'PIE', label: 'PIE' },
  { value: 'SME_CONTROLS', label: 'Statutory + Controls' },
  { value: 'PIE_CONTROLS', label: 'PIE + Controls' },
];

// Paragraph styles the dropdown offers. The `execCommand` formatBlock
// values match the browser API (must be lowercase).
const BLOCK_STYLES: Array<{ value: string; label: string }> = [
  { value: 'p', label: 'Paragraph' },
  { value: 'h1', label: 'Heading 1' },
  { value: 'h2', label: 'Heading 2' },
  { value: 'h3', label: 'Heading 3' },
  { value: 'h4', label: 'Heading 4' },
];

export function DocumentTemplateEditor({
  template,
  skeletons,
  engagements,
  categories,
  onSaved,
  onClose,
}: {
  template: DocumentTemplate;
  skeletons: Skeleton[];
  engagements: EngagementOption[];
  // Optional — when provided (from the DocumentTemplateManagerClient),
  // the editor's category dropdown shows the firm's admin-managed
  // list instead of the hardcoded CATEGORIES fallback. Keeps the
  // editor usable in standalone contexts (tests, previews).
  categories?: Array<{ value: string; label: string }>;
  onSaved: (t: DocumentTemplate) => void;
  onClose: () => void;
}) {
  const categoryOptions = categories && categories.length > 0 ? categories : CATEGORIES;
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description || '');
  const [category, setCategory] = useState(template.category || 'general');
  const [auditType, setAuditType] = useState(template.auditType || 'ALL');
  const [skeletonId, setSkeletonId] = useState<string | null>(template.skeletonId);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  interface GenerateDiagnostics {
    usedLiveContext: boolean;
    resolvedClientName: string;
    resolvedPeriodEnd: string | null;
    emptyPlaceholders: string[];
    missingPlaceholders: string[];
  }
  const [generateInfo, setGenerateInfo] = useState<GenerateDiagnostics | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<{ html: string; missing: string[]; error: string | null; usedLive: boolean } | null>(null);
  // Preview / Generate target — chosen via cascading Client → Period
  // dropdowns below. The second dropdown lists engagements (one per
  // period × audit type) so an engagement with GROUP doesn't shadow an
  // SME engagement that shares the same period.
  const [selectedClientId, setSelectedClientId] = useState<string>(engagements[0]?.clientId || '');
  // selectedEngagementId IS the engagementId — the second dropdown
  // keys on engagements directly so no ambiguity when a period has
  // multiple audit types.
  const [selectedEngagementId, setSelectedEngagementId] = useState<string>(engagements[0]?.id || '');

  // Group engagements by client so the Period dropdown is filtered to
  // whatever periods actually exist for the chosen client. Engagements
  // without a clientId (legacy shape) fall through to a synthetic "All"
  // bucket so the UI still shows something.
  const engagementsByClient = useMemo(() => {
    const m = new Map<string, EngagementOption[]>();
    for (const e of engagements) {
      const cid = e.clientId || '__unknown__';
      if (!m.has(cid)) m.set(cid, []);
      m.get(cid)!.push(e);
    }
    return m;
  }, [engagements]);

  const clientOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ id: string; name: string }> = [];
    for (const e of engagements) {
      const cid = e.clientId || '__unknown__';
      if (seen.has(cid)) continue;
      seen.add(cid);
      out.push({ id: cid, name: e.clientName || 'Unnamed client' });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [engagements]);

  const periodOptions = useMemo(() => {
    if (!selectedClientId) return [];
    const list = engagementsByClient.get(selectedClientId) || [];
    // One row per ENGAGEMENT — not per period — so a client with both a
    // Statutory Audit and a Group engagement in the same period shows
    // two distinct options. Audit type is rendered via AUDIT_TYPE_LABELS
    // so the admin sees 'Statutory Audit' / 'Group' rather than raw
    // SME / GROUP enums.
    const out: Array<{ engagementId: string; label: string }> = list.map(e => {
      const typeLabel = e.auditType ? (AUDIT_TYPE_LABELS[e.auditType as AuditType] || e.auditType) : '';
      const periodLabel = e.periodStart && e.periodEnd
        ? `${e.periodStart} → ${e.periodEnd}`
        : (e.periodEnd ? `Period end ${e.periodEnd}` : 'No period dates');
      return {
        engagementId: e.id,
        label: typeLabel ? `${periodLabel} · ${typeLabel}` : periodLabel,
      };
    });
    // Stable sort: newest period first, then by audit-type label.
    return out.sort((a, b) => b.label.localeCompare(a.label));
  }, [selectedClientId, engagementsByClient]);

  // Resolve engagementId — just the selected one, since the dropdown
  // keys on it directly.
  const engagementId = selectedEngagementId;

  // If the pre-selected engagement isn't in the selected client's list
  // (stale state / client switch), clamp to the first available.
  useEffect(() => {
    if (!selectedClientId) return;
    if (!periodOptions.some(p => p.engagementId === selectedEngagementId)) {
      setSelectedEngagementId(periodOptions[0]?.engagementId || '');
    }
  }, [selectedClientId, periodOptions, selectedEngagementId]);
  // AI placeholder-suggester state. The modal takes a plain-English
  // description and asks the server (which in turn asks Llama 3.3)
  // to pick the best snippet out of the merge-field catalog, add a
  // formatter where useful, and wrap arrays in {{#each}} scaffolding.
  // "Insert HTML / Handlebars" modal state. The editor's default paste
  // handler strips HTML to plain text (so Word pastes don't drag in
  // <font> tags and inline styles). That makes it impossible to paste
  // a hand-written template snippet like a looping <table> — it just
  // renders as literal text. This modal is the escape hatch: paste
  // raw HTML + Handlebars, click Insert, it goes through insertRawHtml
  // so the editor treats it as structure rather than content.
  const [htmlOpen, setHtmlOpen] = useState(false);
  const [htmlDraft, setHtmlDraft] = useState('');
  // Pre-existing block the modal opened to EDIT, if any. Set when the
  // admin opens the modal with a non-empty selection (replace the
  // selection on Insert) or with the caret inside a structural element
  // such as a <table>, <ul>, <ol>, <blockquote>, <pre>, <figure>, or a
  // heading (replace the element's outerHTML on Insert). Lets the
  // admin click "insert HTML" again on a previously-pasted snippet to
  // edit it in place rather than facing a blank textarea every time.
  const [htmlReplaceTarget, setHtmlReplaceTarget] = useState<
    | { kind: 'selection'; range: Range }
    | { kind: 'element'; el: HTMLElement }
    | null
  >(null);
  // AI-build mini-form state, shown inline INSIDE the Insert HTML
  // modal. Distinct from the standalone "Ask AI for a placeholder"
  // suggester (suggestOpen / suggestDescription / suggestResult): this
  // one's specifically for generating / refining the snippet currently
  // in the htmlDraft textarea — the admin describes what they want, AI
  // returns a full Handlebars+HTML block, the textarea is updated and
  // they can hand-tune before inserting.
  const [aiBuildOpen, setAiBuildOpen] = useState(false);
  const [aiBuildPrompt, setAiBuildPrompt] = useState('');
  const [aiBuildLoading, setAiBuildLoading] = useState(false);
  const [aiBuildError, setAiBuildError] = useState<string | null>(null);
  // Source-mode: swap the WYSIWYG contentEditable for a plain
  // textarea showing the raw HTML of the template. Lets the admin
  // hand-edit the whole template — adjust a comment-wrapped
  // Handlebars block, fix a `<table>` by hand, etc. — without
  // fighting the browser's contentEditable normalisation. Toggling
  // back flushes the textarea content back into the contentEditable.
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceDraft, setSourceDraft] = useState('');
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestDescription, setSuggestDescription] = useState('');
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestResult, setSuggestResult] = useState<null | {
    snippet: string; path: string; label: string; rationale: string;
    confidence: number; alternatives: Array<{ path: string; label: string; snippet: string }>;
  }>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  // Selection range captured the moment the admin clicks "Ask AI" —
  // contentEditable loses focus to the modal, so without this the
  // eventual Insert would happen at the default caret position
  // (start of document) rather than where the admin was typing.
  const savedRangeRef = useRef<Range | null>(null);
  // Dynamic-table modal state. The admin picks an array source (any
  // `type: 'array'` field in the catalog), ticks which of the array's
  // itemFields should become columns, and the modal generates a
  // Handlebars-wrapped <table> whose {{#each}} body loops over the
  // array. Row count at render time matches the array length — a
  // perfect fit for questionnaire Q&A, error schedules, test
  // conclusions, engagement team, TB rows, etc.
  const [dynTableOpen, setDynTableOpen] = useState(false);
  const [dynTableSource, setDynTableSource] = useState<string>('');
  // Columns are now richer than "a picked itemField key" — each row
  // carries its own header text AND a content expression. Two modes:
  //   • kind='field' — pick one of the source's itemFields from a
  //     dropdown; the generator emits `{{fieldKey}}` (auto-wrapped
  //     in formatDate/formatCurrency when the type calls for it).
  //   • kind='custom' — the admin types a raw Handlebars expression
  //     (e.g. `{{formatDate this.answer "dd MMMM yyyy"}}` or
  //     `{{../benchmark_pct}}%` to reach a sibling question).
  // Back-compat isn't needed because the modal is insert-only today
  // (no edit-in-place), so templates that were already inserted
  // simply keep their saved HTML.
  interface DynColumn {
    id: string;              // stable React key + reorder target
    header: string;          // free-text; blank → fall back to label
    kind: 'field' | 'custom';
    fieldKey: string;        // kind='field': itemField.key
    customExpr: string;      // kind='custom': raw Handlebars (verbatim)
  }
  const [dynTableColumns, setDynTableColumns] = useState<DynColumn[]>([]);
  const [dynTableIncludeHeader, setDynTableIncludeHeader] = useState(true);
  // Filter wraps each rendered row. `field` is still an itemField
  // key (filters operate on the underlying item, independent of
  // which columns are displayed). `op` includes the unary variants
  // `isEmpty`/`isNotEmpty` (no RHS value needed).
  const [dynTableFilter, setDynTableFilter] = useState<{ field: string; op: string; value: string }>({ field: '', op: 'gt', value: '' });
  const [dynTableFilterEnabled, setDynTableFilterEnabled] = useState(false);
  // Total row. `columnId` refers to a DynColumn id (not an itemField
  // key) so the same field rendered twice can have one totalled and
  // one not. Only field-kind columns with numeric types are eligible.
  const [dynTableTotalEnabled, setDynTableTotalEnabled] = useState(false);
  const [dynTableTotalColumnId, setDynTableTotalColumnId] = useState<string>('');
  const [dynTableTotalLabel, setDynTableTotalLabel] = useState<string>('Total');

  // ── DynColumn helpers ────────────────────────────────────────────
  function newDynColumn(fieldKey = ''): DynColumn {
    return { id: Math.random().toString(36).slice(2, 10), header: '', kind: 'field', fieldKey, customExpr: '' };
  }
  function addDynColumn() { setDynTableColumns(cols => [...cols, newDynColumn()]); }
  function removeDynColumn(id: string) {
    setDynTableColumns(cols => cols.filter(c => c.id !== id));
    if (dynTableTotalColumnId === id) setDynTableTotalColumnId('');
  }
  function moveDynColumn(id: string, dir: -1 | 1) {
    setDynTableColumns(cols => {
      const idx = cols.findIndex(c => c.id === id);
      if (idx < 0) return cols;
      const next = idx + dir;
      if (next < 0 || next >= cols.length) return cols;
      const copy = cols.slice();
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy;
    });
  }
  function updateDynColumn(id: string, patch: Partial<DynColumn>) {
    setDynTableColumns(cols => cols.map(c => c.id === id ? { ...c, ...patch } : c));
  }
  // Cache the array-typed catalog entries so the picker doesn't
  // recompute on every keystroke.
  const arrayFields = useMemo(
    () => MERGE_FIELDS.filter(f => f.type === 'array' && Array.isArray(f.itemFields) && f.itemFields.length > 0),
    [],
  );
  const selectedArrayField = arrayFields.find(f => f.key === dynTableSource) || null;

  /** Capture the current editor selection so we can restore it later
   *  (e.g. after the user returns from the suggester modal). Returns
   *  whether a usable range was captured. */
  function captureSelection(): boolean {
    if (!editorRef.current) return false;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    // Only keep ranges that live inside the editor — if the user
    // clicked a toolbar button, the selection may have jumped.
    if (!editorRef.current.contains(range.commonAncestorContainer)) return false;
    savedRangeRef.current = range.cloneRange();
    return true;
  }
  /** Restore whatever we last captured via captureSelection(). No-op
   *  if nothing was saved, so insertRawHtml keeps its existing
   *  end-of-document fallback. */
  function restoreSelection(): void {
    const range = savedRangeRef.current;
    if (!range || !editorRef.current) return;
    editorRef.current.focus();
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }
  // Dirty-tracking + reference to the contentEditable node. We don't
  // mirror the HTML into React state on every keystroke — that'd
  // confuse cursor position. Instead we read from the DOM on save.
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [dirtyTick, setDirtyTick] = useState(0); // forces re-render of toolbar indicators

  const grouped = useMemo(() => mergeFieldsByGroup(), []);

  // Seed the editor once on mount with the stored content.
  useEffect(() => {
    if (editorRef.current && typeof template.content === 'string') {
      editorRef.current.innerHTML = template.content || defaultBody();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id]);

  /** Read the current body from the contentEditable and normalise it
   *  before persisting. Core problem we're defending against: the
   *  browser splits text across `<span>` runs when inline styling
   *  changes (e.g. typing inside a coloured region), which mangles
   *  `{{...}}` tokens so Handlebars can't parse them. We run the same
   *  sanitiser the server uses to strip `<tag>` fragments and decode
   *  HTML entities inside every `{{...}}` token. Also drops the
   *  trailing `<br>` contentEditable loves to leave at the end. */
  function readBody(): string {
    // In source mode the textarea is the source of truth — the
    // contentEditable's innerHTML hasn't been updated yet (that
    // happens only when the admin clicks "exit source"). Use the
    // draft directly so save / preview see the admin's latest edits.
    const raw = sourceMode ? sourceDraft : (editorRef.current?.innerHTML ?? '');
    let html = sanitiseHandlebarsInEditorHtml(raw);
    html = html.replace(/(<br\s*\/?>\s*)+$/i, '');
    return html;
  }

  /** Rewrite the editor's innerHTML to the sanitised version. Called
   *  on blur / before preview / before save so the admin sees any
   *  recovered tokens re-render as clean text in their own edit view,
   *  not just when the server renders. Preserves the caret position
   *  approximately by re-setting it to the end of the content. */
  function normaliseEditorInPlace() {
    const el = editorRef.current;
    if (!el) return;
    const before = el.innerHTML;
    const after = sanitiseHandlebarsInEditorHtml(before);
    if (before !== after) {
      el.innerHTML = after;
      // Best-effort caret restore — place it at the end of the
      // content so the admin can continue typing.
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  }

  // ── Toolbar actions ──────────────────────────────────────────────────────
  function exec(cmd: string, value?: string) {
    editorRef.current?.focus();
    try { document.execCommand(cmd, false, value); } catch { /* ignore — older browsers */ }
    setDirtyTick(t => t + 1);
  }
  function insertRawHtml(html: string) {
    editorRef.current?.focus();
    try { document.execCommand('insertHTML', false, html); }
    catch {
      // Fallback: append at end.
      if (editorRef.current) editorRef.current.innerHTML += html;
    }
    setDirtyTick(t => t + 1);
  }
  function insertMergeField(field: MergeField) {
    const snippet = field.type === 'array'
      ? `{{#each ${field.key}}}<br>&nbsp;&nbsp;${field.itemFields?.[0]?.key ? `{{${field.itemFields[0].key}}}` : ''}<br>{{/each}}`
      : field.type === 'object'
        ? `{{${field.key}.fieldName}}`
        : `{{${field.key}}}`;
    insertRawHtml(snippet);
  }
  function insertTable(rows: number, cols: number) {
    const cell = '<td style="border:1px solid #94a3b8;padding:6px;min-width:60px">&nbsp;</td>';
    const row = `<tr>${cell.repeat(cols)}</tr>`;
    const tbl = `<table style="border-collapse:collapse;width:100%;margin:8px 0">${row.repeat(rows)}</table><p></p>`;
    insertRawHtml(tbl);
  }
  function insertPageBreak() {
    insertRawHtml('<div class="page-break" style="page-break-before:always;border-top:2px dashed #cbd5e1;color:#94a3b8;font-size:10px;text-align:center;margin:12px 0;padding:2px">— page break —</div><p></p>');
  }
  function insertHorizontalRule() { exec('insertHorizontalRule'); }
  function insertConditional() { insertRawHtml('{{#if condition}}<br>&nbsp;&nbsp;<br>{{else}}<br>&nbsp;&nbsp;<br>{{/if}}'); }
  function insertLoop() { insertRawHtml('{{#each errorSchedule}}<br>&nbsp;&nbsp;{{fsLine}} — {{formatCurrency amount}}: {{description}}<br>{{/each}}'); }
  function insertErrorTable() { insertRawHtml('{{{errorScheduleTable errorSchedule}}}'); }

  // ── Insert HTML modal — open with smart pre-fill ─────────────────────────
  /**
   * Open the Insert HTML modal, pre-filling the textarea so the admin
   * can EDIT what's there rather than always seeing a blank box.
   *
   * Three modes, in priority order:
   *   1. There's a non-collapsed selection inside the editor → seed
   *      the textarea with the selection's HTML and remember the range
   *      so Insert replaces the selection.
   *   2. The caret is inside (or descendant of) a structural block —
   *      <table>, <ul>, <ol>, <blockquote>, <pre>, <figure>, <h1..h6>
   *      — seed with that block's outerHTML and remember the element
   *      so Insert replaces it.
   *   3. Otherwise → blank textarea, insert at the saved caret on Insert.
   *
   * The classic "click the same button to come back to my snippet" UX
   * works because the second click reuses mode 2 (the caret is inside
   * the table / heading the previous insert produced).
   */
  function openInsertHtmlModal() {
    setAiBuildOpen(false);
    setAiBuildPrompt('');
    setAiBuildError(null);

    // Mode 1: non-collapsed selection.
    if (typeof window !== 'undefined' && editorRef.current) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (editorRef.current.contains(range.commonAncestorContainer) && !range.collapsed) {
          const fragment = range.cloneContents();
          const wrapper = document.createElement('div');
          wrapper.appendChild(fragment);
          setHtmlReplaceTarget({ kind: 'selection', range: range.cloneRange() });
          setHtmlDraft(wrapper.innerHTML);
          setHtmlOpen(true);
          return;
        }

        // Mode 2: caret inside a structural block we know how to edit.
        if (editorRef.current.contains(range.commonAncestorContainer)) {
          const STRUCTURAL = new Set([
            'TABLE', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'FIGURE',
            'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
          ]);
          let node: Node | null = range.startContainer;
          if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
          let found: HTMLElement | null = null;
          while (node && node !== editorRef.current) {
            if (node.nodeType === Node.ELEMENT_NODE && STRUCTURAL.has((node as HTMLElement).tagName)) {
              found = node as HTMLElement;
              break;
            }
            node = node.parentNode;
          }
          if (found) {
            setHtmlReplaceTarget({ kind: 'element', el: found });
            setHtmlDraft(found.outerHTML);
            setHtmlOpen(true);
            return;
          }
        }
      }
    }

    // Mode 3: fresh insert at caret.
    setHtmlReplaceTarget(null);
    setHtmlDraft('');
    setHtmlOpen(true);
  }

  /**
   * Commit the contents of the Insert HTML modal back into the editor.
   * Branches on htmlReplaceTarget set by openInsertHtmlModal:
   *   • selection → restore the saved range, delete its contents, drop
   *     the new HTML in its place.
   *   • element   → swap the captured element's outerHTML.
   *   • null      → insert at the saved caret (the original behaviour).
   */
  function commitInsertHtmlModal() {
    const html = htmlDraft;
    if (htmlReplaceTarget?.kind === 'element') {
      const target = htmlReplaceTarget.el;
      // The target may have been removed since the modal opened (e.g.
      // the admin deleted the parent in the editor while the modal was
      // hanging in front of it). Fall back to caret insert.
      if (target.isConnected) {
        // Use a temporary container to parse the new HTML, then swap.
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        const replacement = document.createDocumentFragment();
        while (tmp.firstChild) replacement.appendChild(tmp.firstChild);
        target.replaceWith(replacement);
        setDirtyTick(t => t + 1);
      } else {
        restoreSelection();
        insertRawHtml(html);
      }
    } else if (htmlReplaceTarget?.kind === 'selection') {
      // Restore the saved range, replace its contents.
      const range = htmlReplaceTarget.range;
      if (editorRef.current && editorRef.current.contains(range.startContainer)) {
        editorRef.current.focus();
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
          // execCommand('insertHTML') replaces the selection AND interprets
          // the HTML as structure — exactly what we want here.
          try { document.execCommand('insertHTML', false, html); }
          catch {
            range.deleteContents();
            const tmp = document.createElement('div');
            tmp.innerHTML = html;
            const frag = document.createDocumentFragment();
            while (tmp.firstChild) frag.appendChild(tmp.firstChild);
            range.insertNode(frag);
          }
          setDirtyTick(t => t + 1);
        }
      } else {
        // Range no longer valid — fall back to caret insert.
        restoreSelection();
        insertRawHtml(html);
      }
    } else {
      // Plain insert at caret — original flow.
      restoreSelection();
      insertRawHtml(html);
    }
    setHtmlOpen(false);
    setHtmlReplaceTarget(null);
    setAiBuildOpen(false);
    setAiBuildPrompt('');
    setAiBuildError(null);
  }

  /**
   * AI-build action — inside the Insert HTML modal. The admin types a
   * description ("loop the Non Audit Services section, only Y rows,
   * 2-column table"), AI produces a snippet, the textarea is updated.
   * If the textarea currently has content we pass it as `currentSnippet`
   * so the AI can refine rather than starting from scratch.
   */
  async function runAiBuild() {
    const description = aiBuildPrompt.trim();
    if (!description) return;
    setAiBuildLoading(true);
    setAiBuildError(null);
    try {
      const res = await fetch('/api/methodology-admin/template-documents/suggest-placeholder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          // Pass the current draft as `currentSnippet`. The endpoint
          // will treat a non-empty value as a refine request: the AI
          // is asked to MODIFY the snippet rather than generate from
          // scratch. Older clients that don't pass it work as before.
          currentSnippet: htmlDraft || undefined,
          // Surrounding context from the editor so the AI knows whether
          // the snippet is going into prose, a list, a table, etc.
          context: (editorRef.current?.innerText || '').slice(-400),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiBuildError(data.error || 'AI build failed');
        return;
      }
      const snippet = String(data?.snippet || '').trim();
      if (!snippet) {
        setAiBuildError(data?.rationale || 'AI returned no snippet — try rewording.');
        return;
      }
      // Replace the textarea content with the AI's snippet. The admin
      // can hand-edit before clicking Insert.
      setHtmlDraft(snippet);
      setAiBuildOpen(false);
      setAiBuildPrompt('');
    } catch (err: any) {
      setAiBuildError(err?.message || 'AI build failed');
    } finally {
      setAiBuildLoading(false);
    }
  }

  // ── Static-table editing ─────────────────────────────────────────────────
  /** Walk up from the current selection's anchor to find a particular
   *  table-related ancestor. Returns null if the caret isn't inside
   *  a table (or inside a different element altogether). Used by the
   *  add/remove-row/column handlers so the toolbar buttons operate
   *  on whatever the admin is currently clicked into. */
  function findAncestor(tagName: string): HTMLElement | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    let node: Node | null = sel.getRangeAt(0).startContainer;
    while (node && node !== editorRef.current) {
      if (node.nodeType === 1 && (node as HTMLElement).tagName === tagName) return node as HTMLElement;
      node = node.parentNode;
    }
    return null;
  }
  /** React doesn't manage the contentEditable's HTML — we mutate the
   *  DOM directly, then bump dirtyTick so the React tree re-renders
   *  any dependent UI (toolbar disabled states etc.). */
  function touched() { setDirtyTick(t => t + 1); }

  /** Build a fresh empty cell that matches the styling of existing
   *  cells in the table (so added rows/columns don't look different). */
  function makeEmptyCell(template?: HTMLTableCellElement): HTMLTableCellElement {
    const td = document.createElement('td');
    td.innerHTML = '&nbsp;';
    if (template?.style.cssText) td.style.cssText = template.style.cssText;
    else td.style.cssText = 'border:1px solid #94a3b8;padding:6px;min-width:60px';
    return td;
  }

  function addRow(where: 'above' | 'below') {
    const row = findAncestor('TR') as HTMLTableRowElement | null;
    if (!row) { alert('Click inside a table row first.'); return; }
    const table = row.closest('table');
    if (!table) return;
    const cols = row.cells.length;
    const newRow = document.createElement('tr');
    for (let i = 0; i < cols; i++) newRow.appendChild(makeEmptyCell(row.cells[i] as HTMLTableCellElement));
    if (where === 'above') row.parentNode?.insertBefore(newRow, row);
    else row.parentNode?.insertBefore(newRow, row.nextSibling);
    touched();
  }
  function deleteRow() {
    const row = findAncestor('TR') as HTMLTableRowElement | null;
    if (!row) { alert('Click inside a table row first.'); return; }
    const table = row.closest('table');
    if (!table) return;
    // Don't leave a table with zero body rows — remove the whole
    // table instead so the admin doesn't end up with an empty shell.
    if (table.querySelectorAll('tr').length <= 1) { table.remove(); touched(); return; }
    row.remove();
    touched();
  }
  function addColumn(where: 'left' | 'right') {
    const cell = findAncestor('TD') as HTMLTableCellElement | null || findAncestor('TH') as HTMLTableCellElement | null;
    if (!cell) { alert('Click inside a table cell first.'); return; }
    const row = cell.parentElement as HTMLTableRowElement | null;
    if (!row) return;
    const table = row.closest('table');
    if (!table) return;
    const colIdx = cell.cellIndex;
    // Every row in the table (including header) gets a cell inserted
    // at the same column index so the grid stays rectangular.
    for (const r of Array.from(table.querySelectorAll('tr'))) {
      const target = (r as HTMLTableRowElement).cells[colIdx] as HTMLTableCellElement | undefined;
      const newCell = makeEmptyCell(target);
      if (where === 'left') r.insertBefore(newCell, target ?? null);
      else r.insertBefore(newCell, target?.nextSibling ?? null);
    }
    touched();
  }
  function deleteColumn() {
    const cell = findAncestor('TD') as HTMLTableCellElement | null || findAncestor('TH') as HTMLTableCellElement | null;
    if (!cell) { alert('Click inside a table cell first.'); return; }
    const row = cell.parentElement as HTMLTableRowElement | null;
    if (!row) return;
    const table = row.closest('table');
    if (!table) return;
    const colIdx = cell.cellIndex;
    // If this is the only column, drop the whole table.
    if ((row as HTMLTableRowElement).cells.length <= 1) { table.remove(); touched(); return; }
    for (const r of Array.from(table.querySelectorAll('tr'))) {
      const target = (r as HTMLTableRowElement).cells[colIdx] as HTMLTableCellElement | undefined;
      target?.remove();
    }
    touched();
  }
  function deleteTable() {
    const table = findAncestor('TABLE') as HTMLTableElement | null;
    if (!table) { alert('Click inside a table first.'); return; }
    if (!confirm('Delete this whole table?')) return;
    table.remove();
    touched();
  }

  /** Merge the current cell with its right-hand neighbour — grows the
   *  current cell's colspan and removes the next cell. No-op at the
   *  end of a row. Cell contents of the absorbed neighbour aren't
   *  kept (common Word behaviour). */
  function mergeRight() {
    const cell = (findAncestor('TD') as HTMLTableCellElement | null) || (findAncestor('TH') as HTMLTableCellElement | null);
    if (!cell) { alert('Click inside a table cell first.'); return; }
    const next = cell.nextElementSibling as HTMLTableCellElement | null;
    if (!next || (next.tagName !== 'TD' && next.tagName !== 'TH')) { alert('No cell to the right to merge with.'); return; }
    cell.colSpan = (cell.colSpan || 1) + (next.colSpan || 1);
    next.remove();
    touched();
  }
  /** Merge the current cell with the cell directly below it. Simple
   *  model: walks to the next <tr> and takes its first cell as the
   *  merge target, which only matches the intuitive "down" direction
   *  when there are no prior rowspans shifting the grid. Good enough
   *  for the common case; advanced admins can hand-tidy HTML after. */
  function mergeDown() {
    const cell = (findAncestor('TD') as HTMLTableCellElement | null) || (findAncestor('TH') as HTMLTableCellElement | null);
    if (!cell) { alert('Click inside a table cell first.'); return; }
    const row = cell.parentElement as HTMLTableRowElement | null;
    if (!row) return;
    const nextRow = row.nextElementSibling as HTMLTableRowElement | null;
    if (!nextRow) { alert('No row below to merge with.'); return; }
    // Take the cell in the next row at the same column index. Ignores
    // prior rowspans (known limitation — see comment above).
    const colIdx = cell.cellIndex;
    const target = (nextRow.cells[colIdx] as HTMLTableCellElement | undefined);
    if (!target) { alert('No cell below to merge with.'); return; }
    cell.rowSpan = (cell.rowSpan || 1) + (target.rowSpan || 1);
    target.remove();
    // If the next row is now empty, remove it too.
    if (nextRow.cells.length === 0) nextRow.remove();
    touched();
  }
  /** Reset the cell to a single-column / single-row slot and insert
   *  empty cells to restore the grid. Mirror of merge. */
  function splitCell() {
    const cell = (findAncestor('TD') as HTMLTableCellElement | null) || (findAncestor('TH') as HTMLTableCellElement | null);
    if (!cell) { alert('Click inside a table cell first.'); return; }
    const row = cell.parentElement as HTMLTableRowElement | null;
    if (!row) return;
    const extraCols = (cell.colSpan || 1) - 1;
    const extraRows = (cell.rowSpan || 1) - 1;
    if (extraCols === 0 && extraRows === 0) { alert('Cell is already a single slot.'); return; }
    // Restore the extra columns in the current row.
    for (let i = 0; i < extraCols; i++) {
      const blank = makeEmptyCell(cell);
      row.insertBefore(blank, cell.nextSibling);
    }
    cell.colSpan = 1;
    cell.rowSpan = 1;
    // Add blank cells to each row the original cell's rowspan covered.
    // This is a best-effort restore; it appends to the row rather than
    // trying to find the exact original column index (which is lost
    // once the rowspan is applied).
    let r: Element | null = row.nextElementSibling;
    for (let i = 0; i < extraRows && r; i++, r = r.nextElementSibling) {
      const totalCols = (extraCols || 0) + 1;
      for (let c = 0; c < totalCols; c++) r.appendChild(makeEmptyCell(cell));
    }
    touched();
  }

  // ── AI placeholder suggester ──────────────────────────────────────────────
  /** Run the description through the server-side suggester and stash
   *  the result on state. The modal stays open so the admin can see
   *  the rationale + alternatives before hitting Insert. */
  async function runSuggest() {
    const description = suggestDescription.trim();
    if (!description) return;
    setSuggestLoading(true);
    setSuggestError(null);
    setSuggestResult(null);
    try {
      // Grab a little of the surrounding text from the editor so the
      // AI can pick a wrapper that fits (prose vs list vs table).
      let surroundingContext = '';
      try {
        const text = editorRef.current?.innerText || '';
        surroundingContext = text.slice(-400); // last 400 chars
      } catch { /* ignore */ }
      const res = await fetch('/api/methodology-admin/template-documents/suggest-placeholder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, context: surroundingContext }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSuggestError(data.error || 'Suggest failed');
      } else if (!data.snippet) {
        setSuggestError(data.rationale || 'No match in catalog.');
      } else {
        setSuggestResult(data);
      }
    } catch (err: any) {
      setSuggestError(err?.message || 'Suggest failed');
    } finally {
      setSuggestLoading(false);
    }
  }
  /** Build the Handlebars-wrapped <table> for the dynamic-table
   *  modal and insert it at the saved caret position. Expects at
   *  least one column selected. Handles three optional extras:
   *   • per-column custom header text
   *   • a filter wrapping each row (only rows matching render)
   *   • a trailing total row that sums a chosen numeric column. */
  function acceptDynamicTable() {
    if (!selectedArrayField || dynTableColumns.length === 0) return;
    // Produce a clean, minimally-styled table. The HTML-to-docx
    // converter preserves borders/alignment and Word inherits the
    // skeleton's default font/colour.
    const cellStyle = 'border:1px solid #94a3b8;padding:6px;vertical-align:top';
    const headStyle = 'border:1px solid #94a3b8;padding:6px;text-align:left;background:#f1f5f9';
    const totalCellStyle = 'border:1px solid #94a3b8;padding:6px;font-weight:bold;background:#f8fafc';
    const itemFields = selectedArrayField.itemFields || [];

    // Per-column header: use the override if present, otherwise fall
    // back to the itemField label (field columns) or blank (custom).
    function headerFor(col: DynColumn): string {
      const override = col.header.trim();
      if (override) return override;
      if (col.kind === 'field') {
        return itemFields.find(f => f.key === col.fieldKey)?.label || col.fieldKey || '';
      }
      return '';
    }
    // Per-column cell body — same logic as before for fields (auto-
    // formatted by type), plus a verbatim passthrough for custom.
    function contentFor(col: DynColumn): string {
      if (col.kind === 'custom') return col.customExpr; // verbatim Handlebars
      if (!col.fieldKey) return '';
      const itf = itemFields.find(f => f.key === col.fieldKey);
      if (itf?.type === 'currency') return `{{formatCurrency ${col.fieldKey}}}`;
      if (itf?.type === 'date') return `{{formatDate ${col.fieldKey} "dd MMMM yyyy"}}`;
      return `{{${col.fieldKey}}}`;
    }

    // Header row — either a <thead><tr>…</tr></thead> or nothing.
    const headerHtml = dynTableIncludeHeader
      ? '<thead><tr>' + dynTableColumns.map(col => `<th style="${headStyle}">${escapeHtml(headerFor(col))}</th>`).join('') + '</tr></thead>'
      : '';

    // Body cells.
    const bodyCells = dynTableColumns.map(col => `<td style="${cellStyle}">${contentFor(col)}</td>`).join('');

    // Optional per-row filter. Handlebars subexpression form (the
    // helpers — eq/gt/lt/etc — were registered earlier in
    // lib/template-handlebars.ts, so they work as subexpressions).
    // String values get quoted; numeric values pass through bare.
    const activeFilter = dynTableFilterEnabled && dynTableFilter.field && dynTableFilter.op ? dynTableFilter : null;
    // Operators that don't need a value on the right-hand side.
    // `isEmpty` / `isNotEmpty` are unary — they only examine the
    // item field itself, so the snippet drops the value argument.
    const isUnaryOp = (op: string) => op === 'isEmpty' || op === 'isNotEmpty';
    const filterClause = (() => {
      if (!activeFilter) return null;
      if (isUnaryOp(activeFilter.op)) {
        return { open: `{{#if (${activeFilter.op} this.${activeFilter.field})}}`, close: '{{/if}}' };
      }
      const raw = activeFilter.value;
      const asNumber = Number(raw);
      const valExpr = raw !== '' && Number.isFinite(asNumber) && /^-?\d+(\.\d+)?$/.test(raw.trim())
        ? String(asNumber)
        : `"${raw.replace(/"/g, '\\"')}"`;
      return { open: `{{#if (${activeFilter.op} this.${activeFilter.field} ${valExpr})}}`, close: '{{/if}}' };
    })();

    const eachBody = filterClause
      ? `{{#each ${selectedArrayField.key}}}${filterClause.open}<tr>${bodyCells}</tr>${filterClause.close}{{/each}}`
      : `{{#each ${selectedArrayField.key}}}<tr>${bodyCells}</tr>{{/each}}`;

    // Optional total row. Sums the chosen *column* (by DynColumn.id)
    // across the array (filter-aware via sumFieldWhere). Only
    // field-kind columns whose itemField is numeric are eligible —
    // the picker already enforces this, but we re-check here.
    let totalRow = '';
    const totalCol = dynTableColumns.find(c => c.id === dynTableTotalColumnId && c.kind === 'field' && !!c.fieldKey);
    const totalItemField = totalCol ? itemFields.find(f => f.key === totalCol.fieldKey) : undefined;
    if (dynTableTotalEnabled && totalCol && totalItemField && (totalItemField.type === 'currency' || totalItemField.type === 'scalar')) {
      const sumExpr = activeFilter
        ? (() => {
            if (isUnaryOp(activeFilter.op)) {
              return `(sumFieldWhere ${selectedArrayField.key} "${totalCol.fieldKey}" "${activeFilter.field}" "${activeFilter.op}" "")`;
            }
            const raw = activeFilter.value;
            const asNumber = Number(raw);
            const valExpr = raw !== '' && Number.isFinite(asNumber) && /^-?\d+(\.\d+)?$/.test(raw.trim())
              ? String(asNumber)
              : `"${raw.replace(/"/g, '\\"')}"`;
            return `(sumFieldWhere ${selectedArrayField.key} "${totalCol.fieldKey}" "${activeFilter.field}" "${activeFilter.op}" ${valExpr})`;
          })()
        : `(sumField ${selectedArrayField.key} "${totalCol.fieldKey}")`;
      const totalInner = totalItemField.type === 'currency' ? `{{formatCurrency ${sumExpr}}}` : `{{formatNumber ${sumExpr}}}`;
      const cells = dynTableColumns.map((col, i) => {
        if (col.id === dynTableTotalColumnId) return `<td style="${totalCellStyle};text-align:right">${totalInner}</td>`;
        const isFirstNonTotal = i === dynTableColumns.findIndex(c => c.id !== dynTableTotalColumnId);
        return `<td style="${totalCellStyle}">${isFirstNonTotal ? escapeHtml(dynTableTotalLabel || 'Total') : ''}</td>`;
      }).join('');
      totalRow = `<tr>${cells}</tr>`;
    }

    const tableHtml = `<table style="border-collapse:collapse;width:100%;margin:8px 0">`
      + headerHtml
      + `<tbody>${eachBody}${totalRow}</tbody>`
      + `</table><p></p>`;

    restoreSelection();
    insertRawHtml(tableHtml);
    savedRangeRef.current = null;
    // Reset modal state for next time.
    setDynTableOpen(false);
    setDynTableSource('');
    setDynTableColumns([]);
    setDynTableIncludeHeader(true);
    setDynTableFilter({ field: '', op: 'gt', value: '' });
    setDynTableFilterEnabled(false);
    setDynTableTotalEnabled(false);
    setDynTableTotalColumnId('');
    setDynTableTotalLabel('Total');
  }

  function acceptSuggestion(snippet: string) {
    // Put the caret back where it was when the admin opened the
    // modal, THEN insert. Without this, execCommand('insertHTML')
    // defaults to the document start because contentEditable has
    // no active selection while the modal is showing.
    restoreSelection();
    insertRawHtml(snippet);
    savedRangeRef.current = null;
    setSuggestOpen(false);
    setSuggestDescription('');
    setSuggestResult(null);
    setSuggestError(null);
  }

  /** XML/HTML-safe escape for user-supplied label text that's being
   *  injected into raw HTML strings (e.g. table header cells). */
  function escapeHtml(s: string): string {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Paste handler — strips Word / pasted HTML to plain text ──────────────
  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    // Preserve double-newlines as paragraph breaks, single newlines
    // as soft breaks — matches how most letter drafts are structured.
    const paragraphs = text.split(/\n{2,}/).map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
    insertRawHtml(paragraphs);
  }

  // ── API calls ────────────────────────────────────────────────────────────
  const runPreview = useCallback(async (forceContent?: string) => {
    setPreviewing(true);
    try {
      // Save before previewing so the server sees the latest body.
      await save(forceContent);
      const res = await fetch('/api/methodology-admin/template-documents/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: template.id, engagementId: engagementId || null }),
      });
      const data = await res.json();
      if (res.ok) {
        setPreview({ html: data.html, missing: data.missingPlaceholders || [], error: data.error, usedLive: data.usedLiveContext });
      } else {
        setPreview({ html: '', missing: [], error: data.error || 'Preview failed', usedLive: false });
      }
    } finally {
      setPreviewing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id, engagementId]);

  async function save(overrideContent?: string) {
    setSaving(true);
    try {
      const content = overrideContent ?? readBody();
      const res = await fetch(`/api/methodology-admin/template-documents/${template.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), description: description.trim() || null,
          category, auditType, skeletonId,
          kind: 'document',
          content,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        onSaved(updated);
      }
    } finally {
      setSaving(false);
    }
  }

  async function generate() {
    setGenerating(true);
    setGenerateInfo(null);
    try {
      await save();
      // When engagementId is set, hit the per-engagement render route so
      // the Word doc reflects real data (and a download event is logged
      // against that engagement). Otherwise fall back to the admin-only
      // generate endpoint that renders against the firm's sample context
      // — same context the Preview pane uses — so admins can iterate on a
      // template without needing to pick a real engagement.
      const url = engagementId
        ? `/api/engagements/${engagementId}/render-template`
        : `/api/methodology-admin/template-documents/generate`;
      const payload: Record<string, string> = { templateId: template.id };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Render failed: ${err.error || res.statusText}`);
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const matched = cd.match(/filename="([^"]+)"/);
      const fileName = matched?.[1] || `${template.name || 'document'}.docx`;
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = dlUrl; a.download = fileName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(dlUrl);

      // Parse the diagnostics the server attached and surface them to the
      // admin in an info banner. This is the key to debugging "the Word
      // doc came out blank" — usually it means a referenced field is
      // empty in the live data, and we now say exactly which one.
      try {
        const rawHeader = res.headers.get('X-Template-Diagnostics');
        if (rawHeader) {
          const parsed = JSON.parse(decodeURIComponent(rawHeader));
          setGenerateInfo({
            usedLiveContext: Boolean(parsed.usedLiveContext),
            resolvedClientName: String(parsed.resolvedClientName || 'Sample'),
            resolvedPeriodEnd: parsed.resolvedPeriodEnd || null,
            emptyPlaceholders: Array.isArray(parsed.emptyPlaceholders) ? parsed.emptyPlaceholders : [],
            missingPlaceholders: Array.isArray(parsed.missingPlaceholders) ? parsed.missingPlaceholders : [],
          });
        }
      } catch { /* diagnostics optional */ }
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Metadata bar ───────────────────────────────────────────────── */}
      <div className="border-b border-slate-200 px-4 py-3 flex flex-wrap items-center gap-3 bg-white">
        <button onClick={onClose} className="text-xs text-blue-600 hover:text-blue-800">← Back</button>
        <input type="text" value={name} onChange={e => setName(e.target.value)} className="text-sm font-semibold border border-slate-200 rounded px-2 py-1 min-w-[240px]" />
        <select value={category} onChange={e => setCategory(e.target.value)} className="text-[11px] border border-slate-200 rounded px-2 py-1">{categoryOptions.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
        <select value={auditType} onChange={e => setAuditType(e.target.value)} className="text-[11px] border border-slate-200 rounded px-2 py-1">{AUDIT_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}</select>
        <select value={skeletonId || ''} onChange={e => setSkeletonId(e.target.value || null)} className="text-[11px] border border-slate-200 rounded px-2 py-1" title="Firm skeleton to render into">
          <option value="">— Use firm default skeleton —</option>
          {skeletons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="flex-1" />
        <span className="text-[10px] text-slate-400">v{template.version}</span>
        <button onClick={() => save()} disabled={saving} className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 bg-slate-100 border border-slate-200 rounded hover:bg-slate-200">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
        </button>
        <button onClick={() => runPreview()} disabled={previewing} className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 bg-blue-50 border border-blue-200 text-blue-700 rounded hover:bg-blue-100">
          {previewing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />} Preview
        </button>
        {/* Client + Period — two cascading dropdowns so the admin picks
            which engagement's real data to render against. No hidden
            'Acme sample' default — the admin always knows what they're
            previewing. When the firm has no engagements the dropdowns
            show an empty-state hint and Generate Word is disabled. */}
        <select
          value={selectedClientId}
          onChange={e => { setSelectedClientId(e.target.value); setSelectedEngagementId(''); }}
          className="text-[11px] border border-slate-200 rounded px-2 py-1 max-w-[200px]"
          title="Client to Generate Word for"
          disabled={clientOptions.length === 0}
        >
          <option value="">{clientOptions.length === 0 ? '— No engagements yet —' : '— Pick a client —'}</option>
          {clientOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select
          value={selectedEngagementId}
          onChange={e => setSelectedEngagementId(e.target.value)}
          className="text-[11px] border border-slate-200 rounded px-2 py-1 max-w-[260px] disabled:opacity-60"
          title="Period × audit type to Generate Word for"
          disabled={!selectedClientId || periodOptions.length === 0}
        >
          <option value="">{!selectedClientId ? '— Pick client first —' : (periodOptions.length === 0 ? '— No engagements on this client —' : '— Pick a period —')}</option>
          {periodOptions.map(p => <option key={p.engagementId} value={p.engagementId}>{p.label}</option>)}
        </select>
        <button
          onClick={generate}
          disabled={generating || !engagementId}
          className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 bg-indigo-600 text-white rounded disabled:opacity-50"
          title={!engagementId ? 'Pick a client and period first' : 'Generate a .docx against the selected engagement'}
        >
          {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Generate Word
        </button>
      </div>

      {/* ── Description ────────────────────────────────────────────────── */}
      <div className="border-b border-slate-200 px-4 py-2 bg-white">
        <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (what this template is used for)…" className="w-full text-[11px] border border-slate-200 rounded px-2 py-1" />
      </div>

      {/* ── Generate diagnostics banner ────────────────────────────────
          Shown immediately after Generate Word completes. Tells the admin
          which context was used, which client / period resolved, and which
          placeholders came back blank — so "why is this field empty in my
          Word doc?" turns into a one-line answer (e.g. missing client
          address on the Client admin page). */}
      {generateInfo && (
        <div className={`border-b px-4 py-2 text-[11px] ${generateInfo.usedLiveContext ? 'border-blue-200 bg-blue-50 text-blue-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="font-semibold">
                Generated {generateInfo.usedLiveContext ? 'with live engagement data' : 'with canned sample (Acme)'}
                {' '}— {generateInfo.resolvedClientName}
                {generateInfo.resolvedPeriodEnd ? ` · period end ${generateInfo.resolvedPeriodEnd}` : ''}
              </div>
              {!generateInfo.usedLiveContext && (
                <div className="text-[10px] mt-0.5 opacity-85">
                  Pick a real engagement from the dropdown above to generate against live client data instead of fabricated Acme values.
                </div>
              )}
              {generateInfo.emptyPlaceholders.length > 0 && (
                <div className="mt-1">
                  <strong>{generateInfo.emptyPlaceholders.length} placeholder{generateInfo.emptyPlaceholders.length === 1 ? '' : 's'} came back empty:</strong>{' '}
                  <span className="font-mono text-[10px]">{generateInfo.emptyPlaceholders.join(', ')}</span>
                  <div className="text-[10px] mt-0.5 opacity-80">
                    These paths exist in the context but the referenced data hasn&rsquo;t been entered yet (or is null). Fill in the source form to populate them.
                  </div>
                </div>
              )}
              {generateInfo.missingPlaceholders.length > 0 && (
                <div className="mt-1">
                  <strong className="text-red-700">{generateInfo.missingPlaceholders.length} unknown placeholder{generateInfo.missingPlaceholders.length === 1 ? '' : 's'} (typo?):</strong>{' '}
                  <span className="font-mono text-[10px]">{generateInfo.missingPlaceholders.join(', ')}</span>
                </div>
              )}
              {generateInfo.emptyPlaceholders.length === 0 && generateInfo.missingPlaceholders.length === 0 && (
                <div className="text-[10px] opacity-80 mt-0.5">All referenced placeholders resolved to a value.</div>
              )}
            </div>
            <button onClick={() => setGenerateInfo(null)} className="text-slate-400 hover:text-slate-700" title="Dismiss">✕</button>
          </div>
        </div>
      )}

      {/* ── Formatting toolbar ─────────────────────────────────────────── */}
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {/* Block style dropdown */}
        <label className="flex items-center gap-1">
          <span className="text-slate-500 text-[10px] uppercase">Style</span>
          <select
            onChange={e => { exec('formatBlock', e.target.value); e.target.value = ''; }}
            className="border border-slate-200 rounded px-1 py-0.5 text-[11px] bg-white"
            defaultValue=""
          >
            <option value="" disabled>Paragraph style…</option>
            {BLOCK_STYLES.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
        </label>

        <ToolbarDiv />

        <ToolbarBtn title="Bold" onClick={() => exec('bold')}><Bold className="h-3.5 w-3.5" /></ToolbarBtn>
        <ToolbarBtn title="Italic" onClick={() => exec('italic')}><Italic className="h-3.5 w-3.5" /></ToolbarBtn>
        <ToolbarBtn title="Underline" onClick={() => exec('underline')}><Underline className="h-3.5 w-3.5" /></ToolbarBtn>
        <ToolbarBtn title="Strikethrough" onClick={() => exec('strikeThrough')}><Strikethrough className="h-3.5 w-3.5" /></ToolbarBtn>

        {/* Text colour — native colour picker wrapped as a tiny button.
            Works against the current selection via execCommand('foreColor').
            Writing raw hex means the HTML→DOCX converter can pick it up
            as a w:color run property. Changing the input fires onChange
            with the new value. */}
        <label
          title="Text colour"
          className="relative inline-flex items-center justify-center w-6 h-6 rounded border border-slate-200 hover:bg-slate-100 cursor-pointer"
        >
          <span className="text-[10px] font-bold text-slate-700">A</span>
          <span className="absolute bottom-0.5 left-1 right-1 h-1 rounded-sm" style={{ background: '#1e3a5f' }} />
          <input
            type="color"
            className="absolute inset-0 opacity-0 cursor-pointer"
            onChange={e => exec('foreColor', e.target.value)}
            onMouseDown={captureSelection}
            aria-label="Text colour"
          />
        </label>

        {/* Highlight / background colour for the current selection.
            Mapped to the `hiliteColor` execCommand in modern browsers
            with `backColor` as a fallback for older ones. Renders as
            a <w:shd> on the run during the DOCX conversion. */}
        <label
          title="Highlight colour"
          className="relative inline-flex items-center justify-center w-6 h-6 rounded border border-slate-200 hover:bg-slate-100 cursor-pointer"
        >
          <span className="text-[10px] font-bold text-slate-700" style={{ background: '#fef08a', padding: '0 2px' }}>A</span>
          <input
            type="color"
            className="absolute inset-0 opacity-0 cursor-pointer"
            onChange={e => {
              // hiliteColor is the standards-leaning name; older
              // browsers recognise backColor. Try the modern one first.
              try { document.execCommand('hiliteColor', false, e.target.value); }
              catch { document.execCommand('backColor', false, e.target.value); }
              setDirtyTick(t => t + 1);
            }}
            onMouseDown={captureSelection}
            aria-label="Highlight colour"
          />
        </label>

        {/* Table cell shading — applies a background colour to the
            <td>/<th> the caret is currently inside. Looks for the
            nearest cell via findAncestor; no-op if the selection isn't
            in a table (so the button is safe to click anywhere). */}
        <label
          title="Shade the current table cell"
          className="relative inline-flex items-center justify-center w-6 h-6 rounded border border-slate-200 hover:bg-slate-100 cursor-pointer"
        >
          <span className="text-[10px] text-slate-700">▥</span>
          <input
            type="color"
            className="absolute inset-0 opacity-0 cursor-pointer"
            onChange={e => {
              const cell = (findAncestor('TD') || findAncestor('TH')) as HTMLElement | null;
              if (cell) {
                cell.style.backgroundColor = e.target.value;
                setDirtyTick(t => t + 1);
              }
            }}
            onMouseDown={captureSelection}
            aria-label="Table cell shading"
          />
        </label>

        <ToolbarDiv />

        <ToolbarBtn title="Bulleted list" onClick={() => exec('insertUnorderedList')}><List className="h-3.5 w-3.5" /></ToolbarBtn>
        <ToolbarBtn title="Numbered list" onClick={() => exec('insertOrderedList')}><ListOrdered className="h-3.5 w-3.5" /></ToolbarBtn>

        <ToolbarDiv />

        <ToolbarBtn title="Align left" onClick={() => exec('justifyLeft')}><AlignLeft className="h-3.5 w-3.5" /></ToolbarBtn>
        <ToolbarBtn title="Align centre" onClick={() => exec('justifyCenter')}><AlignCenter className="h-3.5 w-3.5" /></ToolbarBtn>
        <ToolbarBtn title="Align right" onClick={() => exec('justifyRight')}><AlignRight className="h-3.5 w-3.5" /></ToolbarBtn>
        <ToolbarBtn title="Justify" onClick={() => exec('justifyFull')}><AlignJustify className="h-3.5 w-3.5" /></ToolbarBtn>

        <ToolbarDiv />

        <ToolbarBtn title="Insert table (3 × 3)" onClick={() => insertTable(3, 3)}><Table className="h-3.5 w-3.5" /></ToolbarBtn>
        <ToolbarBtn title="Add row above (cursor must be in a table)" onClick={() => addRow('above')}><ArrowUpToLine className="h-3.5 w-3.5" /></ToolbarBtn>
        <ToolbarBtn title="Add row below (cursor must be in a table)" onClick={() => addRow('below')}><ArrowDownToLine className="h-3.5 w-3.5" /></ToolbarBtn>
        <ToolbarBtn title="Add column left (cursor must be in a table cell)" onClick={() => addColumn('left')}><ArrowLeftToLine className="h-3.5 w-3.5" /></ToolbarBtn>
        <ToolbarBtn title="Add column right (cursor must be in a table cell)" onClick={() => addColumn('right')}><ArrowRightToLine className="h-3.5 w-3.5" /></ToolbarBtn>
        <ToolbarBtn title="Delete current row" onClick={deleteRow}><Trash2 className="h-3.5 w-3.5 text-red-500" /></ToolbarBtn>
        <ToolbarBtn title="Merge cell with cell to the right" onClick={mergeRight}><Merge className="h-3.5 w-3.5" style={{ transform: 'rotate(90deg)' }} /></ToolbarBtn>
        <ToolbarBtn title="Merge cell with cell below" onClick={mergeDown}><Merge className="h-3.5 w-3.5" /></ToolbarBtn>
        <ToolbarBtn title="Split merged cell back into single slots" onClick={splitCell}><Split className="h-3.5 w-3.5" /></ToolbarBtn>
        <ToolbarBtn title="Insert horizontal rule" onClick={insertHorizontalRule}><Minus className="h-3.5 w-3.5" /></ToolbarBtn>
        <ToolbarBtn title="Insert page break" onClick={insertPageBreak}><FileDown className="h-3.5 w-3.5" /></ToolbarBtn>

        <ToolbarDiv />

        <button onClick={insertConditional} title="Insert {{#if}} / else block" className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] bg-amber-50 border border-amber-200 text-amber-700 rounded hover:bg-amber-100">
          <SquareDashedBottom className="h-3 w-3" /> if/else
        </button>
        <button onClick={insertLoop} title="Insert {{#each}} loop" className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] bg-amber-50 border border-amber-200 text-amber-700 rounded hover:bg-amber-100">
          <Repeat className="h-3 w-3" /> each
        </button>
        <button onClick={insertErrorTable} title="Insert error-schedule table helper" className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] bg-slate-100 border border-slate-200 text-slate-700 rounded hover:bg-slate-200">
          <Variable className="h-3 w-3" /> error table
        </button>
        <button
          onMouseDown={e => { e.preventDefault(); captureSelection(); }}
          onClick={() => { setDynTableOpen(true); setDynTableSource(''); setDynTableColumns([]); setDynTableIncludeHeader(true); }}
          title="Insert a table whose rows loop over a questionnaire or other array source"
          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] bg-teal-50 border border-teal-200 text-teal-700 rounded hover:bg-teal-100"
        >
          <Table className="h-3 w-3" /> dynamic table
        </button>
        <button
          // Capture the caret selection on mousedown — the contentEditable
          // loses focus the moment the modal opens, so without this the
          // eventual insert would happen at the document start.
          onMouseDown={e => { e.preventDefault(); captureSelection(); }}
          onClick={() => openInsertHtmlModal()}
          title="Insert raw HTML / Handlebars, OR put the caret inside an existing block (table, list, heading, …) and click again to edit it"
          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] bg-slate-100 border border-slate-200 text-slate-700 rounded hover:bg-slate-200"
        >
          <Code className="h-3 w-3" /> insert HTML
        </button>
        <button
          // Toggle between WYSIWYG and raw-HTML editing. When turning
          // source mode ON we capture the editor's current innerHTML
          // into the textarea draft; when turning it OFF we write the
          // (possibly edited) draft back into the contentEditable so
          // the save path picks it up. Both directions run the draft
          // through the same sanitiser the server uses so tokens that
          // were split across tags get recombined automatically.
          onClick={() => {
            if (sourceMode) {
              // Leaving source mode — write draft back into the editor.
              if (editorRef.current) {
                editorRef.current.innerHTML = sanitiseHandlebarsInEditorHtml(sourceDraft);
              }
              setSourceMode(false);
              setDirtyTick(t => t + 1);
            } else {
              // Entering source mode — snapshot current innerHTML.
              const current = editorRef.current?.innerHTML ?? '';
              setSourceDraft(current);
              setSourceMode(true);
            }
          }}
          title={sourceMode ? 'Switch back to visual editor' : 'Edit the raw HTML source of this template'}
          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border ${
            sourceMode
              ? 'bg-amber-100 border-amber-300 text-amber-800 hover:bg-amber-200'
              : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
          }`}
        >
          <Code className="h-3 w-3" /> {sourceMode ? 'exit source' : 'source'}
        </button>

        <ToolbarDiv />

        <button
          // onMouseDown fires BEFORE the editor loses focus to the
          // button, which is the last moment we can grab a usable
          // selection range. Using onClick would be too late —
          // contentEditable has already dropped the selection by
          // then and the eventual insert would land at the start of
          // the document.
          onMouseDown={e => { e.preventDefault(); captureSelection(); }}
          onClick={() => { setSuggestOpen(true); setSuggestError(null); setSuggestResult(null); }}
          title="Describe a placeholder in plain English and let AI find the right merge field"
          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] bg-gradient-to-r from-fuchsia-50 to-indigo-50 border border-fuchsia-200 text-fuchsia-700 rounded hover:from-fuchsia-100 hover:to-indigo-100"
        >
          <Sparkles className="h-3 w-3" /> Ask AI for a placeholder
        </button>
      </div>

      {/* ── Dynamic-table modal ─────────────────────────────────────────── */}
      {dynTableOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
          onClick={() => setDynTableOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-xl max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b flex items-start justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><Table className="h-4 w-4 text-teal-600" /> Insert dynamic table</h4>
                <p className="text-[11px] text-slate-500 mt-0.5">Pick an array source (e.g. a questionnaire&rsquo;s Q&amp;A, the error schedule). The table grows to match the array&rsquo;s length at render time.</p>
              </div>
              <button onClick={() => setDynTableOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">Source (array)</label>
                <select
                  value={dynTableSource}
                  onChange={e => { setDynTableSource(e.target.value); setDynTableColumns([]); }}
                  className="w-full border border-slate-200 rounded px-2 py-1.5 text-[12px]"
                >
                  <option value="">— pick an array —</option>
                  {arrayFields.map(f => (
                    <option key={f.key} value={f.key}>{f.label} &nbsp;—&nbsp; {f.key}</option>
                  ))}
                </select>
                {selectedArrayField?.description && (
                  <p className="text-[10px] text-slate-500 mt-1">{selectedArrayField.description}</p>
                )}
              </div>
              {selectedArrayField && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-semibold text-slate-600">Columns</label>
                    <button
                      type="button"
                      onClick={addDynColumn}
                      className="text-[10px] px-2 py-0.5 bg-teal-600 text-white rounded hover:bg-teal-700"
                    >+ Add column</button>
                  </div>
                  {dynTableColumns.length === 0 && (
                    <div className="text-[10px] text-slate-400 italic px-1 py-2 border border-dashed border-slate-200 rounded text-center">
                      No columns yet — click &ldquo;+ Add column&rdquo; to start. Each column gets its own header and content.
                    </div>
                  )}
                  {/* Quick-add: one click per itemField creates a
                      standard column pre-filled. Saves typing when
                      the admin just wants "all the obvious columns". */}
                  {dynTableColumns.length === 0 && (selectedArrayField.itemFields || []).length > 0 && (
                    <div className="mt-2">
                      <div className="text-[9px] text-slate-400 mb-1">Or quick-pick a field to add:</div>
                      <div className="flex flex-wrap gap-1">
                        {(selectedArrayField.itemFields || []).map(itf => (
                          <button
                            key={itf.key}
                            type="button"
                            onClick={() => setDynTableColumns(cols => [...cols, { ...newDynColumn(itf.key) }])}
                            className="text-[10px] px-1.5 py-0.5 bg-teal-50 border border-teal-200 text-teal-700 rounded hover:bg-teal-100"
                            title={itf.label}
                          >+ {itf.label}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="space-y-1.5 mt-1">
                    {dynTableColumns.map((col, idx) => {
                      const itf = col.kind === 'field' ? (selectedArrayField.itemFields || []).find(f => f.key === col.fieldKey) : undefined;
                      return (
                        <div key={col.id} className="border border-slate-200 rounded p-2 bg-slate-50/50">
                          <div className="flex items-center gap-1 mb-1">
                            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-teal-600 text-white text-[9px] font-bold flex-shrink-0">{idx + 1}</span>
                            <input
                              type="text"
                              value={col.header}
                              onChange={e => updateDynColumn(col.id, { header: e.target.value })}
                              placeholder={dynTableIncludeHeader ? (itf?.label || 'Header (optional)') : 'Header (hidden)'}
                              disabled={!dynTableIncludeHeader}
                              className="flex-1 text-[11px] border border-slate-200 rounded px-1.5 py-1 disabled:bg-slate-100 disabled:text-slate-400"
                            />
                            <button type="button" onClick={() => moveDynColumn(col.id, -1)} disabled={idx === 0} className="px-1 text-slate-500 hover:text-slate-800 disabled:opacity-30" title="Move left">↑</button>
                            <button type="button" onClick={() => moveDynColumn(col.id, 1)} disabled={idx === dynTableColumns.length - 1} className="px-1 text-slate-500 hover:text-slate-800 disabled:opacity-30" title="Move right">↓</button>
                            <button type="button" onClick={() => removeDynColumn(col.id)} className="px-1 text-red-500 hover:text-red-700" title="Remove column">×</button>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-slate-500 w-14 flex-shrink-0">Content:</span>
                            {col.kind === 'field' ? (
                              <select
                                value={col.fieldKey}
                                onChange={e => {
                                  const v = e.target.value;
                                  if (v === '__custom__') updateDynColumn(col.id, { kind: 'custom', customExpr: col.fieldKey ? `{{${col.fieldKey}}}` : '' });
                                  else updateDynColumn(col.id, { fieldKey: v });
                                }}
                                className="flex-1 text-[11px] border border-slate-200 rounded px-1.5 py-1"
                              >
                                <option value="">— pick field —</option>
                                {(selectedArrayField.itemFields || []).map(f => (
                                  <option key={f.key} value={f.key}>{f.label} &nbsp;({f.type})</option>
                                ))}
                                <option value="__custom__">Custom Handlebars expression…</option>
                              </select>
                            ) : (
                              <>
                                <input
                                  type="text"
                                  value={col.customExpr}
                                  onChange={e => updateDynColumn(col.id, { customExpr: e.target.value })}
                                  placeholder='{{formatDate this.answer "dd MMMM yyyy"}}'
                                  className="flex-1 text-[11px] border border-slate-200 rounded px-1.5 py-1 font-mono"
                                />
                                <button
                                  type="button"
                                  onClick={() => updateDynColumn(col.id, { kind: 'field', customExpr: '' })}
                                  className="text-[10px] px-2 py-0.5 bg-slate-200 text-slate-700 rounded hover:bg-slate-300"
                                  title="Switch back to a field picker"
                                >field</button>
                              </>
                            )}
                          </div>
                          {col.kind === 'custom' && (
                            <div className="mt-1 text-[9px] text-slate-500 ml-14">
                              Inside the loop: <code className="font-mono">this.answer</code>, <code className="font-mono">this.previousAnswer</code>, etc. &nbsp;·&nbsp;
                              Parent questionnaire: <code className="font-mono">../some_key</code> &nbsp;·&nbsp;
                              Helpers: <code className="font-mono">formatDate</code>, <code className="font-mono">formatCurrency</code>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <label className="flex items-center gap-2 text-[11px] mt-2 cursor-pointer">
                    <input type="checkbox" checked={dynTableIncludeHeader} onChange={e => setDynTableIncludeHeader(e.target.checked)} />
                    Include header row
                  </label>
                </div>
              )}

              {/* Filter — only shown once columns are chosen so the
                  field picker has itemFields to offer. */}
              {selectedArrayField && dynTableColumns.length > 0 && (
                <div>
                  <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 mb-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dynTableFilterEnabled}
                      onChange={e => setDynTableFilterEnabled(e.target.checked)}
                    />
                    Only include rows where&hellip;
                  </label>
                  {dynTableFilterEnabled && (() => {
                    // Unary ops (isEmpty/isNotEmpty) don't compare
                    // against a value — e.g. "only include rows
                    // where `previousAnswer` is not empty" picks up
                    // the Y/N follow-up explanation pattern.
                    const filterIsUnary = dynTableFilter.op === 'isEmpty' || dynTableFilter.op === 'isNotEmpty';
                    return (
                      <div className={`grid ${filterIsUnary ? 'grid-cols-[1fr_140px]' : 'grid-cols-[1fr_100px_1fr]'} gap-1 ml-6`}>
                        <select
                          value={dynTableFilter.field}
                          onChange={e => setDynTableFilter(f => ({ ...f, field: e.target.value }))}
                          className="text-[11px] border border-slate-200 rounded px-1.5 py-1"
                        >
                          <option value="">— field —</option>
                          {(selectedArrayField.itemFields || []).map(itf => (
                            <option key={itf.key} value={itf.key}>{itf.label} ({itf.type})</option>
                          ))}
                        </select>
                        <select
                          value={dynTableFilter.op}
                          onChange={e => setDynTableFilter(f => ({ ...f, op: e.target.value }))}
                          className="text-[11px] border border-slate-200 rounded px-1.5 py-1"
                        >
                          <option value="eq">equals</option>
                          <option value="ne">does not equal</option>
                          <option value="gt">greater than</option>
                          <option value="lt">less than</option>
                          <option value="gte">≥</option>
                          <option value="lte">≤</option>
                          <option value="contains">contains</option>
                          <option value="isEmpty">is empty</option>
                          <option value="isNotEmpty">is not empty</option>
                        </select>
                        {!filterIsUnary && (
                          <input
                            type="text"
                            value={dynTableFilter.value}
                            onChange={e => setDynTableFilter(f => ({ ...f, value: e.target.value }))}
                            placeholder="value"
                            className="text-[11px] border border-slate-200 rounded px-1.5 py-1"
                          />
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Total row — restricted to currency / numeric columns. */}
              {selectedArrayField && dynTableColumns.length > 0 && (
                <div>
                  <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 mb-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dynTableTotalEnabled}
                      onChange={e => { setDynTableTotalEnabled(e.target.checked); if (!e.target.checked) setDynTableTotalColumnId(''); }}
                    />
                    Append a total row
                  </label>
                  {dynTableTotalEnabled && (
                    <div className="grid grid-cols-[1fr_1fr] gap-1 ml-6">
                      <div>
                        <span className="text-[10px] text-slate-500 block mb-0.5">Column to sum</span>
                        <select
                          value={dynTableTotalColumnId}
                          onChange={e => setDynTableTotalColumnId(e.target.value)}
                          className="w-full text-[11px] border border-slate-200 rounded px-1.5 py-1"
                        >
                          <option value="">— pick a column —</option>
                          {dynTableColumns
                            .map(col => {
                              if (col.kind !== 'field' || !col.fieldKey) return null;
                              const itf = selectedArrayField.itemFields?.find(f => f.key === col.fieldKey);
                              if (!itf || (itf.type !== 'currency' && itf.type !== 'scalar')) return null;
                              const header = col.header.trim() || itf.label;
                              return <option key={col.id} value={col.id}>{header}</option>;
                            })
                            .filter(Boolean)}
                        </select>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block mb-0.5">Total row label</span>
                        <input
                          type="text"
                          value={dynTableTotalLabel}
                          onChange={e => setDynTableTotalLabel(e.target.value)}
                          placeholder="Total"
                          className="w-full text-[11px] border border-slate-200 rounded px-1.5 py-1"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
              {selectedArrayField && dynTableColumns.length > 0 && (
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Preview structure</label>
                  <div className="border rounded bg-slate-50 p-2 overflow-x-auto">
                    <table className="w-full text-[10px] border-collapse">
                      {dynTableIncludeHeader && (
                        <thead><tr>
                          {dynTableColumns.map(col => {
                            const itf = col.kind === 'field' ? selectedArrayField.itemFields?.find(f => f.key === col.fieldKey) : undefined;
                            const header = col.header.trim() || (itf?.label || col.fieldKey || '');
                            return (
                              <th key={col.id} className="border border-slate-300 px-1.5 py-1 bg-slate-100 text-left">
                                {header || <em className="text-slate-400 font-normal">(blank)</em>}
                              </th>
                            );
                          })}
                        </tr></thead>
                      )}
                      <tbody>
                        <tr>
                          {dynTableColumns.map(col => {
                            // Mirror the acceptDynamicTable contentFor() so the admin
                            // sees roughly what will be inserted.
                            let preview = '';
                            if (col.kind === 'custom') {
                              preview = col.customExpr || '—';
                            } else if (col.fieldKey) {
                              const itf = selectedArrayField.itemFields?.find(f => f.key === col.fieldKey);
                              preview = itf?.type === 'currency' ? `{{formatCurrency ${col.fieldKey}}}`
                                : itf?.type === 'date' ? `{{formatDate ${col.fieldKey} "dd MMMM yyyy"}}`
                                : `{{${col.fieldKey}}}`;
                            } else {
                              preview = '—';
                            }
                            const trimmed = preview.length > 40 ? preview.slice(0, 37) + '…' : preview;
                            return (
                              <td key={col.id} className="border border-slate-300 px-1.5 py-1 font-mono text-teal-700" title={preview}>{trimmed}</td>
                            );
                          })}
                        </tr>
                        <tr>
                          <td colSpan={dynTableColumns.length} className="text-center text-[9px] text-slate-400 italic py-1">
                            … row repeats for every item in {selectedArrayField.key}
                            {dynTableFilterEnabled && dynTableFilter.field && dynTableFilter.op && (() => {
                              const unary = dynTableFilter.op === 'isEmpty' || dynTableFilter.op === 'isNotEmpty';
                              if (!unary && dynTableFilter.value === '') return null;
                              return (
                                <> — only when <code className="text-[9px] text-amber-700">
                                  {dynTableFilter.field} {dynTableFilter.op}{unary ? '' : ` ${JSON.stringify(dynTableFilter.value)}`}
                                </code></>
                              );
                            })()}
                          </td>
                        </tr>
                        {dynTableTotalEnabled && (() => {
                          const totalCol = dynTableColumns.find(c => c.id === dynTableTotalColumnId);
                          if (!totalCol || totalCol.kind !== 'field' || !totalCol.fieldKey) return null;
                          return (
                            <tr>
                              {dynTableColumns.map((col, i) => {
                                if (col.id === dynTableTotalColumnId) {
                                  return <td key={col.id} className="border border-slate-300 px-1.5 py-1 font-bold bg-slate-50 text-right font-mono text-teal-700">∑ {totalCol.fieldKey}</td>;
                                }
                                const isFirstNonTotal = i === dynTableColumns.findIndex(c => c.id !== dynTableTotalColumnId);
                                return <td key={col.id} className="border border-slate-300 px-1.5 py-1 font-bold bg-slate-50">{isFirstNonTotal ? (dynTableTotalLabel || 'Total') : ''}</td>;
                              })}
                            </tr>
                          );
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            <div className="px-4 py-2 border-t flex justify-end gap-2">
              <button onClick={() => setDynTableOpen(false)} className="text-[11px] px-3 py-1 text-slate-600 hover:text-slate-800">Cancel</button>
              <button
                onClick={acceptDynamicTable}
                disabled={!selectedArrayField
                  || dynTableColumns.length === 0
                  || dynTableColumns.some(c => (c.kind === 'field' && !c.fieldKey) || (c.kind === 'custom' && !c.customExpr.trim()))}
                title={
                  !selectedArrayField ? 'Pick an array source'
                  : dynTableColumns.length === 0 ? 'Add at least one column'
                  : dynTableColumns.some(c => c.kind === 'field' && !c.fieldKey) ? 'Every column needs a field or a custom expression'
                  : dynTableColumns.some(c => c.kind === 'custom' && !c.customExpr.trim()) ? 'Fill in the custom expression (or switch back to a field)'
                  : 'Insert table at cursor'
                }
                className="inline-flex items-center gap-1 text-[11px] px-3 py-1 bg-teal-600 text-white rounded disabled:opacity-50"
              ><Check className="h-3 w-3" /> Insert table at cursor</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Insert raw HTML / Handlebars modal ────────────────────────────
          Workaround for the onPaste handler that strips pasted HTML to
          plain text (so Word pastes stay clean). When the admin needs
          to paste a hand-written looping table, conditional, or any
          other structured snippet, they open this modal, paste, and
          click Insert — it goes through insertRawHtml which uses
          execCommand('insertHTML') so the editor interprets it as
          structure rather than content. Caret position is preserved
          via savedRangeRef (set when the toolbar button is
          mousedown'd). */}
      {htmlOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
          onClick={() => { setHtmlOpen(false); setHtmlReplaceTarget(null); }}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-2xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b flex items-start justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                  <Code className="h-4 w-4 text-slate-600" />
                  {htmlReplaceTarget?.kind === 'element' ? 'Edit ' + htmlReplaceTarget.el.tagName.toLowerCase() + ' block'
                    : htmlReplaceTarget?.kind === 'selection' ? 'Edit selected HTML'
                    : 'Insert HTML / Handlebars'}
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {htmlReplaceTarget
                    ? 'Tweak the markup below and hit Save — the existing block in the editor will be replaced. Or click Ask AI to rewrite it.'
                    : 'Paste any HTML or a Handlebars snippet (loops, conditionals, coloured tables, etc.). The normal paste strips HTML — this doesn’t. Or click Ask AI to generate one from a description.'}
                </p>
              </div>
              <button onClick={() => { setHtmlOpen(false); setHtmlReplaceTarget(null); }} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-4 pt-3 space-y-2">
              {/* Example uses HTML-comment-wrapped Handlebars for the
                  {{#each}}/{{/each}} that sit directly inside <tbody>.
                  HTML parsers foster-parent stray text out of table
                  structure, which would break the loop; comments are
                  allowed between <tbody>/<tr> so they survive parsing.
                  The renderer strips the comment wrappers before
                  compiling the Handlebars. */}
              <textarea
                value={htmlDraft}
                onChange={e => setHtmlDraft(e.target.value)}
                placeholder={`Example — Non Audit Services table:\n\n<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">\n  <thead>\n    <tr><th>Service Provided</th><th>Threats &amp; Safeguards</th></tr>\n  </thead>\n  <tbody>\n    <!--{{#each (filterWhere (filterBySection questionnaires.ethics.asList "Non Audit Services") "answer" "eq" "Y")}}-->\n    <tr><td>{{previousAnswer}}</td><td>{{nextAnswer}}</td></tr>\n    <!--{{/each}}-->\n  </tbody>\n</table>\n\nTip: when {{#each}} / {{/each}} / {{#if}} / {{/if}} sit directly\ninside a <table>, <tbody>, <thead>, <tr>, or <tfoot>, wrap them in\nHTML comments like <!--{{…}}--> so the browser doesn't move them\nout of the table. Inside <td>, <p>, <div>, <li> — no wrapper needed.`}
                className="w-full border border-slate-200 rounded px-3 py-2 text-[11px] font-mono min-h-[220px] focus:outline-none focus:border-slate-400"
                autoFocus
              />

              {/* AI build / refine — inline panel. Opens with the small
                  "Ask AI" button below; when open, the admin types a
                  description, AI returns a Handlebars+HTML snippet
                  that REPLACES the textarea content. If the textarea
                  already has a snippet, AI is asked to refine it
                  rather than start from scratch. */}
              {aiBuildOpen && (
                <div className="border border-fuchsia-200 bg-fuchsia-50/40 rounded p-3 space-y-2">
                  <div className="text-[11px] font-semibold text-fuchsia-800 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" />
                    {htmlDraft.trim() ? 'Refine the snippet above' : 'Generate a new snippet'}
                  </div>
                  <textarea
                    value={aiBuildPrompt}
                    onChange={e => setAiBuildPrompt(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !aiBuildLoading) { e.preventDefault(); void runAiBuild(); } }}
                    placeholder={htmlDraft.trim()
                      ? 'e.g. add a third column showing the section name; only show rows where col2 is "Yes"; restyle the header row in slate'
                      : 'e.g. table of every Non Audit Services question where the Y/N answer is "Y", showing the service name and the threats/safeguards in two columns'}
                    className="w-full border border-fuchsia-200 rounded px-2 py-1.5 text-[11px] min-h-[60px] focus:outline-none focus:border-fuchsia-400 bg-white"
                    autoFocus
                    disabled={aiBuildLoading}
                  />
                  {aiBuildError && (
                    <div className="text-[10px] text-red-700 flex items-start gap-1">
                      <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                      <span>{aiBuildError}</span>
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => { setAiBuildOpen(false); setAiBuildPrompt(''); setAiBuildError(null); }}
                      disabled={aiBuildLoading}
                      className="text-[10px] px-2 py-0.5 text-slate-600 hover:text-slate-800"
                    >Cancel</button>
                    <button
                      type="button"
                      onClick={() => void runAiBuild()}
                      disabled={aiBuildLoading || !aiBuildPrompt.trim()}
                      className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 bg-fuchsia-600 text-white rounded disabled:opacity-50"
                    >
                      {aiBuildLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      {htmlDraft.trim() ? 'Refine' : 'Generate'}
                      <span className="text-[9px] opacity-70 ml-1">⌘⏎</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t flex items-center gap-2">
              {/* Ask AI — left-aligned so it's clearly an alternative
                  way to populate the textarea, not a confirmation
                  action. */}
              {!aiBuildOpen && (
                <button
                  type="button"
                  onClick={() => { setAiBuildOpen(true); setAiBuildError(null); }}
                  className="inline-flex items-center gap-1 text-[11px] px-3 py-1 bg-fuchsia-50 border border-fuchsia-200 text-fuchsia-700 rounded hover:bg-fuchsia-100"
                  title="Describe the snippet you want — AI generates the Handlebars+HTML for you. If the textarea already has content, it will be refined."
                >
                  <Sparkles className="h-3 w-3" /> Ask AI
                </button>
              )}
              <div className="ml-auto flex gap-2">
                <button
                  onClick={() => { setHtmlOpen(false); setHtmlReplaceTarget(null); }}
                  className="text-[11px] px-3 py-1 text-slate-600 hover:text-slate-800"
                >Cancel</button>
                <button
                  onClick={commitInsertHtmlModal}
                  disabled={!htmlDraft.trim()}
                  className="inline-flex items-center gap-1 text-[11px] px-3 py-1 bg-slate-700 text-white rounded disabled:opacity-50 hover:bg-slate-800"
                >
                  <Check className="h-3 w-3" /> {htmlReplaceTarget ? 'Save' : 'Insert'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── AI placeholder-suggester modal ─────────────────────────────── */}
      {suggestOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
          onClick={() => { if (!suggestLoading) setSuggestOpen(false); }}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b flex items-start justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-fuchsia-500" /> Ask AI for a placeholder</h4>
                <p className="text-[11px] text-slate-500 mt-0.5">Describe what you want to appear in the template and AI will pick the matching merge field from the catalog.</p>
              </div>
              <button onClick={() => setSuggestOpen(false)} className="text-slate-400 hover:text-slate-600" disabled={suggestLoading}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-4 pt-3 space-y-2">
              <textarea
                value={suggestDescription}
                onChange={e => setSuggestDescription(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !suggestLoading) { e.preventDefault(); void runSuggest(); } }}
                placeholder="e.g. the date the engagement letter was signed; client's registered address formatted as a paragraph; bullet each error on the schedule with its amount"
                className="w-full border border-slate-200 rounded px-3 py-2 text-xs min-h-[70px] focus:outline-none focus:border-fuchsia-400"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setSuggestOpen(false)}
                  disabled={suggestLoading}
                  className="text-[11px] px-3 py-1 text-slate-600 hover:text-slate-800"
                >Cancel</button>
                <button
                  onClick={() => void runSuggest()}
                  disabled={suggestLoading || !suggestDescription.trim()}
                  className="inline-flex items-center gap-1 text-[11px] px-3 py-1 bg-fuchsia-600 text-white rounded disabled:opacity-50"
                >
                  {suggestLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Suggest
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {suggestError && (
                <div className="border border-red-200 bg-red-50 rounded p-3 text-[11px] text-red-700 flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold mb-0.5">No match</div>
                    <div>{suggestError}</div>
                    <div className="text-[10px] text-red-600 mt-1">Try rewording the description (e.g. name the schedule and the section), or type a Handlebars path manually — Preview will tell you if it resolves against a live engagement.</div>
                  </div>
                </div>
              )}
              {suggestResult && (
                <div className="space-y-3">
                  <div className="border border-fuchsia-200 bg-fuchsia-50/40 rounded p-3 text-[11px]">
                    <div className="flex items-center justify-between mb-1">
                      <div className="font-semibold text-fuchsia-800">{suggestResult.label}</div>
                      <div className="text-[10px] text-fuchsia-600">confidence {Math.round((suggestResult.confidence || 0) * 100)}%</div>
                    </div>
                    <div className="text-slate-700 mb-2">{suggestResult.rationale}</div>
                    <pre className="bg-white border border-fuchsia-100 rounded p-2 text-[11px] font-mono whitespace-pre-wrap text-fuchsia-900">{suggestResult.snippet}</pre>
                    <button
                      onClick={() => acceptSuggestion(suggestResult.snippet)}
                      className="mt-2 inline-flex items-center gap-1 text-[11px] px-3 py-1 bg-fuchsia-600 text-white rounded hover:bg-fuchsia-700"
                    ><Check className="h-3 w-3" /> Insert at cursor</button>
                  </div>
                  {Array.isArray(suggestResult.alternatives) && suggestResult.alternatives.length > 0 && (
                    <div className="border border-slate-200 rounded p-3 text-[11px] bg-slate-50/60">
                      <div className="font-semibold text-slate-600 mb-1">Other possibilities</div>
                      <div className="space-y-1.5">
                        {suggestResult.alternatives.map(alt => (
                          <div key={alt.path} className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-slate-700 font-medium truncate">{alt.label || alt.path}</div>
                              <pre className="bg-white border border-slate-200 rounded p-1.5 text-[10px] font-mono whitespace-pre-wrap text-slate-600 mt-0.5">{alt.snippet}</pre>
                            </div>
                            <button
                              onClick={() => acceptSuggestion(alt.snippet)}
                              className="text-[10px] px-2 py-0.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded flex-shrink-0"
                            >Insert</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!suggestResult && !suggestError && !suggestLoading && (
                <div className="text-[11px] text-slate-400 italic">Type a description above and hit Suggest (or Enter).</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Two-column work area ───────────────────────────────────────── */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200 min-h-0">
        {/* Left: editor + merge-field palette */}
        <div className="flex flex-col min-h-0">
          {/* Keep the contentEditable MOUNTED at all times (hidden via
              display:none in source mode) so its innerHTML and the
              captured selection range stay intact when toggling. Mount/
              unmount would drop the innerHTML on every toggle. */}
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onPaste={onPaste}
            onInput={() => setDirtyTick(t => t + 1)}
            onBlur={normaliseEditorInPlace}
            className="flex-1 min-h-[320px] overflow-auto outline-none px-6 py-4 bg-white prose prose-sm max-w-none focus:bg-slate-50/20"
            spellCheck={true}
            style={sourceMode ? { display: 'none' } : undefined}
          />
          {sourceMode && (
            <textarea
              value={sourceDraft}
              onChange={e => { setSourceDraft(e.target.value); setDirtyTick(t => t + 1); }}
              spellCheck={false}
              className="flex-1 min-h-[320px] overflow-auto outline-none px-6 py-4 bg-slate-50 font-mono text-[11px] text-slate-800 border-l-4 border-amber-400"
              placeholder="Raw HTML + Handlebars source. Changes here overwrite the visual editor when you click 'exit source'."
            />
          )}
          {/* Merge-field palette */}
          <div className="border-t border-slate-200 bg-slate-50/60 max-h-64 overflow-y-auto">
            <div className="px-4 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide sticky top-0 bg-slate-50/90 backdrop-blur border-b border-slate-200">Merge fields (click to insert)</div>
            {Object.entries(grouped).map(([group, fields]) => (
              <div key={group} className="px-4 py-2 border-b border-slate-100 last:border-0">
                <div className="text-[10px] font-bold text-slate-600 mb-1">{group}</div>
                <div className="flex flex-wrap gap-1">
                  {fields.map(f => <Pill key={f.key} field={f} onInsert={insertMergeField} />)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: preview */}
        <div className="flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 py-2 flex items-center justify-between border-b border-slate-200 bg-slate-50/60">
            <span className="text-[11px] font-semibold text-slate-600">Preview</span>
            {preview && <span className="text-[10px] text-slate-500">{preview.usedLive ? 'live engagement data' : 'sample data'}</span>}
          </div>
          <div className="flex-1 overflow-y-auto">
            {!preview && (
              <div className="p-6 text-[11px] text-slate-400 italic">Hit <em>Preview</em> to render this template against an engagement or sample data.</div>
            )}
            {preview?.error && (
              <div className="m-4 p-3 border border-red-200 bg-red-50 rounded text-[11px] text-red-700 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold mb-0.5">Render error</div>
                  <pre className="whitespace-pre-wrap font-mono">{preview.error}</pre>
                </div>
              </div>
            )}
            {preview && !preview.error && (
              <div className="p-6 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: preview.html }} />
            )}
            {preview && preview.missing.length > 0 && (
              <div className="m-4 border border-amber-200 bg-amber-50 rounded p-3 text-[11px]">
                <div className="font-semibold text-amber-800 mb-1">Placeholders not in catalog ({preview.missing.length})</div>
                <ul className="list-disc pl-4 text-amber-800 space-y-0.5">
                  {preview.missing.map(m => <li key={m}><code>{`{{${m}}}`}</code></li>)}
                </ul>
                <div className="text-[10px] text-amber-600 mt-1">These references won't break the render but will appear blank unless they match a real path on the engagement context.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolbarBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      // Stop the <button> stealing focus from the contentEditable
      // before execCommand runs. Without this preventDefault, the
      // editor's selection collapses when the button takes focus,
      // so insertUnorderedList / insertOrderedList / bold / italic
      // all silently no-op on the most recently-clicked button.
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-slate-200 text-slate-600"
    >{children}</button>
  );
}
function ToolbarDiv() { return <div className="w-px h-5 bg-slate-300 mx-0.5" />; }

function Pill({ field, onInsert }: { field: MergeField; onInsert: (f: MergeField) => void }) {
  const isArray = field.type === 'array';
  const isObject = field.type === 'object';
  return (
    <button
      type="button"
      onClick={() => onInsert(field)}
      title={`${field.label}${field.description ? ' — ' + field.description : ''}`}
      className={`text-[10px] px-1.5 py-0.5 rounded border ${
        isArray ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
        : isObject ? 'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100'
        : 'bg-teal-50 border-teal-200 text-teal-700 hover:bg-teal-100'
      }`}
    >{field.label}</button>
  );
}

function defaultBody(): string {
  // A small starter so a brand-new template immediately shows
  // something in the editor rather than a blank white box.
  return '<p>Dear {{client.name}},</p><p>This document relates to the audit for the year ended {{formatDate period.periodEnd "dd MMMM yyyy"}}.</p>';
}

/**
 * Client-side duplicate of `sanitiseHandlebarsInHtml` from
 * `lib/template-handlebars.ts`. Inlined (rather than imported) to
 * keep Handlebars itself out of the client bundle — the sanitiser
 * is pure string manipulation with no library dependency.
 *
 * Fixes two corruption modes the contentEditable editor introduces:
 *   (a) tokens split across `<span>` runs with inline styles,
 *   (b) nested `{{…}}` braces (e.g. clicking a pill inside an
 *       existing token).
 *
 * Keep this function in sync with its server twin — tests live in
 * the server module.
 */
const CLIENT_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'",
};
function decodeEntitiesInTokenClient(s: string): string {
  let out = s;
  for (const [ent, ch] of Object.entries(CLIENT_ENTITIES)) out = out.split(ent).join(ch);
  out = out.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
           .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
  return out;
}
function sanitiseHandlebarsInEditorHtml(html: string): string {
  if (typeof html !== 'string' || html.length === 0) return html;
  let out = '';
  let i = 0;
  const n = html.length;
  while (i < n) {
    if (html[i] === '{' && html[i + 1] === '{') {
      let cursor = i + 2;
      let cleanInner = '';
      let closed = false;
      let depth = 0;
      while (cursor < n) {
        if (html[cursor] === '}' && html[cursor + 1] === '}') {
          if (depth === 0) { cursor += 2; closed = true; break; }
          depth--; cursor += 2; continue;
        }
        if (html[cursor] === '{' && html[cursor + 1] === '{') {
          depth++; cursor += 2; continue;
        }
        if (html[cursor] === '<') {
          const end = html.indexOf('>', cursor);
          if (end < 0) break;
          cursor = end + 1;
        } else {
          cleanInner += html[cursor];
          cursor++;
        }
      }
      if (closed) {
        const collapsed = decodeEntitiesInTokenClient(cleanInner).replace(/\s+/g, ' ').trim();
        out += '{{' + collapsed + '}}';
        i = cursor;
        continue;
      }
    }
    out += html[i];
    i++;
  }
  return out;
}
