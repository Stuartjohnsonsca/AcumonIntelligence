'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, FileText, Loader2, Trash2, Filter, Settings2, X } from 'lucide-react';
import { BackButton } from './BackButton';
import { FirmSkeletonManager, type Skeleton } from './FirmSkeletonManager';
import { DocumentTemplateEditor, type DocumentTemplate } from './DocumentTemplateEditor';

interface CategoryOption { value: string; label: string }

/** Default document-template categories shown to firms that haven't
 *  yet customised their list. Admins can add/remove from the Manage
 *  Categories popover — the working list is persisted via
 *  /api/methodology-admin/template-categories?kind=document and
 *  overrides these defaults on next page load. The three workflow
 *  categories are kept at the top because they gate tab-action
 *  popups (e.g. RMM's Send/Download Planning Letter). */
const DEFAULT_DOC_CATEGORIES: CategoryOption[] = [
  { value: 'audit_planning_letter', label: 'Audit Planning Letter' },
  { value: 'engagement_letter',     label: 'Engagement Letter' },
  { value: 'management_letter',     label: 'Management Letter' },
  { value: 'general',               label: 'General' },
  { value: 'engagement',            label: 'Engagement' },
  { value: 'reporting',             label: 'Reporting' },
  { value: 'correspondence',        label: 'Correspondence' },
  { value: 'compliance',            label: 'Compliance' },
  { value: 'checklist',             label: 'Checklist' },
];

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
  // Category filter — defaults to "all". Stored in URL-less local
  // state because the list is small enough that round-tripping
  // through ? params would be overkill.
  const [filterCategory, setFilterCategory] = useState<string>('all');
  // Admin-managed category list. Loaded from
  // /api/methodology-admin/template-categories?kind=document so the
  // Methodology Admin can add/remove from the Manage Categories
  // popover. Falls back to DEFAULT_DOC_CATEGORIES until the fetch
  // resolves.
  const [categories, setCategories] = useState<CategoryOption[]>(DEFAULT_DOC_CATEGORIES);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [newCategoryLabel, setNewCategoryLabel] = useState('');
  const [savingCategories, setSavingCategories] = useState(false);

  async function loadCategories() {
    try {
      const res = await fetch('/api/methodology-admin/template-categories?kind=document');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.categories) && data.categories.length > 0) {
        setCategories(data.categories);
      }
    } catch { /* keep defaults */ }
  }

  async function handleAddCategory() {
    const label = newCategoryLabel.trim();
    if (!label) return;
    const value = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (!value) return;
    if (categories.some(c => c.value === value)) { setNewCategoryLabel(''); return; }
    const updated = [...categories, { value, label }];
    setSavingCategories(true);
    try {
      const res = await fetch('/api/methodology-admin/template-categories?kind=document', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: updated }),
      });
      if (res.ok) {
        setCategories(updated);
        setNewCategoryLabel('');
      }
    } finally {
      setSavingCategories(false);
    }
  }
  async function handleRemoveCategory(value: string) {
    const inUse = templates.some(t => t.category === value);
    if (inUse) {
      alert('Cannot remove a category that is in use by existing templates. Re-tag those templates first.');
      return;
    }
    const updated = categories.filter(c => c.value !== value);
    setSavingCategories(true);
    try {
      const res = await fetch('/api/methodology-admin/template-categories?kind=document', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: updated }),
      });
      if (res.ok) setCategories(updated);
    } finally {
      setSavingCategories(false);
    }
  }

  // Filtered view. `templates` stays unchanged so the category count
  // tooltip can still show N/M style indicators if we add them later.
  const visibleTemplates = useMemo(() => {
    if (filterCategory === 'all') return templates;
    return templates.filter(t => t.category === filterCategory);
  }, [templates, filterCategory]);
  // Category list the filter dropdown offers — "all" prepended.
  const filterOptions = useMemo<CategoryOption[]>(
    () => [{ value: 'all', label: 'All categories' }, ...categories],
    [categories],
  );

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
      await Promise.all([loadTemplates(), loadEngagements(), loadCategories()]);
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
          categories={categories}
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
          <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Document templates</h3>
              <p className="text-[11px] text-slate-500">Handlebars-enabled body content. Each template renders into a firm skeleton to produce a Word file.</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center gap-1 text-[11px]">
                <Filter className="h-3 w-3 text-slate-400" />
                <select
                  value={filterCategory}
                  onChange={e => setFilterCategory(e.target.value)}
                  className="text-[11px] border border-slate-200 rounded px-1.5 py-1 bg-white"
                  title="Filter by category"
                >
                  {filterOptions.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => setShowCategoryManager(s => !s)}
                title="Manage categories (Methodology Admin)"
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-white text-slate-700 border border-slate-200 rounded hover:bg-slate-100"
              >
                <Settings2 className="h-3 w-3" /> Manage categories
              </button>
              <button
                onClick={createTemplate}
                disabled={creating || skeletons.length === 0}
                title={skeletons.length === 0 ? 'Upload a firm skeleton first' : 'New template'}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100 disabled:opacity-50"
              >
                {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} New template
              </button>
            </div>
          </div>

          {/* ── Category manager — collapsible; admin-only controls ─────── */}
          {showCategoryManager && (
            <div className="bg-amber-50/40 border-b border-amber-100 px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h4 className="text-[12px] font-semibold text-slate-800">Document template categories</h4>
                  <p className="text-[10px] text-slate-500">Add or remove categories. In-use categories cannot be removed until the templates using them are re-tagged.</p>
                </div>
                <button onClick={() => setShowCategoryManager(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {categories.map(c => {
                  const inUse = templates.some(t => t.category === c.value);
                  return (
                    <span key={c.value} className="inline-flex items-center gap-1 bg-white border border-slate-200 rounded text-[10px] px-2 py-0.5">
                      <span className="text-slate-700">{c.label}</span>
                      <code className="text-[9px] text-slate-400">{c.value}</code>
                      <button
                        onClick={() => handleRemoveCategory(c.value)}
                        disabled={inUse || savingCategories}
                        title={inUse ? `In use by ${templates.filter(t => t.category === c.value).length} template(s)` : 'Remove'}
                        className="text-slate-400 hover:text-red-500 disabled:opacity-30"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  );
                })}
              </div>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={newCategoryLabel}
                  onChange={e => setNewCategoryLabel(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleAddCategory(); } }}
                  placeholder="New category label (e.g. “Audit Report”)"
                  className="text-[11px] border border-slate-200 rounded px-2 py-1 flex-1 max-w-xs"
                />
                <button
                  onClick={handleAddCategory}
                  disabled={!newCategoryLabel.trim() || savingCategories}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100 disabled:opacity-50"
                >
                  {savingCategories ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add
                </button>
              </div>
            </div>
          )}
          {loading ? (
            <div className="p-6 text-center text-xs text-slate-400"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
          ) : templates.length === 0 ? (
            <div className="p-6 text-center text-[11px] text-slate-400 italic">No document templates yet. Upload a firm skeleton, then click New template to build your first one.</div>
          ) : visibleTemplates.length === 0 ? (
            <div className="p-6 text-center text-[11px] text-slate-400 italic">
              No templates match the current category filter. <button className="underline hover:text-slate-600" onClick={() => setFilterCategory('all')}>Show all</button>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {visibleTemplates.map(t => (
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
