'use client';

import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, X, Copy, Loader2, Save, Download, Upload } from 'lucide-react';
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

const DEFAULT_FRAMEWORKS = ['IFRS', 'FRS102'];

export function TestBankClient({ firmId, initialIndustries, initialTestTypes, initialTestBanks, initialFrameworkOptions }: Props) {
  const frameworkOptions = initialFrameworkOptions && initialFrameworkOptions.length > 0 ? initialFrameworkOptions : DEFAULT_FRAMEWORKS;
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
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  function downloadTemplate() {
    // Download XLSX with dropdown data validation from API
    window.open(`/api/methodology-admin/test-bank/template?industryId=${selectedIndustry}`, '_blank');
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadResult(null);

    try {
      // Read as ArrayBuffer for XLSX, or text for CSV
      const isXlsx = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');

      let rows: string[][] = [];

      if (isXlsx) {
        try {
          const XLSX = (await import('xlsx')).default;
          const buffer = await file.arrayBuffer();
          const workbook = XLSX.read(buffer, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });
          rows = jsonData as string[][];
        } catch (xlsxErr: any) {
          setUploadResult(`Upload failed: Could not parse XLSX file. ${xlsxErr?.message || 'Unknown error'}`);
          return;
        }
      } else {
        // CSV parsing
        const text = await file.text();
        rows = text.split('\n')
          .filter(l => l.trim() && !l.startsWith('LOOKUPS') && !l.startsWith('Type Options') && !l.startsWith('Assertion Options') && !l.startsWith('Significant Risk'))
          .map(line => (line.match(/(".*?"|[^,]*),?/g) || []).map(s => s.replace(/,$/, '').replace(/^"|"$/g, '').trim()));
      }

      // Detect column positions from headers (flexible: any order)
      const headerRow = rows[0]?.map(h => (h || '').toString().trim().toLowerCase()) || [];

      if (rows.length < 2) {
        setUploadResult('Upload failed: File is empty or has no data rows');
        return;
      }

      // Find column indices by header keywords
      function findCol(keywords: string[]): number {
        return headerRow.findIndex(h => keywords.some(k => h.includes(k)));
      }
      const colFsLine = findCol(['fs line', 'line item', 'fs statement']);
      const colDesc = findCol(['test desc', 'description']);
      const colType = Math.max(findCol(['type']), 0);
      const colAssertion = findCol(['assertion']);
      const colFramework = findCol(['framework', 'accounting']);
      const colSigRisk = findCol(['significant', 'sig risk', 'sig.']);

      if (colFsLine < 0 && colDesc < 0) {
        // Fallback: assume positional A=fsLine, B=desc, C=type, D=assertion
        // This handles files with no recognizable headers
      }

      // Use detected indices or fallback to positional
      const iFS = colFsLine >= 0 ? colFsLine : 0;
      const iDesc = colDesc >= 0 ? colDesc : 1;
      const iType = colType >= 0 ? colType : 2;
      const iAssert = colAssertion >= 0 ? colAssertion : 3;
      const iFramework = colFramework; // -1 if not present
      const iSigRisk = colSigRisk >= 0 ? colSigRisk : (iFramework >= 0 ? 5 : 4);

      // Parse and validate each row
      const dataRows = rows.slice(1);
      let imported = 0;
      let apiErrors = 0;
      const validationErrors: string[] = [];

      const grouped: Record<string, { description: string; testTypeCode: string; assertion: string; framework: string; significantRisk: boolean }[]> = {};

      for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
        const parts = dataRows[rowIdx];
        const get = (idx: number) => idx >= 0 && idx < parts.length ? (parts[idx] || '').toString().trim() : '';
        const fsLine = get(iFS);
        const description = get(iDesc);
        const typeName = get(iType);
        const assertion = get(iAssert);
        const framework = iFramework >= 0 ? get(iFramework) : '';
        const sigRisk = get(iSigRisk);
        if (!fsLine && !description) continue; // skip blank rows

        const rowNum = rowIdx + 2; // 1-indexed + header
        const rowErrors: string[] = [];

        if (!fsLine) rowErrors.push('FS Line Item is required');
        if (!description) rowErrors.push('Test Description is required');

        // Validate Type
        const typeLC = (typeName || '').toLowerCase();
        const matchedType = testTypes.find(t => t.name.toLowerCase() === typeLC || t.code.toLowerCase() === typeLC);
        if (typeName && !matchedType) {
          rowErrors.push(`Invalid Type "${typeName}" (valid: ${testTypes.map(t => t.name).join(', ')})`);
        }
        const typeCode = matchedType?.code || testTypes[0]?.code || '';

        // Validate Assertion (flexible matching: allow common typos, partial matches)
        const assertionLC = (assertion || '').toLowerCase().replace(/\s+/g, ' ');
        const matchedAssertion = ASSERTION_TYPES.find(a => {
          const aLC = a.toLowerCase();
          return aLC === assertionLC
            || aLC.replace('occurrence', 'occurence') === assertionLC  // common typo
            || aLC.replace('&', 'and') === assertionLC.replace('&', 'and')
            || aLC.startsWith(assertionLC) || assertionLC.startsWith(aLC);
        }) || '';
        if (assertion && !matchedAssertion) {
          rowErrors.push(`Invalid Assertion "${assertion}"`);
        }

        // Validate Framework
        const frameworkLC = (framework || '').toLowerCase();
        const matchedFramework = frameworkOptions.find(f => f.toLowerCase() === frameworkLC) || '';
        if (framework && !matchedFramework && framework.toLowerCase() !== 'all') {
          rowErrors.push(`Invalid Framework "${framework}" (valid: ${frameworkOptions.join(', ')})`);
        }

        // Validate Significant Risk
        if (sigRisk && !['Y', 'N', 'YES', 'NO', ''].includes(sigRisk.toUpperCase())) {
          rowErrors.push(`Invalid Significant Risk "${sigRisk}" (use Y or N)`);
        }

        if (rowErrors.length > 0) {
          validationErrors.push(`Row ${rowNum}: ${rowErrors.join('; ')}`);
          continue;
        }

        if (!fsLine || !description) continue;
        if (!grouped[fsLine]) grouped[fsLine] = [];
        grouped[fsLine].push({
          description,
          testTypeCode: typeCode,
          assertion: matchedAssertion,
          framework: matchedFramework,
          significantRisk: ['Y', 'YES'].includes((sigRisk || '').toUpperCase()),
        });
      }

      // Show validation errors if any
      if (validationErrors.length > 0 && Object.keys(grouped).length === 0) {
        setUploadResult(`Upload failed - validation errors:\n${validationErrors.slice(0, 10).join('\n')}${validationErrors.length > 10 ? `\n...and ${validationErrors.length - 10} more` : ''}`);
        return;
      }

      // Import valid rows
      for (const [fsLine, tests] of Object.entries(grouped)) {
        if (!fsLines.includes(fsLine)) setFsLines(prev => [...prev, fsLine]);
        try {
          const res = await fetch('/api/methodology-admin/test-bank', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firmId, industryId: selectedIndustry, fsLine, tests }),
          });
          if (res.ok) {
            const data = await res.json();
            setTestBanks(prev => {
              const filtered = prev.filter(tb => !(tb.industryId === selectedIndustry && tb.fsLine === fsLine));
              return [...filtered, data.entry];
            });
            imported += tests.length;
          } else { apiErrors++; }
        } catch { apiErrors++; }
      }

      const parts: string[] = [`Imported ${imported} tests across ${Object.keys(grouped).length} FS lines`];
      if (validationErrors.length > 0) parts.push(`${validationErrors.length} rows skipped due to validation errors`);
      if (apiErrors > 0) parts.push(`${apiErrors} API errors`);
      setUploadResult(parts.join('. '));
    } catch (err: any) {
      console.error('Upload error:', err);
      setUploadResult(`Upload failed: ${err?.message || 'invalid file format'}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

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
        <div className={`text-sm px-4 py-2 rounded-lg ${uploadResult.includes('failed') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {uploadResult}
        </div>
      )}

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
          <div className="bg-white rounded-lg shadow-xl w-[1050px] max-h-[80vh] overflow-y-auto p-6">
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
                        {ASSERTION_TYPES.map(a => (
                          <option key={a} value={a}>{a}</option>
                        ))}
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
                        {frameworkOptions.map(fw => (
                          <option key={fw} value={fw}>{fw}</option>
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
                onClick={() => setPopupTests((prev) => [...prev, { description: '', testTypeCode: '', assertion: '', framework: '', significantRisk: false }])}
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
