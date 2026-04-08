'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Upload, FileText, Trash2, Pencil, X, Check, Search, Loader2,
  File, FileSpreadsheet, FileImage, Download,
} from 'lucide-react';
import { BackButton } from './BackButton';

const CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'engagement', label: 'Engagement Letter' },
  { value: 'reporting', label: 'Reporting' },
  { value: 'correspondence', label: 'Correspondence' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'checklist', label: 'Checklist' },
];

const AUDIT_TYPES = [
  { value: 'ALL', label: 'All Types' },
  { value: 'SME', label: 'Statutory' },
  { value: 'PIE', label: 'PIE' },
  { value: 'SME_CONTROLS', label: 'Statutory Controls' },
  { value: 'PIE_CONTROLS', label: 'PIE Controls' },
];

interface UploadedDocument {
  id: string;
  name: string;
  originalName: string;
  category: string;
  auditType: string;
  description: string;
  fileSize: number;
  fileType: string;
  uploadedAt: string;
  uploadedBy: string;
  useMergeFields: boolean;
}

interface Props {
  initialDocuments: UploadedDocument[];
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(fileType: string) {
  if (fileType.includes('pdf')) return <FileText className="h-5 w-5 text-red-500" />;
  if (fileType.includes('spreadsheet') || fileType.includes('excel') || fileType.includes('csv')) return <FileSpreadsheet className="h-5 w-5 text-green-600" />;
  if (fileType.includes('image')) return <FileImage className="h-5 w-5 text-blue-500" />;
  if (fileType.includes('word') || fileType.includes('document')) return <FileText className="h-5 w-5 text-blue-600" />;
  return <File className="h-5 w-5 text-slate-500" />;
}

export function DocumentManagerClient({ initialDocuments }: Props) {
  const [documents, setDocuments] = useState<UploadedDocument[]>(initialDocuments);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', category: 'general', auditType: 'ALL', useMergeFields: false });
  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({ name: '', description: '', category: 'general', auditType: 'ALL', useMergeFields: false });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const filtered = documents.filter((d) => {
    if (filterCategory !== 'all' && d.category !== filterCategory) return false;
    if (searchQuery && !d.name.toLowerCase().includes(searchQuery.toLowerCase()) && !d.originalName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  async function handleUpload() {
    if (!selectedFile || !uploadForm.name.trim()) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('name', uploadForm.name);
      formData.append('description', uploadForm.description);
      formData.append('category', uploadForm.category);
      formData.append('auditType', uploadForm.auditType);
      formData.append('useMergeFields', String(uploadForm.useMergeFields));

      const res = await fetch('/api/methodology-admin/uploaded-documents', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        const doc = await res.json();
        setDocuments([doc, ...documents]);
        setShowUpload(false);
        setSelectedFile(null);
        setUploadForm({ name: '', description: '', category: 'general', auditType: 'ALL', useMergeFields: false });
      }
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    const res = await fetch(`/api/methodology-admin/uploaded-documents/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setDocuments(documents.filter((d) => d.id !== id));
      if (editingId === id) setEditingId(null);
    }
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    const res = await fetch(`/api/methodology-admin/uploaded-documents/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    });
    if (res.ok) {
      const updated = await res.json();
      setDocuments(documents.map((d) => (d.id === updated.id ? updated : d)));
      setEditingId(null);
    }
  }

  function startEdit(doc: UploadedDocument) {
    setEditingId(doc.id);
    setEditForm({
      name: doc.name,
      description: doc.description,
      category: doc.category,
      auditType: doc.auditType,
      useMergeFields: doc.useMergeFields,
    });
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (!uploadForm.name) {
        setUploadForm({ ...uploadForm, name: file.name.replace(/\.[^.]+$/, '') });
      }
    }
  }

  return (
    <div className="max-w-7xl mx-auto">
      <BackButton href="/methodology-admin/template-documents" label="Back to Templates" />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Template Documents</h1>
          <p className="text-sm text-slate-500 mt-1">
            Upload and manage document templates that can be populated from system data
          </p>
        </div>
        <Button onClick={() => setShowUpload(!showUpload)} size="sm">
          <Upload className="h-4 w-4 mr-1" /> Upload Document
        </Button>
      </div>

      {/* Upload panel */}
      {showUpload && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 mb-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-4">Upload New Document</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Document Name *</label>
              <input
                type="text"
                value={uploadForm.name}
                onChange={(e) => setUploadForm({ ...uploadForm, name: e.target.value })}
                placeholder="e.g. Engagement Letter Template"
                className="w-full px-2 py-1.5 text-sm border rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
              <input
                type="text"
                value={uploadForm.description}
                onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
                placeholder="Brief description"
                className="w-full px-2 py-1.5 text-sm border rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
              <select
                value={uploadForm.category}
                onChange={(e) => setUploadForm({ ...uploadForm, category: e.target.value })}
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
                value={uploadForm.auditType}
                onChange={(e) => setUploadForm({ ...uploadForm, auditType: e.target.value })}
                className="w-full px-2 py-1.5 text-sm border rounded-md"
              >
                {AUDIT_TYPES.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3 mb-4">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={uploadForm.useMergeFields}
                onChange={(e) => setUploadForm({ ...uploadForm, useMergeFields: e.target.checked })}
                className="rounded border-slate-300"
              />
              Populate with merge fields from system data
            </label>
          </div>

          <div className="flex items-center gap-4">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 border-2 border-dashed border-slate-300 rounded-lg p-4 text-center cursor-pointer hover:border-teal-400 hover:bg-teal-50 transition-colors"
            >
              {selectedFile ? (
                <div className="flex items-center justify-center gap-2">
                  {getFileIcon(selectedFile.type)}
                  <span className="text-sm text-slate-700">{selectedFile.name}</span>
                  <span className="text-xs text-slate-400">({formatFileSize(selectedFile.size)})</span>
                </div>
              ) : (
                <div>
                  <Upload className="h-6 w-6 text-slate-400 mx-auto mb-1" />
                  <p className="text-xs text-slate-500">Click to select a file (PDF, DOCX, XLSX, etc.)</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.rtf"
                onChange={handleFileSelect}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Button onClick={handleUpload} size="sm" disabled={uploading || !selectedFile || !uploadForm.name.trim()}>
                {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
                Upload
              </Button>
              <Button onClick={() => { setShowUpload(false); setSelectedFile(null); }} size="sm" variant="outline">
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-7 pr-2 py-1.5 text-sm border rounded-md"
          />
        </div>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="px-2 py-1.5 text-sm border rounded-md"
        >
          <option value="all">All Categories</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      {/* Document list */}
      {filtered.length === 0 ? (
        <div className="border rounded-lg p-12 text-center text-slate-400">
          <FileText className="h-12 w-12 mx-auto mb-3 text-slate-300" />
          <p className="text-sm">
            {documents.length === 0 ? 'No documents uploaded yet' : 'No matching documents'}
          </p>
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {filtered.map((doc) => (
            <div key={doc.id} className="p-4 hover:bg-slate-50 transition-colors">
              {editingId === doc.id ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        className="w-full px-2 py-1.5 text-sm border rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                      <input
                        type="text"
                        value={editForm.description}
                        onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                        className="w-full px-2 py-1.5 text-sm border rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                      <select
                        value={editForm.category}
                        onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
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
                        value={editForm.auditType}
                        onChange={(e) => setEditForm({ ...editForm, auditType: e.target.value })}
                        className="w-full px-2 py-1.5 text-sm border rounded-md"
                      >
                        {AUDIT_TYPES.map((a) => (
                          <option key={a.value} value={a.value}>{a.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={editForm.useMergeFields}
                        onChange={(e) => setEditForm({ ...editForm, useMergeFields: e.target.checked })}
                        className="rounded border-slate-300"
                      />
                      Populate with merge fields
                    </label>
                    <div className="ml-auto flex items-center gap-2">
                      <Button onClick={handleSaveEdit} size="sm">
                        <Check className="h-3.5 w-3.5 mr-1" /> Save
                      </Button>
                      <Button onClick={() => setEditingId(null)} size="sm" variant="outline">
                        <X className="h-3.5 w-3.5 mr-1" /> Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <div className="flex-shrink-0">
                    {getFileIcon(doc.fileType)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800 truncate">{doc.name}</span>
                      {doc.useMergeFields && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-50 text-teal-600 border border-teal-200">Merge Fields</span>
                      )}
                    </div>
                    {doc.description && <p className="text-xs text-slate-500 mt-0.5 truncate">{doc.description}</p>}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                        {CATEGORIES.find((c) => c.value === doc.category)?.label || doc.category}
                      </span>
                      {doc.auditType !== 'ALL' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{doc.auditType}</span>
                      )}
                      <span className="text-[10px] text-slate-400">{doc.originalName}</span>
                      <span className="text-[10px] text-slate-400">{formatFileSize(doc.fileSize)}</span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(doc.uploadedAt).toLocaleDateString('en-GB')}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => window.open(`/api/methodology-admin/uploaded-documents/${doc.id}/download`, '_blank')}
                      title="Download"
                      className="p-1.5 hover:bg-slate-200 rounded transition-colors"
                    >
                      <Download className="h-3.5 w-3.5 text-slate-500" />
                    </button>
                    <button
                      onClick={() => startEdit(doc)}
                      title="Edit"
                      className="p-1.5 hover:bg-slate-200 rounded transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5 text-slate-500" />
                    </button>
                    <button
                      onClick={() => handleDelete(doc.id)}
                      title="Delete"
                      className="p-1.5 hover:bg-red-100 rounded transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
