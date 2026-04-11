'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { Loader2, Upload, ChevronDown, ChevronUp, AlertTriangle, FileText, RefreshCw, Trash2, Eye } from 'lucide-react';
import { expandZipFiles } from '@/lib/client-unzip';

interface HeadingExtraction {
  content: string;
  flagged: boolean;
}

interface ShareholdersRecord {
  id: string;
  title: string;
  meetingDate: string;
  minutes: { headings: Record<string, HeadingExtraction>; otherMatters?: string } | null;
  minutesStatus: string;
  hasTranscript: boolean;
  createdBy: string;
  createdAt: string;
  signOffs: Record<string, { userId: string; userName: string; timestamp: string }>;
  /** Azure blob path of the original uploaded file, set when source === 'upload' */
  storagePath?: string | null;
  /** Original filename (for the Open button tooltip) */
  originalFileName?: string | null;
}

interface PeriodSummary {
  headings: Record<string, string>;
  overallSummary: string;
}

interface CarryForwardItem {
  heading: string;
  issue: string;
  firstMentionedDate: string;
  latestMentionDate: string;
  status: 'recurring' | 'unresolved' | 'new';
}

interface Props {
  engagementId: string;
}

const SIGN_OFF_ROLES = [
  { key: 'preparer', label: 'Preparer' },
  { key: 'reviewer', label: 'Reviewer' },
  { key: 'ri', label: 'RI' },
];

function fmtDate(d: string) { try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return d; } }

export function ShareholdersPanel({ engagementId }: Props) {
  const { data: session } = useSession();
  const [records, setRecords] = useState<ShareholdersRecord[]>([]);
  const [headings, setHeadings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRecord, setExpandedRecord] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  // Blank by default — the AI extracts the meeting date from the document text
  // and the server falls back to that when this is empty.
  const [uploadDate, setUploadDate] = useState('');
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadErrors, setUploadErrors] = useState<Array<{ fileName: string; error: string }>>([]);
  const [uploadSuccessCount, setUploadSuccessCount] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Period summary state
  const [periodSummary, setPeriodSummary] = useState<PeriodSummary | null>(null);
  const [carryForward, setCarryForward] = useState<CarryForwardItem[]>([]);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  const loadRecords = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/board-minutes?type=shareholders`);
      if (res.ok) {
        const data = await res.json();
        setRecords(data.records || []);
        setHeadings(data.headings || []);
      }
    } catch {}
    setLoading(false);
  }, [engagementId]);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  async function handleUpload() {
    const files = fileInputRef.current?.files;
    if (!files?.length) return;

    setUploading(true);
    setUploadErrors([]);
    setUploadSuccessCount(null);

    // Expand any .zip files: each archive member becomes its own upload as if
    // the user had selected it directly. Non-zip files pass through unchanged.
    const expanded = await expandZipFiles(Array.from(files));
    console.log(`[ShareholdersPanel] Uploading ${expanded.length} file(s) (expanded from ${files.length}):`, expanded.map(f => f.name));

    const formData = new FormData();
    formData.append('type', 'shareholders');
    // Only send a meeting date if the user explicitly chose one. When blank,
    // the server uses the date the AI extracts from the document text.
    if (uploadDate) formData.append('meetingDate', uploadDate);
    if (uploadTitle.trim()) formData.append('title', uploadTitle.trim());
    for (const file of expanded) formData.append('files', file);

    try {
      const res = await fetch(`/api/engagements/${engagementId}/board-minutes`, {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        const successCount = Array.isArray(data.results) ? data.results.length : 0;
        const errs = Array.isArray(data.errors) ? data.errors : [];
        setUploadSuccessCount(successCount);
        setUploadErrors(errs);

        // Only hide the upload form if everything succeeded and there's at least one success
        if (errs.length === 0 && successCount > 0) {
          setShowUpload(false);
          setUploadTitle('');
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
        await loadRecords();
      } else {
        const errText = await res.text().catch(() => '');
        setUploadErrors([{ fileName: '(all)', error: `Upload failed: ${res.status} ${errText.slice(0, 200)}` }]);
      }
    } catch (err: any) {
      setUploadErrors([{ fileName: '(network)', error: err?.message || 'Network error' }]);
    }
    setUploading(false);
  }

  async function handleRegenerate(meetingId: string) {
    setRegenerating(true);
    try {
      await fetch(`/api/engagements/${engagementId}/board-minutes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'regenerate', meetingId }),
      });
      await loadRecords();
    } catch {}
    setRegenerating(false);
  }

  async function handleDelete(meetingId: string) {
    if (!confirm('Delete this shareholder meeting record?')) return;
    await fetch(`/api/engagements/${engagementId}/board-minutes`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId }),
    });
    await loadRecords();
  }

  async function handleSignOff(meetingId: string, role: string) {
    const record = records.find(r => r.id === meetingId);
    if (!record) return;
    const existing = record.signOffs[role];
    const isUnsigning = existing?.userId === session?.user?.id;
    const res = await fetch(`/api/engagements/${engagementId}/board-minutes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: isUnsigning ? 'unsignoff' : 'signoff', meetingId, role }),
    });
    if (res.ok) {
      const data = await res.json();
      setRecords(prev => prev.map(r => r.id === meetingId ? { ...r, signOffs: data.signOffs } : r));
    }
  }

  async function handleOpenDocument(record: ShareholdersRecord) {
    if (!record.storagePath) return;
    try {
      const res = await fetch(`/api/portal/download?storagePath=${encodeURIComponent(record.storagePath)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.url) window.open(data.url, '_blank');
    } catch {}
  }

  async function handleGeneratePeriodSummary() {
    setGeneratingSummary(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/board-minutes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'period_summary', type: 'shareholders' }),
      });
      if (res.ok) {
        const data = await res.json();
        setPeriodSummary(data.summary || null);
        setCarryForward(data.carryForward || []);
        setShowSummary(true);
      }
    } catch {}
    setGeneratingSummary(false);
  }

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading shareholder meetings...</div>;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700">
          Shareholder Meetings <span className="text-xs font-normal text-slate-400 ml-1">{records.length}</span>
        </h3>
        <div className="flex gap-2">
          {records.length >= 2 && (
            <button onClick={handleGeneratePeriodSummary} disabled={generatingSummary}
              className="text-[10px] px-3 py-1.5 bg-purple-50 text-purple-600 border border-purple-200 rounded hover:bg-purple-100 disabled:opacity-50">
              {generatingSummary ? 'Generating...' : 'Period Summary'}
            </button>
          )}
          <button onClick={() => setShowUpload(!showUpload)}
            className="text-[10px] px-3 py-1.5 bg-blue-50 text-blue-600 border border-blue-200 rounded hover:bg-blue-100">
            <Upload className="h-3 w-3 inline mr-1" />Upload Minutes
          </button>
        </div>
      </div>

      {/* Upload form */}
      {showUpload && (
        <div className="mb-4 border border-blue-200 rounded-lg p-3 bg-blue-50/30">
          <div className="grid grid-cols-3 gap-3 mb-2">
            <div>
              <label className="block text-[10px] text-slate-500 mb-0.5">Title (optional)</label>
              <input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)}
                className="w-full text-xs border border-slate-200 rounded px-2 py-1.5" placeholder="e.g. Board Meeting — March 2025" />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-0.5">Meeting Date <span className="text-slate-400">(auto-detected if blank)</span></label>
              <input type="date" value={uploadDate} onChange={e => setUploadDate(e.target.value)}
                className="w-full text-xs border border-slate-200 rounded px-2 py-1.5" />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-0.5">PDF / DOCX Files</label>
              <input ref={fileInputRef} type="file" multiple accept=".pdf,.docx,.doc,.txt,.zip"
                className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 file:mr-2 file:py-0.5 file:px-2 file:rounded file:border-0 file:text-xs file:bg-blue-50 file:text-blue-600" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleUpload} disabled={uploading}
              className="text-[10px] px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
              {uploading ? 'Uploading & Extracting...' : 'Upload & Extract'}
            </button>
            <button onClick={() => setShowUpload(false)} className="text-[10px] px-3 py-1.5 bg-slate-100 text-slate-600 rounded">Cancel</button>
          </div>

          {/* Per-file upload errors and success count */}
          {(uploadSuccessCount !== null || uploadErrors.length > 0) && (
            <div className="mt-3 space-y-1">
              {uploadSuccessCount !== null && uploadSuccessCount > 0 && (
                <p className="text-[10px] text-green-700">
                  ✓ {uploadSuccessCount} file{uploadSuccessCount === 1 ? '' : 's'} uploaded and extracted successfully.
                </p>
              )}
              {uploadErrors.length > 0 && (
                <div className="text-[10px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                  <p className="font-semibold mb-1">
                    ⚠ {uploadErrors.length} file{uploadErrors.length === 1 ? '' : 's'} failed:
                  </p>
                  <ul className="space-y-0.5">
                    {uploadErrors.map((e, i) => (
                      <li key={i}><span className="font-mono">{e.fileName}</span>: {e.error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Period Summary */}
      {showSummary && periodSummary && (
        <div className="mb-4 border border-purple-200 rounded-lg p-3 bg-purple-50/30">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-purple-700">Period Summary</h4>
            <button onClick={() => setShowSummary(false)} className="text-xs text-slate-400">Close</button>
          </div>
          <p className="text-xs text-slate-700 mb-3">{periodSummary.overallSummary}</p>
          {Object.entries(periodSummary.headings).map(([heading, summary]) => (
            <div key={heading} className="mb-2">
              <p className="text-[10px] font-semibold text-slate-600">{heading}</p>
              <p className="text-[10px] text-slate-500">{summary || 'No matters identified'}</p>
            </div>
          ))}
          {carryForward.length > 0 && (
            <div className="mt-3 pt-3 border-t border-purple-200">
              <h4 className="text-[10px] font-semibold text-amber-700 mb-1">Matters from Earlier Periods ({carryForward.length})</h4>
              <table className="w-full text-[10px] border border-slate-200 rounded overflow-hidden">
                <thead><tr className="bg-slate-100">
                  <th className="px-2 py-1 text-left text-slate-500">Heading</th>
                  <th className="px-2 py-1 text-left text-slate-500">Issue</th>
                  <th className="px-2 py-1 text-left text-slate-500 w-20">Status</th>
                  <th className="px-2 py-1 text-left text-slate-500 w-24">First Seen</th>
                </tr></thead>
                <tbody>
                  {carryForward.map((cf, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-2 py-1 text-slate-600">{cf.heading}</td>
                      <td className="px-2 py-1 text-slate-700">{cf.issue}</td>
                      <td className="px-2 py-1">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] ${
                          cf.status === 'recurring' ? 'bg-red-100 text-red-600' :
                          cf.status === 'unresolved' ? 'bg-amber-100 text-amber-600' :
                          'bg-blue-100 text-blue-600'
                        }`}>{cf.status}</span>
                      </td>
                      <td className="px-2 py-1 text-slate-400">{cf.firstMentionedDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Records list */}
      <div className="space-y-2">
        {records.length === 0 ? (
          <div className="text-center py-12 border border-slate-200 rounded-lg">
            <FileText className="h-10 w-10 mx-auto mb-3 text-slate-300" />
            <p className="text-sm text-slate-400">No shareholder meetings uploaded yet</p>
            <p className="text-xs text-slate-300 mt-1">Upload PDF or DOCX files of shareholder meetings</p>
          </div>
        ) : records.map(record => {
          const isExpanded = expandedRecord === record.id;
          const mins = record.minutes;
          const hasFlagged = mins && Object.values(mins.headings || {}).some(h => h.flagged);

          return (
            <div key={record.id} className="border border-slate-200 rounded-lg overflow-hidden">
              {/* Record row */}
              <div className="flex items-center px-3 py-2.5 hover:bg-slate-50/50 gap-3 cursor-pointer"
                onClick={() => setExpandedRecord(isExpanded ? null : record.id)}>
                <FileText className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-slate-700">{record.title}</span>
                  <span className="text-[10px] text-slate-400 ml-2">{fmtDate(record.meetingDate)}</span>
                </div>
                {hasFlagged && <span title="Flagged items"><AlertTriangle className="h-3.5 w-3.5 text-amber-500" /></span>}
                {record.storagePath && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleOpenDocument(record); }}
                    className="text-blue-500 hover:text-blue-700"
                    title={record.originalFileName ? `Open "${record.originalFileName}"` : 'Open original document'}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                )}
                <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                  record.minutesStatus === 'signed_off' ? 'bg-green-100 text-green-600' :
                  record.minutesStatus === 'generated' ? 'bg-blue-100 text-blue-600' :
                  'bg-slate-100 text-slate-500'
                }`}>{record.minutesStatus === 'generated' ? 'Extracted' : record.minutesStatus}</span>
                <div className="flex items-center gap-1">
                  {SIGN_OFF_ROLES.map(({ key }) => (
                    <span key={key} className={`w-2 h-2 rounded-full ${record.signOffs[key] ? 'bg-green-500' : 'border border-slate-300'}`} />
                  ))}
                </div>
                {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-slate-200 px-4 py-3 bg-slate-50/30 space-y-4">
                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleRegenerate(record.id)} disabled={regenerating}
                      className="text-[10px] px-3 py-1.5 bg-slate-100 text-slate-600 rounded hover:bg-slate-200 disabled:opacity-50">
                      <RefreshCw className="h-3 w-3 inline mr-1" />{regenerating ? 'Regenerating...' : 'Re-extract'}
                    </button>
                    <button onClick={() => handleDelete(record.id)}
                      className="text-[10px] px-3 py-1.5 bg-red-50 text-red-600 rounded hover:bg-red-100">
                      <Trash2 className="h-3 w-3 inline mr-1" />Delete
                    </button>
                  </div>

                  {/* Extracted headings */}
                  {mins?.headings && (
                    <div className="space-y-2">
                      {headings.map(heading => {
                        const entry = mins.headings[heading];
                        if (!entry) return null;
                        return (
                          <div key={heading} className={`border rounded-lg p-2.5 ${entry.flagged ? 'border-amber-300 bg-amber-50/30' : 'border-slate-200'}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] font-semibold text-slate-600">{heading}</span>
                              {entry.flagged && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                            </div>
                            <p className="text-[10px] text-slate-500">{entry.content || 'No matters identified'}</p>
                          </div>
                        );
                      })}
                      {mins.otherMatters && (
                        <div className="border border-slate-200 rounded-lg p-2.5">
                          <span className="text-[10px] font-semibold text-slate-600">Other Matters</span>
                          <p className="text-[10px] text-slate-500 mt-1">{mins.otherMatters}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {!mins && (
                    <p className="text-[10px] text-slate-400 italic">No extraction available. Click "Re-extract" to process.</p>
                  )}

                  {/* Sign-off bar */}
                  <div className="pt-3 border-t border-slate-200">
                    <div className="flex items-center gap-6">
                      {SIGN_OFF_ROLES.map(({ key, label }) => {
                        const so = record.signOffs[key] as { userId: string; userName: string; timestamp: string } | undefined;
                        const hasSigned = !!so?.timestamp;
                        return (
                          <div key={key} className="flex flex-col items-center gap-1">
                            <span className="text-[10px] text-slate-500 font-medium">{label}</span>
                            <button onClick={() => handleSignOff(record.id, key)}
                              className={`w-5 h-5 rounded-full border-2 transition-all ${
                                hasSigned ? 'bg-green-500 border-green-500' : 'bg-white border-slate-300 hover:border-blue-400 cursor-pointer'
                              }`}
                              title={hasSigned ? `${so!.userName} — ${new Date(so!.timestamp).toLocaleString()}` : `Sign off as ${label}`}
                            />
                            {hasSigned && (
                              <div className="text-center">
                                <p className="text-[9px] text-slate-600">{so!.userName}</p>
                                <p className="text-[8px] text-slate-400">{new Date(so!.timestamp).toLocaleDateString('en-GB')}</p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
