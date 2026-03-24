'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, X, Copy, Loader2, Save } from 'lucide-react';
import { MANDATORY_FS_LINES } from '@/types/methodology';

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
  tests: { description: string; testTypeCode: string; significantRisk?: boolean }[];
  assertions: string[] | null;
}

interface Props {
  firmId: string;
  initialIndustries: Industry[];
  initialTestTypes: TestType[];
  initialTestBanks: TestBankEntry[];
}

const DEFAULT_FS_LINES = [
  'Going Concern',
  'Management Override',
  'Notes and Disclosures',
  'Revenue',
  'Cost of Sales',
  'Operating Expenses',
  'Fixed Assets',
  'Debtors',
  'Cash and Bank',
  'Creditors',
  'Accruals',
  'Loans',
  'Share Capital',
  'Reserves',
];

export function TestBankClient({ firmId, initialIndustries, initialTestTypes, initialTestBanks }: Props) {
  const [industries] = useState(initialIndustries);
  const [testTypes] = useState(initialTestTypes);
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
  const [popupTests, setPopupTests] = useState<{ description: string; testTypeCode: string }[]>([]);
  const [newFsLine, setNewFsLine] = useState('');
  const [saving, setSaving] = useState(false);
  const [copySourceIndustry, setCopySourceIndustry] = useState('');
  const [copyTargetIndustry, setCopyTargetIndustry] = useState('');

  const hasTests = useCallback(
    (industryId: string, fsLine: string) => {
      return testBanks.some(
        (tb) => tb.industryId === industryId && tb.fsLine === fsLine && tb.tests && (tb.tests as any[]).length > 0
      );
    },
    [testBanks]
  );

  const openPopup = (fsLine: string) => {
    const entry = testBanks.find((tb) => tb.industryId === selectedIndustry && tb.fsLine === fsLine);
    setPopupFsLine(fsLine);
    setPopupTests(entry?.tests as any[] || [{ description: '', testTypeCode: '', significantRisk: false }]);
    setPopupOpen(true);
  };

  const handleSavePopup = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/methodology-admin/test-bank', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firmId,
          industryId: selectedIndustry,
          fsLine: popupFsLine,
          tests: popupTests.filter((t) => t.description.trim()),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTestBanks((prev) => {
          const idx = prev.findIndex((tb) => tb.industryId === selectedIndustry && tb.fsLine === popupFsLine);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = data.entry;
            return updated;
          }
          return [...prev, data.entry];
        });
      }
    } catch {
      // handle error
    } finally {
      setSaving(false);
      setPopupOpen(false);
    }
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
        body: JSON.stringify({
          action: 'copy',
          firmId,
          sourceIndustryId: copySourceIndustry,
          targetIndustryId: copyTargetIndustry,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTestBanks((prev) => {
          const filtered = prev.filter((tb) => tb.industryId !== copyTargetIndustry);
          return [...filtered, ...data.entries];
        });
      }
    } catch {
      // handle error
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Industry selector and Copy */}
      <div className="flex items-end space-x-4 flex-wrap gap-y-3">
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Industry</label>
          <select
            value={selectedIndustry}
            onChange={(e) => setSelectedIndustry(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {industries.map((ind) => (
              <option key={ind.id} value={ind.id}>{ind.name}{ind.isDefault ? ' (Default)' : ''}</option>
            ))}
          </select>
        </div>

        <div className="flex items-end space-x-2 ml-auto">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Copy From</label>
            <select value={copySourceIndustry} onChange={(e) => setCopySourceIndustry(e.target.value)} className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white">
              <option value="">Select...</option>
              {industries.map((ind) => <option key={ind.id} value={ind.id}>{ind.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Copy To</label>
            <select value={copyTargetIndustry} onChange={(e) => setCopyTargetIndustry(e.target.value)} className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white">
              <option value="">Select...</option>
              {industries.map((ind) => <option key={ind.id} value={ind.id}>{ind.name}</option>)}
            </select>
          </div>
          <Button onClick={handleCopyIndustry} size="sm" variant="outline" disabled={saving}>
            <Copy className="h-4 w-4 mr-1" /> Copy
          </Button>
        </div>
      </div>

      {/* Add FS Line */}
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

      {/* Grid */}
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full border-collapse min-w-[800px]">
          <thead>
            <tr>
              <th className="border border-slate-300 p-2 bg-slate-100 text-left text-sm font-medium sticky left-0 bg-slate-100 z-10 min-w-[180px]">
                Industry / FS Line
              </th>
              {fsLines.map((line) => (
                <th key={line} className="border border-slate-300 p-2 bg-slate-100 text-center text-sm font-medium min-w-[120px]">
                  <div className="flex items-center justify-center space-x-1">
                    <span className="truncate">{line}</span>
                    {!MANDATORY_FS_LINES.includes(line as any) && (
                      <button onClick={() => handleRemoveFsLine(line)} className="text-red-400 hover:text-red-600 flex-shrink-0">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {industries.filter((i) => i.id === selectedIndustry).map((ind) => (
              <tr key={ind.id}>
                <td className="border border-slate-300 p-2 bg-slate-50 text-sm font-medium sticky left-0 z-10">
                  {ind.name}
                </td>
                {fsLines.map((line) => {
                  const has = hasTests(ind.id, line);
                  return (
                    <td
                      key={line}
                      className="border border-slate-300 p-2 text-center cursor-pointer hover:bg-blue-50"
                      onClick={() => openPopup(line)}
                    >
                      {has ? (
                        <span className="text-lg font-bold text-blue-600">X</span>
                      ) : (
                        <span className="text-slate-300">&mdash;</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Popup for editing tests */}
      {popupOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-lg shadow-xl w-[700px] max-h-[80vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">
                Tests: {popupFsLine}
              </h3>
              <button onClick={() => setPopupOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <table className="w-full border-collapse mb-4">
              <thead>
                <tr>
                  <th className="text-left text-sm font-medium text-slate-600 p-2 border-b">Test Description</th>
                  <th className="text-left text-sm font-medium text-slate-600 p-2 border-b w-44">Type</th>
                  <th className="text-center text-sm font-medium text-slate-600 p-2 border-b w-20" title="Significant Risk">Sig. Risk</th>
                  <th className="w-10"></th>
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
                        title="Mark as Significant Risk test"
                      />
                    </td>
                    <td className="p-2 border-b text-center">
                      <button
                        onClick={() => setPopupTests((prev) => prev.filter((_, j) => j !== i))}
                        className="text-red-400 hover:text-red-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex items-center justify-between">
              <Button
                onClick={() => setPopupTests((prev) => [...prev, { description: '', testTypeCode: '', significantRisk: false }])}
                size="sm"
                variant="outline"
              >
                <Plus className="h-4 w-4 mr-1" /> Add Row
              </Button>
              <div className="flex space-x-2">
                <Button onClick={() => setPopupOpen(false)} size="sm" variant="outline">
                  Cancel
                </Button>
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
