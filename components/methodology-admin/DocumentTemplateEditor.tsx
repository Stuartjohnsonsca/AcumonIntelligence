'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Save, Eye, Download, AlertTriangle, Variable, SquareDashedBottom, Repeat } from 'lucide-react';
import { MERGE_FIELDS, mergeFieldsByGroup, type MergeField } from '@/lib/template-merge-fields';
import type { Skeleton } from './FirmSkeletonManager';

/**
 * Editor for a single document template.
 *
 * Layout:
 *   ┌──────────────────────────────┬──────────────────────────┐
 *   │  Left — body editor          │  Right — preview         │
 *   │  [textarea with Handlebars]  │  [rendered HTML]         │
 *   │                              │  [missing placeholders]  │
 *   ├──────────────────────────────┤                          │
 *   │  Merge-field pill palette    │                          │
 *   │  (grouped; click to insert)  │                          │
 *   └──────────────────────────────┴──────────────────────────┘
 *
 * Body text uses Handlebars: `{{path}}`, `{{formatDate x 'dd MMM yyyy'}}`,
 * `{{#if cond}}...{{/if}}`, `{{#each arr}}...{{/each}}`. Triple-brace for
 * HTML-returning helpers like `{{{errorScheduleTable errorSchedule}}}`.
 *
 * Preview runs server-side against a live engagement (picker) or a
 * canned sample context. The "missing placeholders" list shows any
 * path in the body that isn't in the catalog — useful for catching
 * typos like `{{clinet.name}}`.
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
  const [content, setContent] = useState(template.content || '');
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<{ html: string; missing: string[]; error: string | null; usedLive: boolean } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [engagementId, setEngagementId] = useState<string>(engagements[0]?.id || '');

  const grouped = useMemo(() => mergeFieldsByGroup(), []);

  // Re-run preview when content / engagement / template changes —
  // debounced so typing doesn't spam the server.
  const runPreview = useCallback(async () => {
    // Persist content first so the server sees the latest body.
    setPreviewing(true);
    try {
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
  }, [template.id, engagementId]);

  async function save(nextContent?: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/methodology-admin/template-documents/${template.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          category,
          auditType,
          skeletonId,
          kind: 'document',
          content: nextContent ?? content,
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

  async function saveAndPreview() {
    await save();
    await runPreview();
  }

  async function generate() {
    if (!engagementId) { alert('Pick an engagement to generate the Word document.'); return; }
    setGenerating(true);
    try {
      // Persist latest edits first so the render sees them.
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
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setGenerating(false);
    }
  }

  function insertAtCursor(text: string) {
    const ta = document.getElementById('doc-template-body') as HTMLTextAreaElement | null;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = content.slice(0, start) + text + content.slice(end);
    setContent(next);
    // Move the cursor to just after the inserted text on the next tick.
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + text.length;
    });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top metadata bar */}
      <div className="border-b border-slate-200 px-4 py-3 flex flex-wrap items-center gap-3 bg-white">
        <button onClick={onClose} className="text-xs text-blue-600 hover:text-blue-800">← Back</button>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          className="text-sm font-semibold border border-slate-200 rounded px-2 py-1 min-w-[240px]"
        />
        <select value={category} onChange={e => setCategory(e.target.value)} className="text-[11px] border border-slate-200 rounded px-2 py-1">
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select value={auditType} onChange={e => setAuditType(e.target.value)} className="text-[11px] border border-slate-200 rounded px-2 py-1">
          {AUDIT_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
        <select
          value={skeletonId || ''}
          onChange={e => setSkeletonId(e.target.value || null)}
          className="text-[11px] border border-slate-200 rounded px-2 py-1"
          title="Firm skeleton to render into"
        >
          <option value="">— Use firm default skeleton —</option>
          {skeletons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="flex-1" />
        <span className="text-[10px] text-slate-400">v{template.version}</span>
        <button onClick={() => save()} disabled={saving} className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 bg-slate-100 border border-slate-200 rounded hover:bg-slate-200">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
        </button>
        <button onClick={saveAndPreview} disabled={previewing} className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 bg-blue-50 border border-blue-200 text-blue-700 rounded hover:bg-blue-100">
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

      {/* Two-column work area */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200 min-h-0">
        {/* Left: body editor + description + palette */}
        <div className="flex flex-col min-h-0">
          <div className="px-4 py-2">
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Description (what this template is used for)…"
              className="w-full text-[11px] border border-slate-200 rounded px-2 py-1"
            />
          </div>
          <div className="px-4 flex gap-1 pb-2 flex-wrap">
            <button
              onClick={() => insertAtCursor('{{#if condition}}\n\n{{else}}\n\n{{/if}}')}
              className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 rounded hover:bg-amber-100"
              title="Insert {{#if}} block"
            ><SquareDashedBottom className="h-3 w-3" /> if/else</button>
            <button
              onClick={() => insertAtCursor('{{#each errorSchedule}}\n  {{fsLine}} — {{formatCurrency amount}}: {{description}}\n{{/each}}')}
              className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 rounded hover:bg-amber-100"
              title="Insert {{#each}} loop"
            ><Repeat className="h-3 w-3" /> each</button>
            <button
              onClick={() => insertAtCursor('{{{errorScheduleTable errorSchedule}}}')}
              className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 bg-slate-50 border border-slate-200 text-slate-700 rounded hover:bg-slate-100"
              title="Insert error-schedule table helper"
            ><Variable className="h-3 w-3" /> error table</button>
          </div>
          <textarea
            id="doc-template-body"
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder={'<p>Dear {{client.name}},</p>\n<p>The audit for the year ended {{formatDate period.periodEnd "dd MMMM yyyy"}} is now complete.</p>\n{{#if errorSchedule.length}}\n  {{{errorScheduleTable errorSchedule}}}\n{{else}}\n  <p>No material adjustments identified.</p>\n{{/if}}'}
            className="flex-1 min-h-[300px] font-mono text-[12px] leading-[1.4] border-y border-slate-200 px-4 py-3 outline-none focus:bg-slate-50/30"
            spellCheck={false}
          />
          {/* Merge-field palette */}
          <div className="border-t border-slate-200 bg-slate-50/60 max-h-64 overflow-y-auto">
            <div className="px-4 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide sticky top-0 bg-slate-50/90 backdrop-blur border-b border-slate-200">Merge fields (click to insert)</div>
            {Object.entries(grouped).map(([group, fields]) => (
              <div key={group} className="px-4 py-2 border-b border-slate-100 last:border-0">
                <div className="text-[10px] font-bold text-slate-600 mb-1">{group}</div>
                <div className="flex flex-wrap gap-1">
                  {fields.map(f => (
                    <Pill key={f.key} field={f} onInsert={insertAtCursor} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: preview pane */}
        <div className="flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 py-2 flex items-center justify-between border-b border-slate-200 bg-slate-50/60">
            <span className="text-[11px] font-semibold text-slate-600">Preview</span>
            {preview && (
              <span className="text-[10px] text-slate-500">{preview.usedLive ? 'live engagement data' : 'sample data'}</span>
            )}
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
              <div className="p-4 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: preview.html }} />
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

function Pill({ field, onInsert }: { field: MergeField; onInsert: (s: string) => void }) {
  const isArray = field.type === 'array';
  const isObject = field.type === 'object';
  const snippet = isArray
    ? `{{#each ${field.key}}}\n  \n{{/each}}`
    : isObject
      ? `{{${field.key}.<fieldName>}}`
      : `{{${field.key}}}`;
  return (
    <button
      type="button"
      onClick={() => onInsert(snippet)}
      title={`${field.label}${field.description ? ' — ' + field.description : ''}`}
      className={`text-[10px] px-1.5 py-0.5 rounded border ${
        isArray ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
          : isObject ? 'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100'
          : 'bg-teal-50 border-teal-200 text-teal-700 hover:bg-teal-100'
      }`}
    >
      {field.label}
    </button>
  );
}
