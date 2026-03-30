'use client';

import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, X, Copy, Loader2, Save, Download, Upload, Pencil, Trash2 } from 'lucide-react';
import { MANDATORY_FS_LINES, ASSERTION_TYPES } from '@/types/methodology';

// Map test type names → code snippet function names (read-only, reflects actual code)
const CODE_SNIPPET_MAP: Record<string, string> = {
  'Verify ownership at Land Registry': 'landRegistryOwnershipCheck',
  'Verify purchase price at Land Registry': 'landRegistryPricePaidCheck',
};

interface Industry {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;
}

interface TestType {
  id: string;
  name: string;
  code: string;
  actionType: string; // client_action | ai_action | human_action
  codeSection?: string | null;
}

interface TestBankEntry {
  id: string;
  firmId: string;
  industryId: string;
  fsLine: string;
  tests: { description: string; testTypeCode: string; significantRisk?: boolean; assertion?: string; framework?: string }[];
  assertions: string[] | null;
}

interface Props {
  firmId: string;
  initialIndustries: Industry[];
  initialTestTypes: TestType[];
  initialTestBanks: TestBankEntry[];
  initialFrameworkOptions?: string[];
}

const DEFAULT_FS_LINES = [
  'Going Concern', 'Management Override', 'Notes and Disclosures', 'Revenue',
  'Cost of Sales', 'Operating Expenses', 'Fixed Assets', 'Debtors',
  'Cash and Bank', 'Creditors', 'Accruals', 'Loans', 'Share Capital', 'Reserves',
];

const DEFAULT_FRAMEWORKS = ['IFRS', 'FRS102'];

type TopTab = 'test-bank' | 'test-types';

export function TestBankClient({ firmId, initialIndustries, initialTestTypes, initialTestBanks, initialFrameworkOptions }: Props) {
  const frameworkOptions = initialFrameworkOptions && initialFrameworkOptions.length > 0 ? initialFrameworkOptions : DEFAULT_FRAMEWORKS;
  const [topTab, setTopTab] = useState<TopTab>('test-bank');
  const [industries, setIndustries] = useState(initialIndustries);
  const [testTypes, setTestTypes] = useState(initialTestTypes);
  const [testBanks, setTestBanks] = useState(initialTestBanks);
  const [fsLines, setFsLines] = useState<string[]>(() => {
    const existing = new Set(testBanks.map(tb => tb.fsLine));
    const all = [...DEFAULT_FS_LINES];
    existing.forEach(l => { if (!all.includes(l)) all.push(l); });
    return all;
  });
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupFsLine, setPopupFsLine] = useState('');
  const [popupIndustryId, setPopupIndustryId] = useState('');
  const [popupTests, setPopupTests] = useState<{ description: string; testTypeCode: string; assertion?: string; framework?: string; significantRisk?: boolean }[]>([]);
  const [newFsLine, setNewFsLine] = useState('');
  const [newIndustryName, setNewIndustryName] = useState('');
  const [saving, setSaving] = useState(false);
  const [copySourceIndustry, setCopySourceIndustry] = useState('');
  const [copyTargetIndustry, setCopyTargetIndustry] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedIndustry, setSelectedIndustry] = useState<string>(industries[0]?.id || '');

  // Test Types state
  const [newTestTypeName, setNewTestTypeName] = useState('');
  const [newActionType, setNewActionType] = useState('human_action');
  const [newCodeSection, setNewCodeSection] = useState('');
  const [editingTestType, setEditingTestType] = useState<string | null>(null);
  const [editTestTypeName, setEditTestTypeName] = useState('');
  const [editActionType, setEditActionType] = useState('human_action');
  const [editCodeSection, setEditCodeSection] = useState('');

  const getTestCount = useCallback((industryId: string, fsLine: string) => {
    const entry = testBanks.find(tb => tb.industryId === industryId && tb.fsLine === fsLine);
    return entry?.tests?.length ?? 0;
  }, [testBanks]);

  const hasTests = useCallback((industryId: string, fsLine: string) => {
    return getTestCount(industryId, fsLine) > 0;
  }, [getTestCount]);

  // Get assertions for a given FS line across all industries
  const getAssertions = useCallback((fsLine: string) => {
    const assertions = new Set<string>();
    testBanks.filter(tb => tb.fsLine === fsLine).forEach(tb => {
      (tb.tests || []).forEach((t: any) => {
        if (t.assertion) assertions.add(t.assertion);
      });
    });
    return Array.from(assertions);
  }, [testBanks]);

  const openPopup = (fsLine: string, industryId: string) => {
    const entry = testBanks.find(tb => tb.industryId === industryId && tb.fsLine === fsLine);
    setPopupFsLine(fsLine);
    setPopupIndustryId(industryId);
    setPopupTests(entry?.tests as any[] || [{ description: '', testTypeCode: '', assertion: '', framework: '', significantRisk: false }]);
    setPopupOpen(true);
  };

  const handleSavePopup = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/methodology-admin/test-bank', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firmId, industryId: popupIndustryId, fsLine: popupFsLine,
          tests: popupTests.filter(t => t.description.trim()),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTestBanks(prev => {
          const idx = prev.findIndex(tb => tb.industryId === popupIndustryId && tb.fsLine === popupFsLine);
          if (idx >= 0) { const updated = [...prev]; updated[idx] = data.entry; return updated; }
          return [...prev, data.entry];
        });
      }
    } finally { setSaving(false); setPopupOpen(false); }
  };

  const handleAddFsLine = () => {
    if (newFsLine.trim() && !fsLines.includes(newFsLine.trim())) {
      setFsLines(prev => [...prev, newFsLine.trim()]);
      setNewFsLine('');
    }
  };

  const handleRemoveFsLine = (line: string) => {
    if (MANDATORY_FS_LINES.includes(line as any)) return;
    setFsLines(prev => prev.filter(l => l !== line));
  };

  async function handleAddIndustry() {
    const name = newIndustryName.trim();
    if (!name) return;
    const code = name.toLowerCase().replace(/\s+/g, '_');
    setSaving(true);
    try {
      const res = await fetch('/api/methodology-admin/industries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, code }),
      });
      if (res.ok) {
        const data = await res.json();
        setIndustries(prev => [...prev, data.industry]);
        setNewIndustryName('');
      }
    } finally { setSaving(false); }
  }

  const handleCopyIndustry = async () => {
    if (!copySourceIndustry || !copyTargetIndustry || copySourceIndustry === copyTargetIndustry) return;
    setSaving(true);
    try {
      const res = await fetch('/api/methodology-admin/test-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'copy', firmId, sourceIndustryId: copySourceIndustry, targetIndustryId: copyTargetIndustry }),
      });
      if (res.ok) {
        const data = await res.json();
        setTestBanks(prev => {
          const filtered = prev.filter(tb => tb.industryId !== copyTargetIndustry);
          return [...filtered, ...data.entries];
        });
      }
    } finally { setSaving(false); }
  };

  function downloadTemplate() {
    window.open(`/api/methodology-admin/test-bank/template?industryId=${selectedIndustry}`, '_blank');
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('industryId', selectedIndustry);
      const res = await fetch('/api/methodology-admin/test-bank/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'validation') {
          const errorList = data.errors.join('\n');
          const more = data.hasMore ? `\n...and ${data.count - 20} more errors` : '';
          setUploadResult(`Upload rejected — ${data.count} validation error${data.count > 1 ? 's' : ''}.\n\n${errorList}${more}`);
        } else { setUploadResult(`Upload failed: ${data.error}`); }
      } else {
        const tbRes = await fetch(`/api/methodology-admin/test-bank?industryId=${selectedIndustry}`);
        if (tbRes.ok) {
          const tbData = await tbRes.json();
          setTestBanks(prev => {
            const filtered = prev.filter(tb => tb.industryId !== selectedIndustry);
            return [...filtered, ...(tbData.entries || [])];
          });
          const newFsLineNames = (tbData.entries || []).map((e: any) => e.fsLine);
          setFsLines(prev => { const set = new Set([...prev, ...newFsLineNames]); return Array.from(set); });
        }
        setUploadResult(`Successfully imported ${data.imported} tests across ${data.fsLines} FS lines`);
      }
    } catch (err: any) {
      setUploadResult(`Upload failed: ${err?.message || 'Network error'}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // Test Type CRUD
  async function addTestType() {
    const name = newTestTypeName.trim();
    if (!name) return;
    const code = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const res = await fetch('/api/methodology-admin/test-types', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, code, actionType: newActionType, codeSection: newCodeSection.trim() || null }),
    });
    if (res.ok) {
      const { testType } = await res.json();
      setTestTypes(prev => [...prev, testType]);
      setNewTestTypeName('');
      setNewActionType('human_action');
      setNewCodeSection('');
    }
  }

  function startEditTestType(tt: TestType) {
    setEditingTestType(tt.id);
    setEditTestTypeName(tt.name);
    setEditActionType(tt.actionType || 'human_action');
    setEditCodeSection(tt.codeSection || '');
  }

  async function saveEditTestType() {
    if (!editingTestType || !editTestTypeName.trim()) return;
    const res = await fetch('/api/methodology-admin/test-types', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingTestType,
        name: editTestTypeName.trim(),
        actionType: editActionType,
        codeSection: editCodeSection.trim() || null,
      }),
    });
    if (res.ok) {
      const { testType } = await res.json();
      setTestTypes(prev => prev.map(t => t.id === testType.id ? testType : t));
      setEditingTestType(null);
    }
  }

  async function deleteTestType(id: string) {
    const res = await fetch('/api/methodology-admin/test-types', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.ok) { setTestTypes(prev => prev.filter(t => t.id !== id)); }
  }

  return (
    <div className="space-y-4">
      {/* Top tabs */}
      <div className="flex border-b border-slate-200">
        <button onClick={() => setTopTab('test-bank')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${topTab === 'test-bank' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
          Test Bank
        </button>
        <button onClick={() => setTopTab('test-types')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${topTab === 'test-types' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
          Test Types
        </button>
      </div>

      {/* ─── TEST TYPES TAB ─── */}
      {topTab === 'test-types' && (
        <div className="border rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Test Types ({testTypes.length})</h3>
          <p className="text-xs text-slate-500 mb-4">Define the types of audit actions. Each test in the Test Bank will be assigned one of these types.</p>

          {/* Table */}
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100 border-b">
                  <th className="text-left px-3 py-2 text-slate-600 font-semibold">Action</th>
                  <th className="text-left px-3 py-2 text-slate-600 font-semibold w-40">CodeSnippet</th>
                  <th className="text-left px-3 py-2 text-slate-600 font-semibold w-44">Type</th>
                  <th className="text-left px-3 py-2 text-slate-600 font-semibold w-48">Code Section</th>
                  <th className="w-20 px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {testTypes.map(tt => (
                  <tr key={tt.id} className="border-b border-slate-50 hover:bg-slate-50/50 group">
                    {editingTestType === tt.id ? (
                      <>
                        <td className="px-2 py-1.5">
                          <input value={editTestTypeName} onChange={e => setEditTestTypeName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveEditTestType(); if (e.key === 'Escape') setEditingTestType(null); }}
                            className="w-full border border-slate-300 rounded px-2 py-1 text-sm" autoFocus />
                        </td>
                        <td className="px-2 py-1.5 text-xs text-slate-400 font-mono">
                          {CODE_SNIPPET_MAP[tt.name] || '—'}
                        </td>
                        <td className="px-2 py-1.5">
                          <select value={editActionType} onChange={e => setEditActionType(e.target.value)}
                            className="w-full border border-slate-300 rounded px-2 py-1 text-sm bg-white">
                            <option value="client_action">Client Action</option>
                            <option value="ai_action">AI Action</option>
                            <option value="human_action">Human Action</option>
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input value={editCodeSection} onChange={e => setEditCodeSection(e.target.value)}
                            className="w-full border border-slate-300 rounded px-2 py-1 text-sm" placeholder="Code section reference" />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <div className="flex items-center gap-1 justify-end">
                            <button onClick={saveEditTestType} className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
                            <button onClick={() => setEditingTestType(null)} className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-100">Cancel</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-slate-700 font-medium">{tt.name}</td>
                        <td className="px-3 py-2">
                          {CODE_SNIPPET_MAP[tt.name] ? (
                            <span className="text-xs font-mono text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">{CODE_SNIPPET_MAP[tt.name]}</span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            tt.actionType === 'client_action' ? 'bg-amber-100 text-amber-700' :
                            tt.actionType === 'ai_action' ? 'bg-purple-100 text-purple-700' :
                            'bg-blue-100 text-blue-700'
                          }`}>
                            {tt.actionType === 'client_action' ? 'Client Action' :
                             tt.actionType === 'ai_action' ? 'AI Action' : 'Human Action'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-500 text-xs font-mono">{tt.codeSection || '—'}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => startEditTestType(tt)} className="p-1 hover:bg-slate-200 rounded" title="Amend">
                              <Pencil className="h-3.5 w-3.5 text-slate-500" />
                            </button>
                            <button onClick={() => deleteTestType(tt.id)} className="p-1 hover:bg-red-100 rounded" title="Delete">
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Add new row */}
          <div className="mt-3 border border-dashed border-slate-300 rounded-lg p-3 bg-slate-50/50">
            <div className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-5">
                <label className="text-[10px] text-slate-500 block mb-0.5">Action</label>
                <input value={newTestTypeName} onChange={e => setNewTestTypeName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addTestType()}
                  placeholder="e.g. Analytical Review, Physical Verification..."
                  className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
              </div>
              <div className="col-span-3">
                <label className="text-[10px] text-slate-500 block mb-0.5">Type</label>
                <select value={newActionType} onChange={e => setNewActionType(e.target.value)}
                  className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white">
                  <option value="client_action">Client Action</option>
                  <option value="ai_action">AI Action</option>
                  <option value="human_action">Human Action</option>
                </select>
              </div>
              <div className="col-span-3">
                <label className="text-[10px] text-slate-500 block mb-0.5">Code Section</label>
                <input value={newCodeSection} onChange={e => setNewCodeSection(e.target.value)}
                  placeholder="Optional" className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
              </div>
              <div className="col-span-1">
                <Button onClick={addTestType} size="sm" disabled={!newTestTypeName.trim()} className="w-full">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── TEST BANK TAB ─── */}
      {topTab === 'test-bank' && (
        <div className="space-y-4">
          {/* Toolbar row */}
          <div className="flex items-end gap-4 flex-wrap">
            {/* Add FS Line */}
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Add FS Line</label>
              <div className="flex items-center gap-1">
                <input type="text" value={newFsLine} onChange={e => setNewFsLine(e.target.value)}
                  placeholder="FS Statement Line..." className="border rounded-md px-2 py-1.5 text-sm w-48"
                  onKeyDown={e => e.key === 'Enter' && handleAddFsLine()} />
                <Button onClick={handleAddFsLine} size="sm" variant="outline" className="h-[34px]"><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
              </div>
            </div>

            {/* Add Industry */}
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">+ Industry</label>
              <div className="flex items-center gap-1">
                <input type="text" value={newIndustryName} onChange={e => setNewIndustryName(e.target.value)}
                  placeholder="Industry name..." className="border rounded-md px-2 py-1.5 text-sm w-40"
                  onKeyDown={e => e.key === 'Enter' && handleAddIndustry()} />
                <Button onClick={handleAddIndustry} size="sm" variant="outline" className="h-[34px]" disabled={saving}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
              </div>
            </div>

            {/* Upload/Download (need industry selector for these) */}
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Upload/Download Industry</label>
              <div className="flex items-center gap-1">
                <select value={selectedIndustry} onChange={e => setSelectedIndustry(e.target.value)}
                  className="border rounded-md px-2 py-1.5 text-sm bg-white w-40 h-[34px]">
                  {industries.map(ind => <option key={ind.id} value={ind.id}>{ind.name}</option>)}
                </select>
                <Button onClick={downloadTemplate} size="sm" variant="outline" className="h-[34px]" title="Download Template">
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button onClick={() => fileInputRef.current?.click()} size="sm" variant="outline" className="h-[34px]" disabled={uploading} title="Upload Spreadsheet">
                  <Upload className="h-3.5 w-3.5" />
                </Button>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} className="hidden" />
              </div>
            </div>

            {/* Copy */}
            <div className="ml-auto flex items-end gap-1">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Copy</label>
                <div className="flex items-center gap-1">
                  <select value={copySourceIndustry} onChange={e => setCopySourceIndustry(e.target.value)}
                    className="border rounded-md px-2 py-1.5 text-xs bg-white w-28 h-[34px]">
                    <option value="">From...</option>
                    {industries.map(ind => <option key={ind.id} value={ind.id}>{ind.name}</option>)}
                  </select>
                  <span className="text-slate-400 text-xs">→</span>
                  <select value={copyTargetIndustry} onChange={e => setCopyTargetIndustry(e.target.value)}
                    className="border rounded-md px-2 py-1.5 text-xs bg-white w-28 h-[34px]">
                    <option value="">To...</option>
                    {industries.map(ind => <option key={ind.id} value={ind.id}>{ind.name}</option>)}
                  </select>
                  <Button onClick={handleCopyIndustry} size="sm" variant="outline" className="h-[34px]" disabled={saving}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {uploadResult && (
            <div className={`text-sm px-4 py-2 rounded-lg whitespace-pre-wrap ${uploadResult.includes('failed') || uploadResult.includes('rejected') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
              {uploadResult}
            </div>
          )}

          {/* Grid: FS Lines as rows, Industries as columns with check dots */}
          <div className="border rounded-lg overflow-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-100">
                  <th className="text-left font-semibold text-slate-700 p-2.5 min-w-[200px] border-b border-r border-slate-200">FS Statement Line</th>
                  <th className="text-left font-semibold text-slate-700 p-2.5 min-w-[180px] border-b border-r border-slate-200">Assertions</th>
                  {industries.map(ind => (
                    <th key={ind.id} className="text-center font-semibold text-slate-700 p-2 min-w-[80px] border-b border-r border-slate-200">
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-[10px] leading-tight">{ind.name}</span>
                        {ind.isDefault && <span className="text-[8px] text-blue-500">(Default)</span>}
                      </div>
                    </th>
                  ))}
                  <th className="text-center font-semibold text-slate-700 p-2 w-16 border-b border-slate-200">Framework</th>
                </tr>
              </thead>
              <tbody>
                {fsLines.map((line, rowIdx) => {
                  const assertions = getAssertions(line);
                  return (
                    <tr key={line} className={`border-b border-slate-100 ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'} hover:bg-blue-50/30 transition-colors`}>
                      {/* FS Line name */}
                      <td className="p-2.5 border-r border-slate-100">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-slate-800 text-sm">{line}</span>
                          {!MANDATORY_FS_LINES.includes(line as any) && (
                            <button onClick={() => handleRemoveFsLine(line)} className="text-red-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><X className="h-3 w-3" /></button>
                          )}
                        </div>
                      </td>

                      {/* Assertions multi-display */}
                      <td className="p-2 border-r border-slate-100">
                        {assertions.length > 0 ? (
                          <div className="flex flex-wrap gap-0.5">
                            {assertions.map(a => (
                              <span key={a} className="inline-block px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] leading-tight">
                                {a.length > 15 ? a.split(' ').map(w => w[0]).join('') : a}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-300 italic">—</span>
                        )}
                      </td>

                      {/* Industry dots */}
                      {industries.map(ind => {
                        const count = getTestCount(ind.id, line);
                        const has = count > 0;
                        return (
                          <td key={ind.id} className="p-2 text-center border-r border-slate-100">
                            <button
                              onClick={() => openPopup(line, ind.id)}
                              className="inline-flex flex-col items-center gap-0.5 group/dot"
                              title={has ? `${count} test${count > 1 ? 's' : ''} — click to amend` : 'Click to add tests'}
                            >
                              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                                has
                                  ? 'bg-green-500 border-green-500 text-white'
                                  : 'bg-white border-slate-300 group-hover/dot:border-green-400'
                              }`}>
                                {has && <span className="text-[9px] font-bold">{count}</span>}
                              </div>
                              <span className={`text-[8px] ${has ? 'text-green-600 font-medium' : 'text-slate-400'}`}>
                                {has ? 'Amend' : 'Add'}
                              </span>
                            </button>
                          </td>
                        );
                      })}

                      {/* Framework summary */}
                      <td className="p-2 text-center">
                        {(() => {
                          const fws = new Set<string>();
                          testBanks.filter(tb => tb.fsLine === line).forEach(tb => {
                            (tb.tests || []).forEach((t: any) => { if (t.framework) fws.add(t.framework); });
                          });
                          if (fws.size === 0) return <span className="text-slate-300">—</span>;
                          return (
                            <div className="flex flex-wrap gap-0.5 justify-center">
                              {Array.from(fws).map(fw => (
                                <span key={fw} className="text-[9px] px-1 py-0.5 bg-blue-100 text-blue-600 rounded">{fw}</span>
                              ))}
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Summary */}
          <div className="text-xs text-slate-500">
            {fsLines.length} FS lines &middot; {industries.length} industries &middot; {testBanks.reduce((sum, tb) => sum + ((tb.tests as any[])?.length || 0), 0)} total tests
          </div>
        </div>
      )}

      {/* ─── POPUP for editing tests (now called "Framework") ─── */}
      {popupOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-lg shadow-xl w-[1050px] max-h-[80vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">
                Framework: {popupFsLine}
                <span className="text-sm font-normal text-slate-500 ml-2">
                  ({industries.find(i => i.id === popupIndustryId)?.name})
                </span>
              </h3>
              <button onClick={() => setPopupOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <table className="w-full border-collapse mb-4">
              <thead>
                <tr>
                  <th className="text-left text-sm font-medium text-slate-600 p-2 border-b">Test Description</th>
                  <th className="text-left text-sm font-medium text-slate-600 p-2 border-b w-36">Type</th>
                  <th className="text-left text-sm font-medium text-slate-600 p-2 border-b w-44">Assertion</th>
                  <th className="text-left text-sm font-medium text-slate-600 p-2 border-b w-28">Framework</th>
                  <th className="text-center text-sm font-medium text-slate-600 p-2 border-b w-16" title="Significant Risk">Sig. Risk</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {popupTests.map((test, i) => (
                  <tr key={i}>
                    <td className="p-2 border-b">
                      <textarea value={test.description}
                        onChange={e => { const u = [...popupTests]; u[i] = { ...u[i], description: e.target.value }; setPopupTests(u); }}
                        className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm min-h-[60px]" rows={2} />
                    </td>
                    <td className="p-2 border-b">
                      <select value={test.testTypeCode}
                        onChange={e => { const u = [...popupTests]; u[i] = { ...u[i], testTypeCode: e.target.value }; setPopupTests(u); }}
                        className="w-full border border-slate-300 rounded-md px-2 py-2 text-sm bg-white">
                        <option value="">Select...</option>
                        {testTypes.map(tt => <option key={tt.code} value={tt.code}>{tt.name}</option>)}
                      </select>
                    </td>
                    <td className="p-2 border-b">
                      <select value={test.assertion || ''}
                        onChange={e => { const u = [...popupTests]; u[i] = { ...u[i], assertion: e.target.value }; setPopupTests(u); }}
                        className="w-full border border-slate-300 rounded-md px-2 py-2 text-sm bg-white">
                        <option value="">Select...</option>
                        {ASSERTION_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </td>
                    <td className="p-2 border-b">
                      <select value={test.framework || ''}
                        onChange={e => { const u = [...popupTests]; u[i] = { ...u[i], framework: e.target.value }; setPopupTests(u); }}
                        className="w-full border border-slate-300 rounded-md px-2 py-2 text-sm bg-white">
                        <option value="">All</option>
                        {frameworkOptions.map(fw => <option key={fw} value={fw}>{fw}</option>)}
                      </select>
                    </td>
                    <td className="p-2 border-b text-center">
                      <input type="checkbox" checked={test.significantRisk || false}
                        onChange={e => { const u = [...popupTests]; u[i] = { ...u[i], significantRisk: e.target.checked }; setPopupTests(u); }}
                        className="w-4 h-4 rounded border-slate-300 text-red-500" />
                    </td>
                    <td className="p-2 border-b text-center">
                      <button onClick={() => setPopupTests(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600">
                        <X className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex items-center justify-between">
              <Button onClick={() => setPopupTests(prev => [...prev, { description: '', testTypeCode: '', assertion: '', framework: '', significantRisk: false }])}
                size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" /> Add Row</Button>
              <div className="flex space-x-2">
                <Button onClick={() => setPopupOpen(false)} size="sm" variant="outline">Cancel</Button>
                <Button onClick={handleSavePopup} size="sm" disabled={saving} className="bg-blue-600 hover:bg-blue-700">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                  Save
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
