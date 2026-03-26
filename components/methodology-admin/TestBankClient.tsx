'use client';

import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, X, Copy, Loader2, Save, Download, Upload, Pencil, Trash2 } from 'lucide-react';
import { MANDATORY_FS_LINES, ASSERTION_TYPES } from '@/types/methodology';

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
type TestTypesSubTab = 'actions' | 'types';

export function TestBankClient({ firmId, initialIndustries, initialTestTypes, initialTestBanks, initialFrameworkOptions }: Props) {
  const frameworkOptions = initialFrameworkOptions && initialFrameworkOptions.length > 0 ? initialFrameworkOptions : DEFAULT_FRAMEWORKS;
  const [topTab, setTopTab] = useState<TopTab>('test-bank');
  const [testTypesSubTab, setTestTypesSubTab] = useState<TestTypesSubTab>('types');
  const [industries] = useState(initialIndustries);
  const [testTypes, setTestTypes] = useState(initialTestTypes);
  const [testBanks, setTestBanks] = useState(initialTestBanks);
  const [selectedIndustry, setSelectedIndustry] = useState<string>(industries[0]?.id || '');
  const [fsLines, setFsLines] = useState<string[]>(() => {
    const existing = new Set(testBanks.map((tb) => tb.fsLine));
    const all = [...DEFAULT_FS_LINES];
    existing.forEach((l) => { if (!all.includes(l)) all.push(l); });
    return all;
  });
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupFsLine, setPopupFsLine] = useState('');
  const [popupTests, setPopupTests] = useState<{ description: string; testTypeCode: string; assertion?: string; framework?: string; significantRisk?: boolean }[]>([]);
  const [newFsLine, setNewFsLine] = useState('');
  const [saving, setSaving] = useState(false);
  const [copySourceIndustry, setCopySourceIndustry] = useState('');
  const [copyTargetIndustry, setCopyTargetIndustry] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Test Types state
  const [newTestTypeName, setNewTestTypeName] = useState('');
  const [editingTestType, setEditingTestType] = useState<string | null>(null);
  const [editTestTypeName, setEditTestTypeName] = useState('');
  // Actions state
  const [newActionName, setNewActionName] = useState('');
  const [actions, setActions] = useState<{ id: string; name: string }[]>([]);
  const [editingAction, setEditingAction] = useState<string | null>(null);
  const [editActionName, setEditActionName] = useState('');

  const hasTests = useCallback(
    (industryId: string, fsLine: string) => {
      return testBanks.some(
        (tb) => tb.industryId === industryId && tb.fsLine === fsLine && tb.tests && (tb.tests as any[]).length > 0
      );
    },
    [testBanks]
  );

  const getTestCount = useCallback(
    (industryId: string, fsLine: string) => {
      const entry = testBanks.find((tb) => tb.industryId === industryId && tb.fsLine === fsLine);
      return entry?.tests?.length ?? 0;
    },
    [testBanks]
  );

  const openPopup = (fsLine: string) => {
    const entry = testBanks.find((tb) => tb.industryId === selectedIndustry && tb.fsLine === fsLine);
    setPopupFsLine(fsLine);
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
          firmId, industryId: selectedIndustry, fsLine: popupFsLine,
          tests: popupTests.filter((t) => t.description.trim()),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTestBanks((prev) => {
          const idx = prev.findIndex((tb) => tb.industryId === selectedIndustry && tb.fsLine === popupFsLine);
          if (idx >= 0) { const updated = [...prev]; updated[idx] = data.entry; return updated; }
          return [...prev, data.entry];
        });
      }
    } finally { setSaving(false); setPopupOpen(false); }
  };

  const handleAddFsLine = () => {
    if (newFsLine.trim() && !fsLines.includes(newFsLine.trim())) {
      setFsLines((prev) => [...prev, newFsLine.trim()]);
      setNewFsLine('');
    }
  };

  const handleRemoveFsLine = (line: string) => {
    if (MANDATORY_FS_LINES.includes(line as any)) return;
    setFsLines((prev) => prev.filter((l) => l !== line));
  };

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
        setTestBanks((prev) => {
          const filtered = prev.filter((tb) => tb.industryId !== copyTargetIndustry);
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
    const code = name.toLowerCase().replace(/\s+/g, '_');
    const res = await fetch('/api/methodology-admin/test-types', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, code }),
    });
    if (res.ok) {
      const { testType } = await res.json();
      setTestTypes(prev => [...prev, testType]);
      setNewTestTypeName('');
    }
  }

  async function updateTestType(id: string, name: string) {
    const res = await fetch('/api/methodology-admin/test-types', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name }),
    });
    if (res.ok) { setTestTypes(prev => prev.map(t => t.id === id ? { ...t, name } : t)); setEditingTestType(null); }
  }

  async function deleteTestType(id: string) {
    if (testTypes.length <= 1) return;
    const res = await fetch('/api/methodology-admin/test-types', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.ok) { setTestTypes(prev => prev.filter(t => t.id !== id)); }
  }

  // ─── Top-level tabs ────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Top tabs */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setTopTab('test-bank')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            topTab === 'test-bank'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Test Bank
        </button>
        <button
          onClick={() => setTopTab('test-types')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            topTab === 'test-types'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Test Types
        </button>
      </div>

      {/* ─── TEST TYPES TAB ─── */}
      {topTab === 'test-types' && (
        <div className="space-y-4">
          {/* Sub-tabs */}
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
            <button
              onClick={() => setTestTypesSubTab('types')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                testTypesSubTab === 'types' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Test Types
            </button>
            <button
              onClick={() => setTestTypesSubTab('actions')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                testTypesSubTab === 'actions' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Actions
            </button>
          </div>

          {/* Test Types sub-tab */}
          {testTypesSubTab === 'types' && (
            <div className="border rounded-lg p-4">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">
                Test Types ({testTypes.length})
              </h3>
              <p className="text-xs text-slate-500 mb-4">
                Define the types of audit tests available in the Test Bank (e.g. Analytical Review, Test of Details, Judgement)
              </p>

              <div className="border rounded-lg divide-y">
                {testTypes.map(tt => (
                  <div key={tt.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 group">
                    {editingTestType === tt.id ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          value={editTestTypeName}
                          onChange={e => setEditTestTypeName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') updateTestType(tt.id, editTestTypeName); if (e.key === 'Escape') setEditingTestType(null); }}
                          className="border rounded px-2 py-1 text-sm flex-1 max-w-xs"
                          autoFocus
                        />
                        <Button size="sm" onClick={() => updateTestType(tt.id, editTestTypeName)}>Save</Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingTestType(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <>
                        <div>
                          <span className="text-sm font-medium text-slate-700">{tt.name}</span>
                          <span className="text-[10px] text-slate-400 ml-2">({tt.code})</span>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => { setEditingTestType(tt.id); setEditTestTypeName(tt.name); }}
                            className="p-1 hover:bg-slate-200 rounded" title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5 text-slate-500" />
                          </button>
                          {testTypes.length > 1 && (
                            <button
                              onClick={() => deleteTestType(tt.id)}
                              className="p-1 hover:bg-red-100 rounded" title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 mt-3">
                <input
                  value={newTestTypeName}
                  onChange={e => setNewTestTypeName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addTestType()}
                  placeholder="New test type name..."
                  className="border rounded-md px-3 py-1.5 text-sm flex-1 max-w-xs"
                />
                <Button onClick={addTestType} size="sm" disabled={!newTestTypeName.trim()}>
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              </div>
            </div>
          )}

          {/* Actions sub-tab */}
          {testTypesSubTab === 'actions' && (
            <div className="border rounded-lg p-4">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">
                Actions ({actions.length})
              </h3>
              <p className="text-xs text-slate-500 mb-4">
                Define actions that can be associated with test types (e.g. Inspect, Observe, Inquire, Confirm, Recalculate, Reperform, Analytical Procedures)
              </p>

              {actions.length === 0 && (
                <div className="text-center py-8 text-slate-400 text-sm border rounded-lg border-dashed">
                  No actions defined yet. Add your first action below.
                </div>
              )}

              {actions.length > 0 && (
                <div className="border rounded-lg divide-y">
                  {actions.map(action => (
                    <div key={action.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 group">
                      {editingAction === action.id ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            value={editActionName}
                            onChange={e => setEditActionName(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                setActions(prev => prev.map(a => a.id === action.id ? { ...a, name: editActionName } : a));
                                setEditingAction(null);
                              }
                              if (e.key === 'Escape') setEditingAction(null);
                            }}
                            className="border rounded px-2 py-1 text-sm flex-1 max-w-xs"
                            autoFocus
                          />
                          <Button size="sm" onClick={() => { setActions(prev => prev.map(a => a.id === action.id ? { ...a, name: editActionName } : a)); setEditingAction(null); }}>Save</Button>
                          <Button size="sm" variant="outline" onClick={() => setEditingAction(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <>
                          <span className="text-sm font-medium text-slate-700">{action.name}</span>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => { setEditingAction(action.id); setEditActionName(action.name); }}
                              className="p-1 hover:bg-slate-200 rounded" title="Edit"
                            >
                              <Pencil className="h-3.5 w-3.5 text-slate-500" />
                            </button>
                            <button
                              onClick={() => setActions(prev => prev.filter(a => a.id !== action.id))}
                              className="p-1 hover:bg-red-100 rounded" title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 mt-3">
                <input
                  value={newActionName}
                  onChange={e => setNewActionName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newActionName.trim()) {
                      setActions(prev => [...prev, { id: `action-${Date.now()}`, name: newActionName.trim() }]);
                      setNewActionName('');
                    }
                  }}
                  placeholder="New action name..."
                  className="border rounded-md px-3 py-1.5 text-sm flex-1 max-w-xs"
                />
                <Button
                  onClick={() => {
                    if (newActionName.trim()) {
                      setActions(prev => [...prev, { id: `action-${Date.now()}`, name: newActionName.trim() }]);
                      setNewActionName('');
                    }
                  }}
                  size="sm"
                  disabled={!newActionName.trim()}
                >
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── TEST BANK TAB ─── */}
      {topTab === 'test-bank' && (
        <div className="space-y-4">
          {/* Industry selector and Copy */}
          <div className="flex items-end gap-6 flex-wrap gap-y-3">
            <div className="min-w-[250px]">
              <label className="text-xs font-medium text-slate-600 mb-1.5 block">Industry</label>
              <select
                value={selectedIndustry}
                onChange={(e) => setSelectedIndustry(e.target.value)}
                className="w-full border border-slate-300 rounded-md px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                size={1}
                style={{ minHeight: '42px' }}
              >
                {industries.map((ind) => (
                  <option key={ind.id} value={ind.id}>{ind.name}{ind.isDefault ? ' (Default)' : ''}</option>
                ))}
              </select>
            </div>

            <div className="flex items-end gap-3 ml-auto">
              <div className="min-w-[200px]">
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">Copy From</label>
                <select value={copySourceIndustry} onChange={(e) => setCopySourceIndustry(e.target.value)}
                  className="w-full border border-slate-300 rounded-md px-4 py-2.5 text-sm bg-white" style={{ minHeight: '42px' }}>
                  <option value="">Select industry...</option>
                  {industries.map((ind) => <option key={ind.id} value={ind.id}>{ind.name}</option>)}
                </select>
              </div>
              <div className="min-w-[200px]">
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">Copy To</label>
                <select value={copyTargetIndustry} onChange={(e) => setCopyTargetIndustry(e.target.value)}
                  className="w-full border border-slate-300 rounded-md px-4 py-2.5 text-sm bg-white" style={{ minHeight: '42px' }}>
                  <option value="">Select industry...</option>
                  {industries.map((ind) => <option key={ind.id} value={ind.id}>{ind.name}</option>)}
                </select>
              </div>
              <Button onClick={handleCopyIndustry} size="sm" variant="outline" disabled={saving} className="h-[42px]">
                <Copy className="h-4 w-4 mr-1" /> Copy
              </Button>
            </div>
          </div>

          {/* Upload / Download + Add FS Line */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={newFsLine}
                onChange={(e) => setNewFsLine(e.target.value)}
                placeholder="Add FS Statement Line..."
                className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
                onKeyDown={(e) => e.key === 'Enter' && handleAddFsLine()}
              />
              <Button onClick={handleAddFsLine} size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-1" /> Add Column
              </Button>
            </div>

            <div className="flex items-center space-x-2">
              <Button onClick={downloadTemplate} size="sm" variant="outline">
                <Download className="h-4 w-4 mr-1" /> Download Template
              </Button>
              <Button onClick={() => fileInputRef.current?.click()} size="sm" variant="outline" disabled={uploading}>
                <Upload className="h-4 w-4 mr-1" /> {uploading ? 'Uploading...' : 'Upload Spreadsheet'}
              </Button>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} className="hidden" />
            </div>
          </div>

          {uploadResult && (
            <div className={`text-sm px-4 py-2 rounded-lg whitespace-pre-wrap ${uploadResult.includes('failed') || uploadResult.includes('rejected') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
              {uploadResult}
            </div>
          )}

          {/* Grid - FS Lines as rows */}
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  <th className="text-left text-sm font-medium text-slate-700 p-3 w-64">FS Statement Line</th>
                  <th className="text-center text-sm font-medium text-slate-700 p-3 w-24">Tests</th>
                  <th className="text-left text-sm font-medium text-slate-700 p-3">Test Descriptions</th>
                  <th className="text-center text-sm font-medium text-slate-700 p-3 w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {fsLines.map((line) => {
                  const count = getTestCount(selectedIndustry, line);
                  const entry = testBanks.find((tb) => tb.industryId === selectedIndustry && tb.fsLine === line);
                  const tests = (entry?.tests as any[]) || [];
                  return (
                    <tr key={line} className="border-t hover:bg-slate-50 transition-colors">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-700">{line}</span>
                          {!MANDATORY_FS_LINES.includes(line as any) && (
                            <button onClick={() => handleRemoveFsLine(line)} className="text-red-400 hover:text-red-600" title="Remove">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        {count > 0 ? (
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                            {count}
                          </span>
                        ) : (
                          <span className="text-slate-300 text-sm">0</span>
                        )}
                      </td>
                      <td className="p-3">
                        {tests.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {tests.slice(0, 3).map((t: any, i: number) => (
                              <span key={i} className="text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded truncate max-w-[200px]">
                                {t.description}
                              </span>
                            ))}
                            {tests.length > 3 && (
                              <span className="text-xs text-slate-400">+{tests.length - 3} more</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 italic">No tests defined</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <Button
                          onClick={() => openPopup(line)}
                          size="sm"
                          variant="outline"
                          className="text-xs h-7 px-2"
                        >
                          {count > 0 ? 'Edit' : 'Add'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {fsLines.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-slate-400 text-sm">
                      No FS lines defined. Add one above to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Summary */}
          <div className="text-xs text-slate-500">
            {fsLines.length} FS lines &middot; {testBanks.filter(tb => tb.industryId === selectedIndustry).reduce((sum, tb) => sum + ((tb.tests as any[])?.length || 0), 0)} total tests for {industries.find(i => i.id === selectedIndustry)?.name || 'selected industry'}
          </div>
        </div>
      )}

      {/* ─── POPUP for editing tests ─── */}
      {popupOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-lg shadow-xl w-[1050px] max-h-[80vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">
                Tests: {popupFsLine}
                <span className="text-sm font-normal text-slate-500 ml-2">
                  ({industries.find(i => i.id === selectedIndustry)?.name})
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
                      <textarea
                        value={test.description}
                        onChange={(e) => {
                          const updated = [...popupTests];
                          updated[i] = { ...updated[i], description: e.target.value };
                          setPopupTests(updated);
                        }}
                        className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[60px]"
                        rows={2}
                      />
                    </td>
                    <td className="p-2 border-b">
                      <select
                        value={test.testTypeCode}
                        onChange={(e) => {
                          const updated = [...popupTests];
                          updated[i] = { ...updated[i], testTypeCode: e.target.value };
                          setPopupTests(updated);
                        }}
                        className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white"
                      >
                        <option value="">Select type...</option>
                        {testTypes.map((tt) => (
                          <option key={tt.code} value={tt.code}>{tt.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2 border-b">
                      <select
                        value={test.assertion || ''}
                        onChange={(e) => {
                          const updated = [...popupTests];
                          updated[i] = { ...updated[i], assertion: e.target.value };
                          setPopupTests(updated);
                        }}
                        className="w-full border border-slate-300 rounded-md px-2 py-2 text-sm bg-white"
                      >
                        <option value="">Select...</option>
                        {ASSERTION_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </td>
                    <td className="p-2 border-b">
                      <select
                        value={test.framework || ''}
                        onChange={(e) => {
                          const updated = [...popupTests];
                          updated[i] = { ...updated[i], framework: e.target.value };
                          setPopupTests(updated);
                        }}
                        className="w-full border border-slate-300 rounded-md px-2 py-2 text-sm bg-white"
                      >
                        <option value="">All</option>
                        {frameworkOptions.map(fw => <option key={fw} value={fw}>{fw}</option>)}
                      </select>
                    </td>
                    <td className="p-2 border-b text-center">
                      <input
                        type="checkbox"
                        checked={test.significantRisk || false}
                        onChange={(e) => {
                          const updated = [...popupTests];
                          updated[i] = { ...updated[i], significantRisk: e.target.checked };
                          setPopupTests(updated);
                        }}
                        className="w-4 h-4 rounded border-slate-300 text-red-500 focus:ring-red-400"
                      />
                    </td>
                    <td className="p-2 border-b text-center">
                      <button onClick={() => setPopupTests((prev) => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600">
                        <X className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex items-center justify-between">
              <Button
                onClick={() => setPopupTests((prev) => [...prev, { description: '', testTypeCode: '', assertion: '', framework: '', significantRisk: false }])}
                size="sm" variant="outline"
              >
                <Plus className="h-4 w-4 mr-1" /> Add Row
              </Button>
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
