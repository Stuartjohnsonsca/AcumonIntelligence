'use client';

import { useState, useEffect, useCallback } from 'react';

interface Props {
  engagementId: string;
  clientName: string;
}

interface PortalDocument {
  id: string;
  documentName: string;
  requestedFrom: string | null;
  requestedDate: string | null;
  uploadedDate: string | null;
  verifiedOn: string | null;
}

interface InfoRequest {
  id: string;
  description: string;
  isIncluded: boolean;
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function ClientPortalTab({ engagementId, clientName }: Props) {
  const [documents, setDocuments] = useState<PortalDocument[]>([]);
  const [infoRequests, setInfoRequests] = useState<InfoRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [docsRes, irRes] = await Promise.all([
        fetch(`/api/engagements/${engagementId}/documents`),
        fetch(`/api/engagements/${engagementId}/info-requests`),
      ]);
      if (docsRes.ok) { const data = await docsRes.json(); setDocuments(data.documents || []); }
      if (irRes.ok) { const data = await irRes.json(); setInfoRequests((data.requests || []).filter((r: InfoRequest) => r.isIncluded)); }
    } catch (err) { console.error('Failed to load portal data:', err); }
    finally { setLoading(false); }
  }, [engagementId]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading Client Portal view...</div>;

  const pendingDocs = documents.filter(d => !d.uploadedDate);
  const uploadedDocs = documents.filter(d => d.uploadedDate);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Client Portal View</h2>
          <p className="text-xs text-slate-400">Read-only preview of what {clientName} sees in their portal</p>
        </div>
        <span className="inline-flex items-center px-2 py-1 rounded-full bg-amber-100 text-amber-700 text-[10px] font-medium">
          👁 READ ONLY
        </span>
      </div>

      {/* Simulated portal interface */}
      <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 bg-slate-50/50">
        {/* Portal Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg p-4 mb-6 text-white">
          <h3 className="text-lg font-semibold">Welcome, {clientName}</h3>
          <p className="text-sm text-blue-100 mt-1">Audit engagement portal — view and manage document requests</p>
        </div>

        {/* Information Requests */}
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-slate-700 mb-2">Information Requested</h4>
          <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100">
            {infoRequests.length === 0 ? (
              <div className="p-4 text-xs text-slate-400 text-center italic">No information requests</div>
            ) : infoRequests.map((ir, i) => (
              <div key={ir.id} className="px-4 py-2 flex items-center gap-3">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-[10px] flex items-center justify-center font-medium">{i + 1}</span>
                <span className="text-sm text-slate-700">{ir.description}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Pending Documents */}
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-slate-700 mb-2">
            Documents Awaiting Upload
            {pendingDocs.length > 0 && (
              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[10px] font-medium">
                {pendingDocs.length} pending
              </span>
            )}
          </h4>
          <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100">
            {pendingDocs.length === 0 ? (
              <div className="p-4 text-xs text-slate-400 text-center italic">All documents uploaded</div>
            ) : pendingDocs.map(doc => (
              <div key={doc.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <span className="text-sm text-slate-700 font-medium">{doc.documentName}</span>
                  {doc.requestedFrom && <span className="text-xs text-slate-400 ml-2">from {doc.requestedFrom}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400">Requested {formatDate(doc.requestedDate)}</span>
                  <span className="px-2 py-0.5 rounded bg-orange-100 text-orange-600 text-[10px] font-medium">Pending</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Uploaded Documents */}
        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-2">Uploaded Documents</h4>
          <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100">
            {uploadedDocs.length === 0 ? (
              <div className="p-4 text-xs text-slate-400 text-center italic">No documents uploaded yet</div>
            ) : uploadedDocs.map(doc => (
              <div key={doc.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <span className="text-sm text-slate-700">{doc.documentName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400">Uploaded {formatDate(doc.uploadedDate)}</span>
                  {doc.verifiedOn ? (
                    <span className="px-2 py-0.5 rounded bg-green-100 text-green-600 text-[10px] font-medium">Verified</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-600 text-[10px] font-medium">Under Review</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
