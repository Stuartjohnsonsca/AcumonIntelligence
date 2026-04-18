'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Save, Eye, Download, AlertTriangle,
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Table, FileDown, Minus,
  SquareDashedBottom, Repeat, Variable,
} from 'lucide-react';
import { mergeFieldsByGroup, type MergeField } from '@/lib/template-merge-fields';
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

interface EngagementOption { id: string; clientName: string; periodEnd: string | null }

const CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'engagement', label: 'Engagement' },
  { value: 'reporting', label: 'Reporting' },
  { value: 'correspondence', label: 'Correspondence' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'checklist', label: 'Checklist' },
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
  onSaved,
  onClose,
}: {
  template: DocumentTemplate;
  skeletons: Skeleton[];
  engagements: EngagementOption[];
  onSaved: (t: DocumentTemplate) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description || '');
  const [category, setCategory] = useState(template.category || 'general');
  const [auditType, setAuditType] = useState(template.auditType || 'ALL');
  const [skeletonId, setSkeletonId] = useState<string | null>(template.skeletonId);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<{ html: string; missing: string[]; error: string | null; usedLive: boolean } | null>(null);
  const [engagementId, setEngagementId] = useState<string>(engagements[0]?.id || '');
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
    const raw = editorRef.current?.innerHTML ?? '';
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

  // ── Paste handler — strips Word / pasted HTML to plain text ──────────────
  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    // Preserve double-newlines as paragraph breaks, single newlines
    // as soft breaks — matches how most letter drafts are structured.
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const paragraphs = text.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
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
    if (!engagementId) { alert('Pick an engagement to generate the Word document.'); return; }
    setGenerating(true);
    try {
      await save();
      const res = await fetch(`/api/engagements/${engagementId}/render-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: template.id }),
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
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
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
        <select value={category} onChange={e => setCategory(e.target.value)} className="text-[11px] border border-slate-200 rounded px-2 py-1">{CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
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
        <select value={engagementId} onChange={e => setEngagementId(e.target.value)} className="text-[11px] border border-slate-200 rounded px-2 py-1 max-w-[180px]" title="Engagement to preview/generate against">
          <option value="">— Sample data —</option>
          {engagements.map(e => <option key={e.id} value={e.id}>{e.clientName}{e.periodEnd ? ` · ${e.periodEnd}` : ''}</option>)}
        </select>
        <button onClick={generate} disabled={generating} className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 bg-indigo-600 text-white rounded disabled:opacity-50">
          {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Generate Word
        </button>
      </div>

      {/* ── Description ────────────────────────────────────────────────── */}
      <div className="border-b border-slate-200 px-4 py-2 bg-white">
        <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (what this template is used for)…" className="w-full text-[11px] border border-slate-200 rounded px-2 py-1" />
      </div>

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
      </div>

      {/* ── Two-column work area ───────────────────────────────────────── */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200 min-h-0">
        {/* Left: editor + merge-field palette */}
        <div className="flex flex-col min-h-0">
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onPaste={onPaste}
            onInput={() => setDirtyTick(t => t + 1)}
            onBlur={normaliseEditorInPlace}
            className="flex-1 min-h-[320px] overflow-auto outline-none px-6 py-4 bg-white prose prose-sm max-w-none focus:bg-slate-50/20"
            spellCheck={true}
          />
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
      type="button" title={title} onClick={onClick}
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
