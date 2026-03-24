'use client';

import { useState, useEffect, useCallback } from 'react';

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
  verifiedOn: string | null;
  utilisedOn: string | null;
  createdAt: string;
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function DocumentRepositoryTab({ engagementId }: Props) {
  const [documents, setDocuments] = useState<AuditDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [newDocName, setNewDocName] = useState('');
  const [newDocFrom, setNewDocFrom] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadDocuments = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/documents`);
      if (res.ok) { const data = await res.json(); setDocuments(data.documents || []); }
    } catch (err) { console.error('Failed to load documents:', err); }
    finally { setLoading(false); }
  }, [engagementId]);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  async function requestDocument() {
    if (!newDocName.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request', documentName: newDocName.trim(), requestedFrom: newDocFrom.trim() || null }),
      });
      if (res.ok) {
        await loadDocuments();
        setNewDocName('');
        setNewDocFrom('');
        setShowRequestForm(false);
      }
    } catch (err) { console.error('Failed to request document:', err); }
    finally { setSubmitting(false); }
  }

  async function markVerified(docId: string) {
    try {
      await fetch(`/api/engagements/${engagementId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', documentId: docId }),
      });
      await loadDocuments();
    } catch (err) { console.error('Failed to verify:', err); }
  }

  async function markUtilised(docId: string) {
    try {
      await fetch(`/api/engagements/${engagementId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'utilise', documentId: docId }),
      });
      await loadDocuments();
    } catch (err) { console.error('Failed to mark utilised:', err); }
  }

  async function deleteDocument(docId: string) {
    if (!confirm('Remove this document request?')) return;
    try {
      await fetch(`/api/engagements/${engagementId}/documents`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: docId }),
      });
      await loadDocuments();
    } catch (err) { console.error('Failed to delete:', err); }
  }

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading Documents...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-slate-800">Document Repository</h2>
        <button
          onClick={() => setShowRequestForm(!showRequestForm)}
          className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 font-medium"
        >
          + Request Document
        </button>
      </div>

      {/* Request Form */}
      {showRequestForm && (
        <div className="mb-4 border border-blue-200 rounded-lg p-4 bg-blue-50/30">
          <h3 className="text-sm font-medium text-slate-700 mb-2">New Document Request</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Document Name *</label>
              <input
                type="text"
                value={newDocName}
                onChange={e => setNewDocName(e.target.value)}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                placeholder="e.g. Bank Confirmation Letter"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Requested From</label>
              <input
                type="text"
                value={newDocFrom}
                onChange={e => setNewDocFrom(e.target.value)}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                placeholder="e.g. Client, Bank, Solicitor"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={requestDocument}
              disabled={!newDocName.trim() || submitting}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {submitting ? 'Requesting...' : 'Create Request'}
            </button>
            <button
              onClick={() => setShowRequestForm(false)}
              className="text-xs px-3 py-1.5 bg-slate-100 text-slate-600 rounded hover:bg-slate-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Documents Table */}
      <div className="border border-slate-200 rounded-lg overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-200">
              <th className="text-left px-3 py-2 text-slate-500 font-medium">Document Name</th>
              <th className="text-left px-3 py-2 text-slate-500 font-medium w-28">Requested From</th>
              <th className="text-left px-3 py-2 text-slate-500 font-medium w-24">Requested Date</th>
              <th className="text-left px-3 py-2 text-slate-500 font-medium w-24">Requested By</th>
              <th className="text-left px-3 py-2 text-slate-500 font-medium w-24">Uploaded Date</th>
              <th className="text-left px-3 py-2 text-slate-500 font-medium w-24">Uploaded By</th>
              <th className="text-center px-3 py-2 text-slate-500 font-medium w-24">Verified</th>
              <th className="text-center px-3 py-2 text-slate-500 font-medium w-24">Utilised</th>
              <th className="w-12"></th>
            </tr>
          </thead>
          <tbody>
            {documents.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-8 text-slate-400 italic">No documents. Click &quot;Request Document&quot; to begin.</td></tr>
            ) : documents.map(doc => (
              <tr key={doc.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${doc.uploadedDate ? 'bg-green-400' : 'bg-orange-400'}`} />
                    <span className="text-slate-700 font-medium">{doc.documentName}</span>
                    {doc.fileSize && (
                      <span className="text-[10px] text-slate-400">({(doc.fileSize / 1024).toFixed(0)}KB)</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-slate-500">{doc.requestedFrom || '—'}</td>
                <td className="px-3 py-2 text-slate-500">{formatDate(doc.requestedDate)}</td>
                <td className="px-3 py-2 text-slate-500">{doc.requestedBy?.name || '—'}</td>
                <td className="px-3 py-2 text-slate-500">{formatDate(doc.uploadedDate)}</td>
                <td className="px-3 py-2 text-slate-500">{doc.uploadedBy?.name || '—'}</td>
                <td className="px-3 py-2 text-center">
                  {doc.verifiedOn ? (
                    <span className="text-green-600" title={formatDateTime(doc.verifiedOn)}>✓ {formatDate(doc.verifiedOn)}</span>
                  ) : doc.uploadedDate ? (
                    <button onClick={() => markVerified(doc.id)} className="text-blue-500 hover:text-blue-700 underline">Verify</button>
                  ) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2 text-center">
                  {doc.utilisedOn ? (
                    <span className="text-green-600" title={formatDateTime(doc.utilisedOn)}>✓ {formatDate(doc.utilisedOn)}</span>
                  ) : doc.verifiedOn ? (
                    <button onClick={() => markUtilised(doc.id)} className="text-blue-500 hover:text-blue-700 underline">Utilise</button>
                  ) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2">
                  <button onClick={() => deleteDocument(doc.id)} className="text-red-400 hover:text-red-600">×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex items-center gap-4 text-[10px] text-slate-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" /> Pending upload</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> Uploaded</span>
        <span>{documents.length} document{documents.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
}
