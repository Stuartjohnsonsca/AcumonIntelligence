'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';

interface Props {
  engagementId: string;
}

interface AuditDocument {
  id: string;
  documentName: string;
  requestedFrom: string | null;
  requestedDate: string | null;
  requestedBy: { id: string; name: string } | null;
  uploadedDate: string | null;
  uploadedBy: { id: string; name: string } | null;
  storagePath: string | null;
  fileSize: number | null;
  mimeType: string | null;
  visibleToClient: boolean;
  receivedByName: string | null;
  receivedAt: string | null;
  verifiedOn: string | null;
  verifiedByName: string | null;
  utilisedOn: string | null;
  utilisedByName: string | null;
  utilisedTab: string | null;
  mappedItems: string[] | null;
  source: string | null;
  usageLocation: string | null;
  documentType: string | null;
  createdAt: string;
}

// ─── Default category options ───
const DEFAULT_SOURCES = ['Client', 'Bank', 'Solicitor', 'HMRC', 'Companies House', 'Third Party', 'Team', 'Other'];
const DEFAULT_USAGE_LOCATIONS = ['Opening', 'Prior Period', 'Permanent File', 'Ethics', 'Continuance', 'Trial Balance', 'Materiality', 'PAR', 'Walkthroughs', 'RMM', 'Audit Plan', 'Completion', 'General'];
const DEFAULT_DOCUMENT_TYPES = ['Bank Statement', 'Bank Confirmation', 'Invoice', 'Contract', 'Lease Agreement', 'Board Minutes', 'Financial Statements', 'Tax Return', 'Payroll Report', 'Fixed Asset Register', 'Debtor Listing', 'Creditor Listing', 'Stock Listing', 'Management Accounts', 'Letter of Representation', 'Letter of Comment', 'Engagement Letter', 'Solicitor Confirmation', 'Other'];

function fmtDate(d: string | null) { return d ? new Date(d).toLocaleDateString('en-GB') : '—'; }
function fmtDateTime(d: string | null) { return d ? new Date(d).toLocaleDateString('en-GB') + ' ' + new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'; }

export function DocumentRepositoryTab({ engagementId }: Props) {
  const { data: session } = useSession();
  const [documents, setDocuments] = useState<AuditDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newFrom, setNewFrom] = useState('');
  const [newMapping, setNewMapping] = useState('');
  const [newSource, setNewSource] = useState('');
  const [newUsageLocation, setNewUsageLocation] = useState('');
  const [newDocType, setNewDocType] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingDocId, setUploadingDocId] = useState<string | null>(null);

  // Custom types added by user during this engagement
  const [customDocTypes, setCustomDocTypes] = useState<string[]>([]);
  const [addingCustomType, setAddingCustomType] = useState(false);
  const [customTypeInput, setCustomTypeInput] = useState('');

  // Filters
  const [filterSource, setFilterSource] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterDocType, setFilterDocType] = useState('');

  // Derive all available types (defaults + customs from data + customs added this session)
  const allDocTypes = [...new Set([...DEFAULT_DOCUMENT_TYPES, ...customDocTypes, ...documents.map(d => d.documentType).filter(Boolean) as string[]])].sort();
  const allSources = [...new Set([...DEFAULT_SOURCES, ...documents.map(d => d.source).filter(Boolean) as string[]])].sort();
  const allLocations = [...new Set([...DEFAULT_USAGE_LOCATIONS, ...documents.map(d => d.usageLocation).filter(Boolean) as string[]])].sort();

  const loadDocuments = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/documents`);
      if (res.ok) { const data = await res.json(); setDocuments(data.documents || []); }
    } catch (err) { console.error('Failed to load:', err); }
    finally { setLoading(false); }
  }, [engagementId]);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  async function postAction(body: Record<string, unknown>) {
    await fetch(`/api/engagements/${engagementId}/documents`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    await loadDocuments();
  }

  async function requestDocument() {
    if (!newName.trim()) return;
    setSubmitting(true);
    await postAction({
      action: 'request', documentName: newName.trim(), requestedFrom: newFrom.trim() || null,
      mappedItems: newMapping ? newMapping.split(',').map(s => s.trim()).filter(Boolean) : null,
      source: newSource || null,
      usageLocation: newUsageLocation || null,
      documentType: newDocType || null,
    });
    setNewName(''); setNewFrom(''); setNewMapping(''); setNewSource(''); setNewUsageLocation(''); setNewDocType('');
    setShowForm(false); setSubmitting(false);
  }

  async function handleFileUpload(docId: string, file: File) {
    setUploadingDocId(docId);
    await postAction({ action: 'upload', documentId: docId, fileSize: file.size, mimeType: file.type, storagePath: `uploads/${docId}/${file.name}` });
    setUploadingDocId(null);
  }

  async function deleteDocument(docId: string) {
    await fetch(`/api/engagements/${engagementId}/documents`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: docId }),
    });
    await loadDocuments();
  }

  async function updateCategory(docId: string, field: 'source' | 'usageLocation' | 'documentType', value: string) {
    await postAction({ action: 'update_categories', documentId: docId, [field]: value || null });
  }

  function addCustomDocType() {
    const t = customTypeInput.trim();
    if (!t || allDocTypes.includes(t)) return;
    setCustomDocTypes(prev => [...prev, t]);
    setNewDocType(t);
    setCustomTypeInput('');
    setAddingCustomType(false);
  }

  // Apply filters
  const filtered = documents.filter(doc => {
    if (filterSource && doc.source !== filterSource) return false;
    if (filterLocation && doc.usageLocation !== filterLocation) return false;
    if (filterDocType && doc.documentType !== filterDocType) return false;
    return true;
  });

  const hasActiveFilters = filterSource || filterLocation || filterDocType;

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading Documents...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-slate-800">Document Repository</h2>
        <button onClick={() => setShowForm(!showForm)}
          className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 font-medium">
          + Request Document
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Filter:</span>
        <select value={filterSource} onChange={e => setFilterSource(e.target.value)}
          className={`text-[10px] border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300 ${filterSource ? 'border-green-400 bg-green-50 text-green-700' : 'border-slate-200 text-slate-500'}`}>
          <option value="">All Sources</option>
          {allSources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterLocation} onChange={e => setFilterLocation(e.target.value)}
          className={`text-[10px] border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300 ${filterLocation ? 'border-green-400 bg-green-50 text-green-700' : 'border-slate-200 text-slate-500'}`}>
          <option value="">All Locations</option>
          {allLocations.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterDocType} onChange={e => setFilterDocType(e.target.value)}
          className={`text-[10px] border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300 ${filterDocType ? 'border-green-400 bg-green-50 text-green-700' : 'border-slate-200 text-slate-500'}`}>
          <option value="">All Types</option>
          {allDocTypes.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {hasActiveFilters && (
          <button onClick={() => { setFilterSource(''); setFilterLocation(''); setFilterDocType(''); }}
            className="text-[10px] text-red-500 hover:text-red-700 underline">Clear</button>
        )}
        <span className="text-[10px] text-slate-400 ml-auto">
          {hasActiveFilters ? `${filtered.length} of ${documents.length}` : `${documents.length}`} document{documents.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Request Form */}
      {showForm && (
        <div className="mb-4 border border-blue-200 rounded-lg p-4 bg-blue-50/30">
          <h3 className="text-sm font-medium text-slate-700 mb-2">New Document Request</h3>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Document Name *</label>
              <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="e.g. Bank Confirmation" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Requested From</label>
              <input type="text" value={newFrom} onChange={e => setNewFrom(e.target.value)}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="e.g. Client, Bank" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Mapped To (comma-separated)</label>
              <input type="text" value={newMapping} onChange={e => setNewMapping(e.target.value)}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="e.g. Revenue, Trade Debtors" />
            </div>
          </div>
          {/* Categorisation row */}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Source</label>
              <select value={newSource} onChange={e => setNewSource(e.target.value)}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
                <option value="">— Select —</option>
                {allSources.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Usage Location</label>
              <select value={newUsageLocation} onChange={e => setNewUsageLocation(e.target.value)}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
                <option value="">— Select —</option>
                {allLocations.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Document Type</label>
              <div className="flex gap-1">
                {addingCustomType ? (
                  <>
                    <input type="text" value={customTypeInput} onChange={e => setCustomTypeInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addCustomDocType()}
                      className="flex-1 border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="New type..." autoFocus />
                    <button onClick={addCustomDocType} disabled={!customTypeInput.trim()} className="text-xs px-2 py-1 bg-blue-600 text-white rounded disabled:opacity-50">Add</button>
                    <button onClick={() => { setAddingCustomType(false); setCustomTypeInput(''); }} className="text-xs px-1 text-slate-400">×</button>
                  </>
                ) : (
                  <>
                    <select value={newDocType} onChange={e => setNewDocType(e.target.value)}
                      className="flex-1 border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
                      <option value="">— Select —</option>
                      {allDocTypes.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button onClick={() => setAddingCustomType(true)} className="text-xs px-2 py-1 bg-slate-100 text-slate-500 rounded hover:bg-slate-200" title="Add custom type">+</button>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={requestDocument} disabled={!newName.trim() || submitting}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium">
              {submitting ? 'Requesting...' : 'Create Request'}
            </button>
            <button onClick={() => setShowForm(false)} className="text-xs px-3 py-1.5 bg-slate-100 text-slate-600 rounded hover:bg-slate-200">Cancel</button>
          </div>
        </div>
      )}

      {/* Documents List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm italic border border-slate-200 rounded-lg">
            {hasActiveFilters ? 'No documents match the current filters.' : 'No documents. Click "Request Document" to begin.'}
          </div>
        ) : filtered.map(doc => {
          const isExpanded = expandedDoc === doc.id;
          const mappedItems = Array.isArray(doc.mappedItems) ? doc.mappedItems : [];

          return (
            <div key={doc.id} className="border border-slate-200 rounded-lg overflow-hidden">
              {/* Document row */}
              <div className="flex items-center px-3 py-2.5 hover:bg-slate-50/50 gap-3">
                {/* Status dot */}
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${doc.uploadedDate ? 'bg-green-400' : 'bg-orange-400'}`} />

                {/* Name + tags */}
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpandedDoc(isExpanded ? null : doc.id)}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-slate-700">{doc.documentName}</span>
                    {doc.source && <span className="text-[8px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded font-medium">{doc.source}</span>}
                    {doc.usageLocation && <span className="text-[8px] bg-teal-100 text-teal-600 px-1.5 py-0.5 rounded font-medium">{doc.usageLocation}</span>}
                    {doc.documentType && <span className="text-[8px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded font-medium">{doc.documentType}</span>}
                    {mappedItems.length > 0 && mappedItems.map((item, i) => (
                      <span key={i} className="text-[8px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">{item as string}</span>
                    ))}
                    {doc.fileSize && <span className="text-[10px] text-slate-400">({(doc.fileSize / 1024).toFixed(0)}KB)</span>}
                  </div>
                  {doc.requestedFrom && <p className="text-[10px] text-slate-400">From: {doc.requestedFrom}</p>}
                </div>

                {/* Visible to Client toggle */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-[9px] text-slate-400">Client</span>
                  <button onClick={() => postAction({ action: 'toggle_visibility', documentId: doc.id })}
                    className={`relative w-8 h-4 rounded-full transition-colors ${doc.visibleToClient ? 'bg-green-500' : 'bg-slate-300'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${doc.visibleToClient ? 'translate-x-4' : ''}`} />
                  </button>
                </div>

                {/* 3 Status dots: Received, Verified, Usable */}
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="flex flex-col items-center">
                    <span className="text-[7px] text-slate-400">Recv</span>
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      doc.receivedAt ? 'bg-green-500 border-green-500' : 'bg-white border-slate-300'
                    }`} title={doc.receivedAt ? `${doc.receivedByName} — ${fmtDateTime(doc.receivedAt)}` : 'Not received'}>
                      {doc.receivedAt && <span className="text-white text-[8px]">✓</span>}
                    </div>
                    {doc.receivedAt && (
                      <div className="text-center">
                        <p className="text-[6px] text-slate-500 leading-tight">{doc.receivedByName}</p>
                        <p className="text-[6px] text-slate-400 leading-tight">{fmtDate(doc.receivedAt)}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-center">
                    <span className="text-[7px] text-slate-400">Verif</span>
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      doc.verifiedOn ? 'bg-green-500 border-green-500' : 'bg-white border-slate-300'
                    }`} title={doc.verifiedOn ? `${doc.verifiedByName} — ${fmtDateTime(doc.verifiedOn)}` : 'Not verified'}>
                      {doc.verifiedOn && <span className="text-white text-[8px]">✓</span>}
                    </div>
                    {doc.verifiedOn && (
                      <div className="text-center">
                        <p className="text-[6px] text-slate-500 leading-tight">{doc.verifiedByName}</p>
                        <p className="text-[6px] text-slate-400 leading-tight">{fmtDate(doc.verifiedOn)}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-center">
                    <span className="text-[7px] text-slate-400">Used</span>
                    <button onClick={() => !doc.utilisedOn && postAction({ action: 'utilise', documentId: doc.id, tabName: '' })}
                      disabled={!!doc.utilisedOn || !doc.verifiedOn}
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${
                        doc.utilisedOn ? 'bg-green-500 border-green-500' :
                        doc.verifiedOn ? 'bg-white border-slate-300 hover:border-blue-400 cursor-pointer' :
                        'bg-white border-slate-200 opacity-40'
                      }`} title={doc.utilisedOn ? `${doc.utilisedByName} — ${fmtDateTime(doc.utilisedOn)}${doc.utilisedTab ? ` (${doc.utilisedTab})` : ''}` : 'Mark as used'}>
                      {doc.utilisedOn && <span className="text-white text-[8px]">✓</span>}
                    </button>
                    {doc.utilisedOn && (
                      <div className="text-center">
                        <p className="text-[6px] text-slate-500 leading-tight">{doc.utilisedByName}</p>
                        <p className="text-[6px] text-slate-400 leading-tight">{fmtDate(doc.utilisedOn)}</p>
                        {doc.utilisedTab && <p className="text-[6px] text-blue-500 leading-tight">{doc.utilisedTab}</p>}
                      </div>
                    )}
                  </div>
                </div>

                {/* Upload + Delete */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {!doc.uploadedDate && (
                    <button onClick={() => { setUploadingDocId(doc.id); fileInputRef.current?.click(); }}
                      className="text-xs px-2 py-1 bg-emerald-50 text-emerald-600 rounded hover:bg-emerald-100">
                      {uploadingDocId === doc.id ? '...' : 'Upload'}
                    </button>
                  )}
                  <button onClick={() => deleteDocument(doc.id)} className="text-red-400 hover:text-red-600 text-sm">×</button>
                </div>
              </div>

              {/* Expanded detail with inline category editing */}
              {isExpanded && (
                <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/50">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs mb-3">
                    <div><span className="text-slate-400">Requested:</span> <span className="text-slate-600">{fmtDate(doc.requestedDate)} by {doc.requestedBy?.name || '—'}</span></div>
                    <div><span className="text-slate-400">Uploaded:</span> <span className="text-slate-600">{fmtDate(doc.uploadedDate)} by {doc.uploadedBy?.name || '—'}</span></div>
                    <div><span className="text-slate-400">From:</span> <span className="text-slate-600">{doc.requestedFrom || '—'}</span></div>
                    <div><span className="text-slate-400">File Type:</span> <span className="text-slate-600">{doc.mimeType || '—'}</span></div>
                    {mappedItems.length > 0 && (
                      <div className="col-span-2"><span className="text-slate-400">Mapped to:</span> <span className="text-slate-600">{mappedItems.join(', ')}</span></div>
                    )}
                  </div>
                  {/* Inline category editors */}
                  <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-200">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5 font-medium">Source</label>
                      <select value={doc.source || ''} onChange={e => updateCategory(doc.id, 'source', e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white">
                        <option value="">— None —</option>
                        {allSources.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5 font-medium">Usage Location</label>
                      <select value={doc.usageLocation || ''} onChange={e => updateCategory(doc.id, 'usageLocation', e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white">
                        <option value="">— None —</option>
                        {allLocations.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5 font-medium">Document Type</label>
                      <select value={doc.documentType || ''} onChange={e => updateCategory(doc.id, 'documentType', e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white">
                        <option value="">— None —</option>
                        {allDocTypes.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" className="hidden" onChange={e => {
        const file = e.target.files?.[0];
        if (file && uploadingDocId) handleFileUpload(uploadingDocId, file);
        e.target.value = '';
      }} />

      {/* Legend */}
      <div className="mt-3 flex items-center gap-6 text-[10px] text-slate-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" /> Pending</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> Uploaded</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-violet-100 text-violet-600 px-1 rounded text-[8px] inline-block">Source</span></span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-teal-100 text-teal-600 px-1 rounded text-[8px] inline-block">Location</span></span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-100 text-amber-600 px-1 rounded text-[8px] inline-block">Type</span></span>
      </div>
    </div>
  );
}
