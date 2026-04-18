'use client';

import { useEffect, useState } from 'react';
import { Plus, FileText, Loader2, Trash2 } from 'lucide-react';
import { BackButton } from './BackButton';
import { FirmSkeletonManager, type Skeleton } from './FirmSkeletonManager';
import { DocumentTemplateEditor, type DocumentTemplate } from './DocumentTemplateEditor';

/**
 * Top-level client for Methodology Admin → Template Documents → Documents.
 *
 * Three-pane flow:
 *   1. Firm skeletons (upload + manage)   — FirmSkeletonManager
 *   2. Document templates (list + create) — this component
 *   3. Editor                             — DocumentTemplateEditor
 *
 * The editor takes over the whole pane when a template is selected so
 * the admin has room to see the body + preview side by side.
 */

interface EngagementOption { id: string; clientName: string; periodEnd: string | null }

export function DocumentTemplateManagerClient() {
  const [skeletons, setSkeletons] = useState<Skeleton[]>([]);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DocumentTemplate | null>(null);
  const [engagements, setEngagements] = useState<EngagementOption[]>([]);
  const [creating, setCreating] = useState(false);

  async function loadTemplates() {
    try {
      const res = await fetch('/api/methodology-admin/template-documents?kind=document');
      if (res.ok) setTemplates(await res.json());
    } catch { /* tolerant */ }
  }

  async function loadEngagements() {
    // Small list of the user's own firm's engagements for the preview
    // picker. Fail silently — preview will fall back to sample data.
    try {
      const res = await fetch('/api/engagements?limit=50');
      if (res.ok) {
        const data = await res.json();
        const list: any[] = Array.isArray(data) ? data : (data.engagements || []);
        setEngagements(list.map(e => ({
          id: e.id,
          clientName: e.client?.clientName || e.clientName || 'Engagement',
          periodEnd: e.period?.endDate ? new Date(e.period.endDate).toLocaleDateString('en-GB') : (e.periodEnd || null),
        })));
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadTemplates(), loadEngagements()]);
      setLoading(false);
    })();
  }, []);

  async function createTemplate() {
    const name = window.prompt('New template name (e.g. "Engagement Letter")');
    if (!name?.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/methodology-admin/template-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          kind: 'document',
          category: 'general',
          auditType: 'ALL',
          // Pre-fill with a lightweight starter so the admin sees
          // placeholders rendering on their first Preview.
          content: '<p>Dear {{client.name}},</p>\n<p>This document relates to the audit for the year ended {{formatDate period.periodEnd "dd MMMM yyyy"}}.</p>\n',
        }),
      });
      if (res.ok) {
        const created = await res.json();
        await loadTemplates();
        setSelected(created);
      }
    } finally {
      setCreating(false);
    }
  }

  async function removeTemplate(t: DocumentTemplate) {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    await fetch(`/api/methodology-admin/template-documents/${t.id}`, { method: 'DELETE' });
    await loadTemplates();
    if (selected?.id === t.id) setSelected(null);
  }

  if (selected) {
    return (
      <div className="h-[calc(100vh-140px)]">
        <DocumentTemplateEditor
          template={selected}
          skeletons={skeletons}
          engagements={engagements}
          onSaved={async (t) => { await loadTemplates(); setSelected(t); }}
          onClose={() => setSelected(null)}
        />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <BackButton href="/methodology-admin/template-documents" label="Back to Templates" />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Template Documents</h1>
        <p className="text-sm text-slate-500 mt-1">
          Firm-branded Word documents with merge-field placeholders and conditional logic. Upload a firm skeleton once, then build a library of templates that render into it per engagement.
        </p>
      </div>

      <div className="space-y-6">
        <FirmSkeletonManager onChange={setSkeletons} />

        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Document templates</h3>
              <p className="text-[11px] text-slate-500">Handlebars-enabled body content. Each template renders into a firm skeleton to produce a Word file.</p>
            </div>
            <button
              onClick={createTemplate}
              disabled={creating || skeletons.length === 0}
              title={skeletons.length === 0 ? 'Upload a firm skeleton first' : 'New template'}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100 disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} New template
            </button>
          </div>
          {loading ? (
            <div className="p-6 text-center text-xs text-slate-400"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
          ) : templates.length === 0 ? (
            <div className="p-6 text-center text-[11px] text-slate-400 italic">No document templates yet. Upload a firm skeleton, then click New template to build your first one.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {templates.map(t => (
                <li key={t.id} className="px-4 py-2 flex items-center gap-3 hover:bg-slate-50">
                  <FileText className="h-4 w-4 text-slate-400 flex-shrink-0" />
                  <button className="flex-1 text-left min-w-0" onClick={() => setSelected(t)}>
                    <div className="text-[12px] font-medium text-slate-800 truncate">{t.name}</div>
                    <div className="text-[10px] text-slate-500 truncate">{t.description || 'No description'} · {t.category} · {t.auditType} · v{t.version}</div>
                  </button>
                  <button
                    onClick={() => removeTemplate(t)}
                    title="Delete"
                    className="text-slate-400 hover:text-red-600"
                  ><Trash2 className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
