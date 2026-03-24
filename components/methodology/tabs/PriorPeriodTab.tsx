'use client';

import { useState, useEffect, useCallback } from 'react';

interface Props {
  engagementId: string;
}

interface DocStatus {
  key: string;
  label: string;
  documentId: string | null;
  documentName: string | null;
  uploaded: boolean;
  storagePath: string | null;
}

interface RepoDocument {
  id: string;
  documentName: string;
  uploadedDate: string | null;
  storagePath: string | null;
}

const REVIEWABLE_DOCS = ['pp_letter_of_comment', 'pp_letter_of_representation', 'pp_financial_statements'];

export function PriorPeriodTab({ engagementId }: Props) {
  const [docStatus, setDocStatus] = useState<DocStatus[]>([]);
  const [repoDocuments, setRepoDocuments] = useState<RepoDocument[]>([]);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [linkingDoc, setLinkingDoc] = useState<string | null>(null); // which slot is being linked
  const [reviewingDoc, setReviewingDoc] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/prior-period`);
      if (res.ok) {
        const json = await res.json();
        setDocStatus(json.docStatus || []);
        setRepoDocuments(json.documents || []);
        setSummaries(json.summaries || {});
      }
    } catch (err) { console.error('Failed to load:', err); }
    finally { setLoading(false); }
  }, [engagementId]);

  useEffect(() => { loadData(); }, [loadData]);

  async function linkDocument(docKey: string, documentId: string) {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/prior-period`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'link_document', docKey, documentId }),
      });
      if (res.ok) {
        setLinkingDoc(null);
        await loadData();
      }
    } catch (err) { console.error('Link failed:', err); }
  }

  async function runAIReview(docKey: string, documentName: string) {
    setReviewingDoc(docKey);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/prior-period`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ai_review', docKey, documentName }),
      });
      if (res.ok) {
        const json = await res.json();
        setSummaries(prev => ({ ...prev, [docKey]: json.summary }));
      }
    } catch (err) { console.error('AI review failed:', err); }
    finally { setReviewingDoc(null); }
  }

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading Prior Period...</div>;

  return (
    <div className="space-y-6">
      {/* Required Documents */}
      <div className="space-y-3">
        {docStatus.map(doc => {
          const isLinked = !!doc.documentId;
          const isUploaded = doc.uploaded;
          const isReviewable = REVIEWABLE_DOCS.includes(doc.key);
          const hasSummary = !!summaries[doc.key];
          const isLinking = linkingDoc === doc.key;
          const isReviewing = reviewingDoc === doc.key;

          return (
            <div key={doc.key} className="border border-slate-200 rounded-lg overflow-hidden">
              {/* Document header */}
              <div className={`flex items-center justify-between px-4 py-3 ${
                isUploaded ? 'bg-green-50' : isLinked ? 'bg-blue-50' : 'bg-slate-50'
              }`}>
                <div className="flex items-center gap-3">
                  {/* Status icon */}
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                    isUploaded ? 'bg-green-500 text-white' : isLinked ? 'bg-blue-400 text-white' : 'bg-slate-300 text-white'
                  }`}>
                    {isUploaded ? '✓' : isLinked ? '↗' : '?'}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-slate-800">{doc.label}</p>
                    {isLinked && doc.documentName && (
                      <p className="text-[10px] text-slate-500">Linked: {doc.documentName}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Link from Documents button */}
                  <button
                    onClick={() => setLinkingDoc(isLinking ? null : doc.key)}
                    className="text-xs px-3 py-1 bg-white border border-slate-200 rounded hover:bg-slate-50 text-slate-600"
                  >
                    {isLinking ? 'Cancel' : isLinked ? 'Change' : '📎 Select from Documents'}
                  </button>

                  {/* AI Review button (only for reviewable docs that are linked) */}
                  {isReviewable && isLinked && (
                    <button
                      onClick={() => runAIReview(doc.key, doc.documentName || doc.label)}
                      disabled={isReviewing}
                      className="text-xs px-3 py-1 bg-purple-50 text-purple-600 border border-purple-200 rounded hover:bg-purple-100 disabled:opacity-50"
                    >
                      {isReviewing ? (
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-purple-400 animate-ping inline-block" />
                          Reviewing...
                        </span>
                      ) : hasSummary ? '🔄 Re-review with AI' : '🤖 AI Review'}
                    </button>
                  )}
                </div>
              </div>

              {/* Document picker dropdown */}
              {isLinking && (
                <div className="border-t border-slate-200 bg-white px-4 py-3 max-h-48 overflow-auto">
                  <p className="text-xs text-slate-500 mb-2">Select a document from the repository:</p>
                  {repoDocuments.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No documents in repository. Upload documents in the Documents tab first.</p>
                  ) : (
                    <div className="space-y-1">
                      {repoDocuments.map(rd => (
                        <button
                          key={rd.id}
                          onClick={() => linkDocument(doc.key, rd.id)}
                          className="w-full text-left px-3 py-2 text-xs rounded hover:bg-blue-50 flex items-center justify-between border border-slate-100"
                        >
                          <span className="text-slate-700">{rd.documentName}</span>
                          {rd.uploadedDate && (
                            <span className="text-[10px] text-slate-400">
                              {new Date(rd.uploadedDate).toLocaleDateString('en-GB')}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* AI Summary */}
              {hasSummary && (
                <div className="border-t border-slate-200 bg-purple-50/30 px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded font-medium">AI Review</span>
                    <span className="text-[10px] text-slate-400">
                      {doc.key === 'pp_financial_statements' ? 'Audit Opinion Summary' :
                       doc.key === 'pp_letter_of_comment' ? 'Key Points Summary' :
                       doc.key === 'pp_letter_of_representation' ? 'Key Representations Summary' : 'Summary'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {summaries[doc.key]}
                  </div>
                </div>
              )}

              {/* Not applicable notice for engagement letter */}
              {doc.key === 'pp_engagement_letter' && !REVIEWABLE_DOCS.includes(doc.key) && isLinked && (
                <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-2">
                  <p className="text-[10px] text-slate-400 italic">AI review not applicable — document retained for file completeness.</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 text-[10px] text-slate-400 pt-2">
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-green-500 inline-flex items-center justify-center text-white text-[8px]">✓</span>
          Uploaded & linked
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-blue-400 inline-flex items-center justify-center text-white text-[8px]">↗</span>
          Linked from repository
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-slate-300 inline-flex items-center justify-center text-white text-[8px]">?</span>
          Not yet linked
        </div>
      </div>
    </div>
  );
}
