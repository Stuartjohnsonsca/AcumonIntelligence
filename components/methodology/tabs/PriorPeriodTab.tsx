'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';

interface Props {
  engagementId: string;
  teamMembers?: { userId: string; userName?: string; role: string }[];
}

interface DocStatus {
  key: string; label: string; documentId: string | null; documentName: string | null; uploaded: boolean;
}

interface ReviewPoint {
  id: string; point: string; detail: string; notRelevant: boolean; carryForward: boolean;
  signOffs: { operator?: SignOff; reviewer?: SignOff; partner?: SignOff };
}

interface SignOff { userId: string; userName: string; timestamp: string; }

interface OBRow { account: string; amount: number | null; fsLineItem: string; }
interface FSMapping { fsLineItem: string; accounts: string[]; }

const REVIEWABLE = ['pp_letter_of_comment', 'pp_letter_of_representation', 'pp_financial_statements'];
const ROLE_MAP: Record<string, string> = { Junior: 'operator', Manager: 'reviewer', RI: 'partner' };

export function PriorPeriodTab({ engagementId, teamMembers = [] }: Props) {
  const { data: session } = useSession();
  const [docStatus, setDocStatus] = useState<DocStatus[]>([]);
  const [repoDocs, setRepoDocs] = useState<{ id: string; documentName: string; uploadedDate: string | null }[]>([]);
  const [points, setPoints] = useState<Record<string, ReviewPoint[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [linking, setLinking] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Opening Balances
  const [obRows, setObRows] = useState<OBRow[]>([]);
  const [obMapping, setObMapping] = useState<FSMapping[]>([]);
  const [obImporting, setObImporting] = useState(false);
  const [obExtractingFS, setObExtractingFS] = useState(false);
  const [obMode, setObMode] = useState<'blank' | 'paste' | 'data'>('blank');
  const [pasteText, setPasteText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentUserId = session?.user?.id;
  const canSignAs = (role: string) => currentUserId && teamMembers.some(m => ROLE_MAP[m.role] === role && m.userId === currentUserId);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/prior-period`);
      if (res.ok) {
        const json = await res.json();
        setDocStatus(json.docStatus || []);
        setRepoDocs(json.documents || []);
        setPoints(json.points || {});
        if (json.openingBalances?.rows) setObRows(json.openingBalances.rows);
        if (json.obMapping?.mapping) setObMapping(json.obMapping.mapping);
      }
    } catch (err) { console.error('Failed to load:', err); }
    finally { setLoading(false); }
  }, [engagementId]);

  useEffect(() => { loadData(); }, [loadData]);

  async function linkDocument(docKey: string, documentId: string) {
    await fetch(`/api/engagements/${engagementId}/prior-period`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'link_document', docKey, documentId }),
    });
    setLinking(null);
    loadData();
  }

  async function runAIReview(docKey: string, documentName: string) {
    setReviewing(docKey);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/prior-period`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ai_review', docKey, documentName }),
      });
      if (res.ok) { const json = await res.json(); setPoints(prev => ({ ...prev, [docKey]: json.points })); }
    } catch (err) { console.error('AI review failed:', err); }
    finally { setReviewing(null); }
  }

  async function updatePoints(docKey: string, updatedPoints: ReviewPoint[]) {
    setPoints(prev => ({ ...prev, [docKey]: updatedPoints }));
    await fetch(`/api/engagements/${engagementId}/prior-period`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_points', docKey, points: updatedPoints }),
    });
  }

  function signOffPoint(docKey: string, pointIdx: number, role: 'operator' | 'reviewer' | 'partner') {
    const pts = [...(points[docKey] || [])];
    const p = { ...pts[pointIdx] };
    const so: SignOff = { userId: currentUserId || '', userName: session?.user?.name || '', timestamp: new Date().toISOString() };
    const signOffs = { ...p.signOffs };
    if (role === 'partner') { signOffs.partner = so; signOffs.reviewer = so; signOffs.operator = so; }
    else if (role === 'reviewer') { signOffs.reviewer = so; signOffs.operator = so; }
    else { signOffs.operator = so; }
    p.signOffs = signOffs;
    pts[pointIdx] = p;
    updatePoints(docKey, pts);
  }

  // Opening Balances functions
  function parsePastedData() {
    const rows = pasteText.split('\n').filter(l => l.trim()).map(line => {
      const parts = line.split('\t');
      return { account: parts[0]?.trim() || '', amount: parseFloat(parts[1]) || null, fsLineItem: '' };
    });
    setObRows(rows);
    setObMode('data');
    saveOB(rows);
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = text.split('\n').filter(l => l.trim()).map(line => {
        const parts = line.split(/[,\t]/);
        return { account: parts[0]?.trim() || '', amount: parseFloat(parts[1]) || null, fsLineItem: '' };
      });
      setObRows(rows);
      setObMode('data');
      saveOB(rows);
    };
    reader.readAsText(file);
  }

  async function saveOB(rows: OBRow[]) {
    await fetch(`/api/engagements/${engagementId}/prior-period`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save_opening_balances', data: { rows } }),
    });
  }

  async function extractFSLines() {
    if (obRows.length === 0) return;
    setObExtractingFS(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/prior-period`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ai_extract_fs_lines', tbData: obRows.map(r => ({ account: r.account, amount: r.amount })) }),
      });
      if (res.ok) {
        const json = await res.json();
        setObMapping(json.mapping || []);
        // Auto-map rows
        const mapped = obRows.map(r => {
          const match = (json.mapping || []).find((m: FSMapping) => m.accounts.some((a: string) => a.toLowerCase() === r.account.toLowerCase()));
          return { ...r, fsLineItem: match?.fsLineItem || r.fsLineItem };
        });
        setObRows(mapped);
        saveOB(mapped);
      }
    } catch (err) { console.error('FS extraction failed:', err); }
    finally { setObExtractingFS(false); }
  }

  function addBlankOBRow() {
    setObRows(prev => [...prev, { account: '', amount: null, fsLineItem: '' }]);
  }

  function updateOBRow(idx: number, field: keyof OBRow, value: string | number | null) {
    setObRows(prev => {
      const updated = prev.map((r, i) => i === idx ? { ...r, [field]: value } : r);
      saveOB(updated);
      return updated;
    });
  }

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading Prior Period...</div>;

  return (
    <div className="space-y-6">
      {/* Document Sections */}
      {docStatus.map(doc => {
        const isLinked = !!doc.documentId;
        const isReviewable = REVIEWABLE.includes(doc.key);
        const docPoints = points[doc.key] || [];
        const isExpanded = expanded[doc.key] || false;
        const isReview = reviewing === doc.key;

        return (
          <div key={doc.key} className="border border-slate-200 rounded-lg overflow-hidden">
            {/* Header */}
            <div className={`flex items-center justify-between px-4 py-3 cursor-pointer ${isLinked ? 'bg-green-50' : 'bg-slate-50'}`}
              onClick={() => setExpanded(prev => ({ ...prev, [doc.key]: !prev[doc.key] }))}>
              <div className="flex items-center gap-3">
                <span className={`text-sm ${isExpanded ? '▼' : '▶'}`}>{isExpanded ? '▼' : '▶'}</span>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${isLinked ? 'bg-green-500 text-white' : 'bg-slate-300 text-white'}`}>
                  {isLinked ? '✓' : '?'}
                </span>
                <div>
                  <p className="text-sm font-medium text-slate-800">{doc.label}</p>
                  {isLinked && doc.documentName && <p className="text-[10px] text-slate-500">Linked: {doc.documentName}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                <button onClick={() => setLinking(linking === doc.key ? null : doc.key)}
                  className="text-xs px-3 py-1 bg-white border border-slate-200 rounded hover:bg-slate-50 text-slate-600">
                  {linking === doc.key ? 'Cancel' : isLinked ? 'Change' : '📎 Select'}
                </button>
                {isReviewable && isLinked && (
                  <button onClick={() => runAIReview(doc.key, doc.documentName || doc.label)} disabled={isReview}
                    className="text-xs px-3 py-1 bg-purple-50 text-purple-600 border border-purple-200 rounded hover:bg-purple-100 disabled:opacity-50">
                    {isReview ? '⏳ Reviewing...' : docPoints.length > 0 ? '🔄 Re-review' : '🤖 AI Review'}
                  </button>
                )}
              </div>
            </div>

            {/* Document picker */}
            {linking === doc.key && (
              <div className="border-t border-slate-200 bg-white px-4 py-3 max-h-40 overflow-auto">
                <p className="text-xs text-slate-500 mb-2">Select from repository:</p>
                {repoDocs.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No documents. Upload in Documents tab first.</p>
                ) : repoDocs.map(rd => (
                  <button key={rd.id} onClick={() => linkDocument(doc.key, rd.id)}
                    className="w-full text-left px-3 py-2 text-xs rounded hover:bg-blue-50 flex items-center justify-between border border-slate-100 mb-1">
                    <span className="text-slate-700">{rd.documentName}</span>
                    {rd.uploadedDate && <span className="text-[10px] text-slate-400">{new Date(rd.uploadedDate).toLocaleDateString('en-GB')}</span>}
                  </button>
                ))}
              </div>
            )}

            {/* Expanded: Points list */}
            {isExpanded && docPoints.length > 0 && (
              <div className="border-t border-slate-200">
                {docPoints.map((pt, idx) => (
                  <div key={pt.id} className={`flex border-b border-slate-100 last:border-b-0 ${pt.notRelevant ? 'opacity-50' : ''}`}>
                    {/* Left 2/3: Point detail */}
                    <div className="w-2/3 px-4 py-2.5 border-r border-slate-100">
                      <p className="text-xs font-medium text-slate-700 mb-0.5">{pt.point}</p>
                      <p className="text-xs text-slate-600 leading-relaxed">{pt.detail}</p>
                    </div>
                    {/* Right 1/3: Checkboxes + dots */}
                    <div className="w-1/3 px-3 py-2.5 flex items-start justify-between">
                      {/* Checkboxes */}
                      <div className="space-y-1.5">
                        <label className="flex items-center gap-1.5 text-[10px] text-slate-600 cursor-pointer">
                          <input type="checkbox" checked={pt.notRelevant}
                            onChange={() => { const pts = [...docPoints]; pts[idx] = { ...pt, notRelevant: !pt.notRelevant }; updatePoints(doc.key, pts); }}
                            className="w-3 h-3 rounded" />
                          Not Relevant
                        </label>
                        <label className="flex items-center gap-1.5 text-[10px] text-slate-600 cursor-pointer">
                          <input type="checkbox" checked={pt.carryForward}
                            onChange={() => { const pts = [...docPoints]; pts[idx] = { ...pt, carryForward: !pt.carryForward }; updatePoints(doc.key, pts); }}
                            className="w-3 h-3 rounded" />
                          Carry Forward
                        </label>
                      </div>
                      {/* 3 sign-off dots */}
                      <div className="flex gap-1.5">
                        {(['operator', 'reviewer', 'partner'] as const).map(role => {
                          const so = pt.signOffs[role];
                          const can = canSignAs(role);
                          return (
                            <div key={role} className="flex flex-col items-center">
                              <span className="text-[7px] text-slate-400 mb-0.5">{role === 'operator' ? 'O' : role === 'reviewer' ? 'R' : 'P'}</span>
                              <button onClick={() => can && signOffPoint(doc.key, idx, role)} disabled={!can}
                                className={`w-3.5 h-3.5 rounded-full border-2 transition-all ${
                                  so ? 'bg-green-500 border-green-500' : can ? 'bg-white border-slate-300 hover:border-blue-400' : 'bg-white border-slate-200 opacity-40'
                                }`}
                                title={so ? `${so.userName} ${new Date(so.timestamp).toLocaleDateString('en-GB')}` : `${role} sign-off`} />
                              {so && <span className="text-[6px] text-slate-400 mt-0.5 truncate max-w-[30px]">{so.userName.split(' ')[0]}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {isExpanded && docPoints.length === 0 && isReviewable && isLinked && (
              <div className="border-t border-slate-200 px-4 py-4 text-center text-xs text-slate-400">
                Click <span className="text-purple-500 font-medium">🤖 AI Review</span> to extract key points from this document.
              </div>
            )}
          </div>
        );
      })}

      {/* Opening Balances Section */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-blue-50 px-4 py-3 border-b border-blue-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-blue-800">Opening Balances</h3>
          <div className="flex items-center gap-2">
            {/* 3 approval dots at heading level */}
            {(['operator', 'reviewer', 'partner'] as const).map(role => (
              <div key={role} className="flex flex-col items-center">
                <span className="text-[8px] text-slate-500">{role === 'operator' ? 'Operator' : role === 'reviewer' ? 'Reviewer' : 'Partner'}</span>
                <div className="w-4 h-4 rounded-full border-2 bg-white border-slate-300" />
              </div>
            ))}
          </div>
        </div>

        {/* Import options */}
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-600 font-medium mr-2">Populate from:</span>
          <button onClick={() => { setObMode('paste'); }} className="text-xs px-3 py-1.5 bg-white border border-slate-200 rounded hover:bg-slate-50">📋 Paste</button>
          <button onClick={() => { setObRows([]); setObMode('data'); addBlankOBRow(); }} className="text-xs px-3 py-1.5 bg-white border border-slate-200 rounded hover:bg-slate-50">📄 Blank Spreadsheet</button>
          <button onClick={() => fileInputRef.current?.click()} className="text-xs px-3 py-1.5 bg-white border border-slate-200 rounded hover:bg-slate-50">📤 Upload Spreadsheet</button>
          <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt" onChange={handleFileUpload} className="hidden" />
          <button disabled className="text-xs px-3 py-1.5 bg-white border border-slate-200 rounded text-slate-400 cursor-not-allowed">🔗 Import from Xero</button>
          {obRows.length > 0 && (
            <button onClick={extractFSLines} disabled={obExtractingFS}
              className="text-xs px-3 py-1.5 bg-purple-50 text-purple-600 border border-purple-200 rounded hover:bg-purple-100 disabled:opacity-50 ml-auto">
              {obExtractingFS ? '⏳ Extracting...' : '🤖 AI Map to FS Lines'}
            </button>
          )}
        </div>

        {/* Paste area */}
        {obMode === 'paste' && (
          <div className="px-4 py-3 border-b border-slate-200">
            <p className="text-xs text-slate-500 mb-2">Paste tab-separated data (Account ⇥ Amount):</p>
            <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
              className="w-full border border-slate-200 rounded px-3 py-2 text-xs min-h-[100px] font-mono focus:outline-none focus:ring-1 focus:ring-blue-300"
              placeholder="Account Name\tAmount\nCash at Bank\t125000\nTrade Debtors\t45000" />
            <div className="flex gap-2 mt-2">
              <button onClick={parsePastedData} className="text-xs px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600">Import Pasted Data</button>
              <button onClick={() => setObMode('blank')} className="text-xs px-3 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200">Cancel</button>
            </div>
          </div>
        )}

        {/* Spreadsheet */}
        {(obMode === 'data' || obRows.length > 0) && (
          <div className="overflow-auto max-h-[400px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100">
                <tr className="border-b border-slate-200">
                  <th className="text-left px-3 py-2 text-slate-500 font-medium w-2/5">Account</th>
                  <th className="text-right px-3 py-2 text-slate-500 font-medium w-1/5">Amount (£)</th>
                  <th className="text-left px-3 py-2 text-slate-500 font-medium w-2/5">FS Line Item</th>
                </tr>
              </thead>
              <tbody>
                {obRows.map((row, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/30">
                    <td className="px-3 py-1">
                      <input type="text" value={row.account} onChange={e => updateOBRow(i, 'account', e.target.value)}
                        className="w-full border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5" />
                    </td>
                    <td className="px-3 py-1">
                      <input type="number" value={row.amount ?? ''} onChange={e => updateOBRow(i, 'amount', e.target.value ? Number(e.target.value) : null)}
                        className="w-full border-0 bg-transparent text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5" />
                    </td>
                    <td className="px-3 py-1">
                      <input type="text" value={row.fsLineItem} onChange={e => updateOBRow(i, 'fsLineItem', e.target.value)}
                        className={`w-full border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 ${row.fsLineItem ? 'text-blue-600' : ''}`}
                        placeholder="—" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-3 py-2 border-t border-slate-200 bg-slate-50">
              <button onClick={addBlankOBRow} className="text-xs text-blue-500 hover:text-blue-700">+ Add Row</button>
            </div>
          </div>
        )}

        {/* AI Mapping results */}
        {obMapping.length > 0 && (
          <div className="border-t border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded font-medium">AI Mapping</span>
              <span className="text-[10px] text-slate-400">TB Accounts → FS Line Items</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {obMapping.map((m, i) => (
                <div key={i} className="border border-slate-100 rounded p-2">
                  <p className="text-xs font-medium text-blue-700 mb-1">{m.fsLineItem}</p>
                  <div className="flex flex-wrap gap-1">
                    {m.accounts.map((a, j) => (
                      <span key={j} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{a}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
