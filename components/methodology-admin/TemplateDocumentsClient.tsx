'use client';

import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Save, Loader2, Plus, X, Trash2, Copy, ChevronLeft, Eye, Code,
  FileText, Variable, Search, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { BackButton } from './BackButton';

// ─── Available merge fields from system data ─────────────────────
const MERGE_FIELD_CATEGORIES = [
  {
    category: 'Client',
    fields: [
      { key: 'client_name', label: 'Client Name', source: 'client', path: 'clientName' },
      { key: 'client_ref', label: 'Client Reference', source: 'client', path: 'clientRef' },
      { key: 'client_address', label: 'Client Address', source: 'client', path: 'address' },
      { key: 'client_reg_number', label: 'Registration Number', source: 'client', path: 'registrationNumber' },
      { key: 'client_industry', label: 'Industry', source: 'client', path: 'industry' },
      { key: 'client_contact_name', label: 'Contact Name', source: 'client', path: 'contactName' },
      { key: 'client_contact_email', label: 'Contact Email', source: 'client', path: 'contactEmail' },
    ],
  },
  {
    category: 'Engagement',
    fields: [
      { key: 'engagement_type', label: 'Audit Type', source: 'engagement', path: 'auditType' },
      { key: 'period_end', label: 'Period End Date', source: 'engagement', path: 'periodEnd' },
      { key: 'target_completion', label: 'Target Completion', source: 'engagement', path: 'targetCompletion' },
      { key: 'compliance_deadline', label: 'Compliance Deadline', source: 'engagement', path: 'complianceDeadline' },
      { key: 'engagement_partner', label: 'Engagement Partner', source: 'engagement', path: 'partner' },
      { key: 'engagement_manager', label: 'Engagement Manager', source: 'engagement', path: 'manager' },
    ],
  },
  {
    category: 'Firm',
    fields: [
      { key: 'firm_name', label: 'Firm Name', source: 'firm', path: 'firmName' },
      { key: 'firm_address', label: 'Firm Address', source: 'firm', path: 'address' },
      { key: 'firm_registration', label: 'Firm Registration', source: 'firm', path: 'registration' },
    ],
  },
  {
    category: 'Dates',
    fields: [
      { key: 'current_date', label: 'Current Date', source: 'system', path: 'currentDate' },
      { key: 'current_year', label: 'Current Year', source: 'system', path: 'currentYear' },
      { key: 'prior_period_end', label: 'Prior Period End', source: 'engagement', path: 'priorPeriodEnd' },
    ],
  },
  {
    category: 'Team',
    fields: [
      { key: 'ri_name', label: 'RI Name', source: 'team', path: 'riName' },
      { key: 'reviewer_name', label: 'Reviewer Name', source: 'team', path: 'reviewerName' },
      { key: 'preparer_name', label: 'Preparer Name', source: 'team', path: 'preparerName' },
      { key: 'current_user', label: 'Current User', source: 'system', path: 'currentUser' },
    ],
  },
];

const CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'engagement', label: 'Engagement' },
  { value: 'reporting', label: 'Reporting' },
  { value: 'correspondence', label: 'Correspondence' },
  { value: 'compliance', label: 'Compliance' },
];

const AUDIT_TYPES = [
  { value: 'ALL', label: 'All Types' },
  { value: 'SME', label: 'SME' },
  { value: 'PIE', label: 'PIE' },
  { value: 'SME_CONTROLS', label: 'SME Controls' },
  { value: 'PIE_CONTROLS', label: 'PIE Controls' },
];

interface DocumentTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string;
  auditType: string;
  content: string;
  mergeFields: { key: string; label: string; source: string; path: string }[];
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  initialTemplates: DocumentTemplate[];
}

export function TemplateDocumentsClient({ initialTemplates }: Props) {
  const [templates, setTemplates] = useState<DocumentTemplate[]>(initialTemplates);
  const [selected, setSelected] = useState<DocumentTemplate | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filterCategory, setFilterCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState('general');
  const [editAuditType, setEditAuditType] = useState('ALL');
  const [editContent, setEditContent] = useState('');
  const [editMergeFields, setEditMergeFields] = useState<{ key: string; label: string; source: string; path: string }[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [fieldSearch, setFieldSearch] = useState('');

  const editorRef = useRef<HTMLTextAreaElement>(null);

  const filteredTemplates = templates.filter((t) => {
    if (filterCategory !== 'all' && t.category !== filterCategory) return false;
    if (searchQuery && !t.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  function startCreate() {
    setIsCreating(true);
    setIsEditing(true);
    setSelected(null);
    setEditName('');
    setEditDescription('');
    setEditCategory('general');
    setEditAuditType('ALL');
    setEditContent('');
    setEditMergeFields([]);
    setShowPreview(false);
  }

  function startEdit(template: DocumentTemplate) {
    setSelected(template);
    setIsEditing(true);
    setIsCreating(false);
    setEditName(template.name);
    setEditDescription(template.description || '');
    setEditCategory(template.category);
    setEditAuditType(template.auditType);
    setEditContent(template.content);
    setEditMergeFields(template.mergeFields || []);
    setShowPreview(false);
  }

  function cancelEdit() {
    setIsEditing(false);
    setIsCreating(false);
  }

  const insertMergeField = useCallback((key: string, label: string, source: string, path: string) => {
    const tag = `{{${key}}}`;
    const textarea = editorRef.current;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newContent = editContent.slice(0, start) + tag + editContent.slice(end);
      setEditContent(newContent);
      // Track used merge fields
      if (!editMergeFields.find((f) => f.key === key)) {
        setEditMergeFields([...editMergeFields, { key, label, source, path }]);
      }
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + tag.length, start + tag.length);
      }, 0);
    } else {
      setEditContent(editContent + tag);
      if (!editMergeFields.find((f) => f.key === key)) {
        setEditMergeFields([...editMergeFields, { key, label, source, path }]);
      }
    }
  }, [editContent, editMergeFields]);

  async function handleSave() {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      if (isCreating) {
        const res = await fetch('/api/methodology-admin/template-documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: editName,
            description: editDescription,
            category: editCategory,
            auditType: editAuditType,
            content: editContent,
            mergeFields: editMergeFields,
          }),
        });
        if (res.ok) {
          const newTemplate = await res.json();
          setTemplates([...templates, newTemplate]);
          setSelected(newTemplate);
          setIsCreating(false);
          setIsEditing(false);
        }
      } else if (selected) {
        const res = await fetch(`/api/methodology-admin/template-documents/${selected.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: editName,
            description: editDescription,
            category: editCategory,
            auditType: editAuditType,
            content: editContent,
            mergeFields: editMergeFields,
          }),
        });
        if (res.ok) {
          const updated = await res.json();
          setTemplates(templates.map((t) => (t.id === updated.id ? updated : t)));
          setSelected(updated);
          setIsEditing(false);
        }
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this template? This cannot be undone.')) return;
    const res = await fetch(`/api/methodology-admin/template-documents/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setTemplates(templates.filter((t) => t.id !== id));
      if (selected?.id === id) {
        setSelected(null);
        setIsEditing(false);
      }
    }
  }

  async function handleDuplicate(template: DocumentTemplate) {
    const res = await fetch('/api/methodology-admin/template-documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${template.name} (Copy)`,
        description: template.description,
        category: template.category,
        auditType: template.auditType,
        content: template.content,
        mergeFields: template.mergeFields,
      }),
    });
    if (res.ok) {
      const newTemplate = await res.json();
      setTemplates([...templates, newTemplate]);
    }
  }

  async function handleToggleActive(template: DocumentTemplate) {
    const res = await fetch(`/api/methodology-admin/template-documents/${template.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !template.isActive }),
    });
    if (res.ok) {
      const updated = await res.json();
      setTemplates(templates.map((t) => (t.id === updated.id ? updated : t)));
      if (selected?.id === updated.id) setSelected(updated);
    }
  }

  // Preview: replace merge fields with sample data
  function getPreviewContent() {
    let preview = editContent;
    const sampleData: Record<string, string> = {
      client_name: 'Acme Corporation Ltd',
      client_ref: 'ACM001',
      client_address: '123 Business Street, London EC1A 1BB',
      client_reg_number: '12345678',
      client_industry: 'Technology',
      client_contact_name: 'John Smith',
      client_contact_email: 'john@acme.com',
      engagement_type: 'Statutory Audit',
      period_end: '31 March 2026',
      target_completion: '30 June 2026',
      compliance_deadline: '31 December 2026',
      engagement_partner: 'Stuart Thomson',
      engagement_manager: 'Edmund Cartwright',
      firm_name: 'Johnsons Chartered Accountants',
      firm_address: '456 Audit Lane, London SW1A 1AA',
      firm_registration: 'C123456',
      current_date: new Date().toLocaleDateString('en-GB'),
      current_year: new Date().getFullYear().toString(),
      prior_period_end: '31 March 2025',
      ri_name: 'Stuart Thomson',
      reviewer_name: 'Mandhu Chennupati',
      preparer_name: 'Sarah Williams',
      current_user: 'Stuart Thomson',
    };
    for (const [key, value] of Object.entries(sampleData)) {
      preview = preview.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), `<span class="bg-teal-100 text-teal-800 px-1 rounded font-medium">${value}</span>`);
    }
    // Highlight any unmatched fields
    preview = preview.replace(/\{\{(\w+)\}\}/g, '<span class="bg-red-100 text-red-700 px-1 rounded">{{$1}}</span>');
    return preview;
  }

  // ─── Render ────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto">
      <BackButton href="/methodology-admin" label="Back to Methodology Admin" />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Template Documents</h1>
          <p className="text-sm text-slate-500 mt-1">
            Create document templates with merge fields that are populated from system data
          </p>
        </div>
        <Button onClick={startCreate} size="sm">
          <Plus className="h-4 w-4 mr-1" /> New Template
        </Button>
      </div>

      <div className="flex gap-6">
        {/* Left sidebar: template list */}
        <div className="w-72 flex-shrink-0">
          <div className="mb-3 space-y-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search templates..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-7 pr-2 py-1.5 text-sm border rounded-md"
              />
            </div>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border rounded-md"
            >
              <option value="all">All Categories</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          <div className="border rounded-lg divide-y max-h-[600px] overflow-y-auto">
            {filteredTemplates.length === 0 && (
              <div className="p-4 text-center text-sm text-slate-400">
                {templates.length === 0 ? 'No templates yet' : 'No matching templates'}
              </div>
            )}
            {filteredTemplates.map((t) => (
              <div
                key={t.id}
                onClick={() => { setSelected(t); setIsEditing(false); setIsCreating(false); }}
                className={`p-3 cursor-pointer hover:bg-slate-50 transition-colors group ${
                  selected?.id === t.id ? 'bg-teal-50 border-l-2 border-l-teal-500' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-800 truncate">{t.name}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); handleDuplicate(t); }} title="Duplicate" className="p-0.5 hover:bg-slate-200 rounded">
                      <Copy className="h-3 w-3 text-slate-500" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleToggleActive(t); }} title={t.isActive ? 'Deactivate' : 'Activate'} className="p-0.5 hover:bg-slate-200 rounded">
                      {t.isActive ? <ToggleRight className="h-3 w-3 text-green-600" /> : <ToggleLeft className="h-3 w-3 text-slate-400" />}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }} title="Delete" className="p-0.5 hover:bg-red-100 rounded">
                      <Trash2 className="h-3 w-3 text-red-500" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{t.category}</span>
                  {t.auditType !== 'ALL' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{t.auditType}</span>
                  )}
                  {!t.isActive && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-500">Inactive</span>
                  )}
                  <span className="text-[10px] text-slate-400 ml-auto">v{t.version}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: editor / viewer */}
        <div className="flex-1 min-w-0">
          {!isEditing && !selected && (
            <div className="border rounded-lg p-12 text-center text-slate-400">
              <FileText className="h-12 w-12 mx-auto mb-3 text-slate-300" />
              <p className="text-sm">Select a template from the list or create a new one</p>
            </div>
          )}

          {!isEditing && selected && (
            <div className="border rounded-lg">
              <div className="flex items-center justify-between p-4 border-b bg-slate-50 rounded-t-lg">
                <div>
                  <h2 className="font-semibold text-slate-900">{selected.name}</h2>
                  {selected.description && <p className="text-xs text-slate-500 mt-0.5">{selected.description}</p>}
                </div>
                <Button onClick={() => startEdit(selected)} size="sm" variant="outline">
                  Edit Template
                </Button>
              </div>
              <div className="p-4">
                <div className="flex gap-2 mb-4">
                  <span className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-600">
                    {CATEGORIES.find((c) => c.value === selected.category)?.label || selected.category}
                  </span>
                  <span className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-600">{selected.auditType}</span>
                  <span className="text-xs px-2 py-1 rounded bg-teal-50 text-teal-600">
                    {selected.mergeFields?.length || 0} merge fields
                  </span>
                </div>
                <div
                  className="prose prose-sm max-w-none border rounded-md p-4 bg-white min-h-[300px] whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ __html: selected.content.replace(/\{\{(\w+)\}\}/g, '<code class="text-teal-700 bg-teal-50 px-1 rounded text-xs">{{$1}}</code>') }}
                />
              </div>
            </div>
          )}

          {isEditing && (
            <div className="border rounded-lg">
              <div className="flex items-center justify-between p-4 border-b bg-slate-50 rounded-t-lg">
                <h2 className="font-semibold text-slate-900">
                  {isCreating ? 'New Template' : `Edit: ${editName}`}
                </h2>
                <div className="flex items-center gap-2">
                  <Button onClick={() => setShowPreview(!showPreview)} size="sm" variant="outline">
                    {showPreview ? <Code className="h-3.5 w-3.5 mr-1" /> : <Eye className="h-3.5 w-3.5 mr-1" />}
                    {showPreview ? 'Editor' : 'Preview'}
                  </Button>
                  <Button onClick={cancelEdit} size="sm" variant="outline">Cancel</Button>
                  <Button onClick={handleSave} size="sm" disabled={saving || !editName.trim()}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                    Save
                  </Button>
                </div>
              </div>

              <div className="p-4 space-y-4">
                {/* Metadata fields */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Template Name *</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="e.g. Engagement Letter"
                      className="w-full px-2 py-1.5 text-sm border rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                    <input
                      type="text"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      placeholder="Brief description"
                      className="w-full px-2 py-1.5 text-sm border rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                    <select
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm border rounded-md"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Audit Type</label>
                    <select
                      value={editAuditType}
                      onChange={(e) => setEditAuditType(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm border rounded-md"
                    >
                      {AUDIT_TYPES.map((a) => (
                        <option key={a.value} value={a.value}>{a.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Editor + Merge fields sidebar */}
                <div className="flex gap-4">
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Template Content
                      <span className="text-slate-400 font-normal ml-1">
                        Use {'{{field_name}}'} to insert merge fields
                      </span>
                    </label>
                    {showPreview ? (
                      <div
                        className="border rounded-md p-4 bg-white min-h-[400px] whitespace-pre-wrap prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ __html: getPreviewContent() }}
                      />
                    ) : (
                      <textarea
                        ref={editorRef}
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        placeholder={`Dear {{client_contact_name}},\n\nRe: Audit of {{client_name}} for the year ended {{period_end}}\n\nWe are pleased to confirm our appointment as auditors...\n\nYours faithfully,\n{{engagement_partner}}\n{{firm_name}}`}
                        className="w-full px-3 py-2 text-sm border rounded-md font-mono min-h-[400px] resize-y"
                      />
                    )}
                  </div>

                  {/* Merge fields palette */}
                  {!showPreview && (
                    <div className="w-56 flex-shrink-0">
                      <div className="border rounded-lg bg-slate-50 p-2">
                        <div className="flex items-center gap-1 mb-2">
                          <Variable className="h-3.5 w-3.5 text-teal-600" />
                          <span className="text-xs font-semibold text-slate-700">Merge Fields</span>
                        </div>
                        <input
                          type="text"
                          placeholder="Search fields..."
                          value={fieldSearch}
                          onChange={(e) => setFieldSearch(e.target.value)}
                          className="w-full px-2 py-1 text-[11px] border rounded mb-2"
                        />
                        <div className="max-h-[350px] overflow-y-auto space-y-2">
                          {MERGE_FIELD_CATEGORIES.map((cat) => {
                            const filtered = cat.fields.filter((f) =>
                              !fieldSearch || f.label.toLowerCase().includes(fieldSearch.toLowerCase()) || f.key.includes(fieldSearch.toLowerCase())
                            );
                            if (filtered.length === 0) return null;
                            return (
                              <div key={cat.category}>
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                                  {cat.category}
                                </div>
                                {filtered.map((field) => {
                                  const isUsed = editMergeFields.some((f) => f.key === field.key);
                                  return (
                                    <button
                                      key={field.key}
                                      onClick={() => insertMergeField(field.key, field.label, field.source, field.path)}
                                      className={`w-full text-left px-1.5 py-1 rounded text-[11px] hover:bg-teal-100 transition-colors flex items-center gap-1 ${
                                        isUsed ? 'bg-teal-50 text-teal-700' : 'text-slate-600'
                                      }`}
                                    >
                                      <code className="text-[9px] text-teal-600 bg-teal-50 px-0.5 rounded">{`{{${field.key}}}`}</code>
                                      <span className="truncate">{field.label}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Active merge fields in this template */}
                {editMergeFields.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Fields used in this template ({editMergeFields.length})
                    </label>
                    <div className="flex flex-wrap gap-1">
                      {editMergeFields.map((f) => (
                        <span key={f.key} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200">
                          {f.label}
                          <button onClick={() => setEditMergeFields(editMergeFields.filter((mf) => mf.key !== f.key))} className="hover:text-red-500">
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
