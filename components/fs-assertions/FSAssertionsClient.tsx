'use client';

import { useState, useCallback } from 'react';
import { Loader2, CheckCircle2, Import, Sparkles, Check } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface Period { id: string; startDate: string; endDate: string }
interface AssignedClient {
  id: string; clientName: string;
  periods: Period[];
}
interface COAItem { id: string; accountCode: string; accountName: string; categoryType: string; sortOrder: number }

const ASSERTION_COLS = [
  { key: 'completeness', label: 'Completeness' },
  { key: 'occurrence', label: 'Occurrence & Accuracy' },
  { key: 'cutOff', label: 'Cut Off' },
  { key: 'classification', label: 'Classification' },
  { key: 'presentation', label: 'Presentation' },
  { key: 'existence', label: 'Existence' },
  { key: 'valuation', label: 'Valuation' },
  { key: 'rights', label: 'Rights and Obligations' },
] as const;

type AssertionKey = typeof ASSERTION_COLS[number]['key'];

interface AssertionRow {
  rowKey: string;
  rowLabel: string;
  assertions: Record<AssertionKey, { checked: boolean; source: 'manual' | 'import_py' | 'auto_complete' }>;
}

// ── Props ────────────────────────────────────────────────────────────────────

export interface FSAssertionsClientProps {
  userId: string;
  assignedClients: AssignedClient[];
  chartOfAccounts: COAItem[];
  fsHeadings: string[];
}

// ── Component ────────────────────────────────────────────────────────────────

export function FSAssertionsClient({
  assignedClients, chartOfAccounts, fsHeadings,
}: FSAssertionsClientProps) {

  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const selectedClient = assignedClients.find(c => c.id === selectedClientId) ?? null;

  const [mappingType, setMappingType] = useState<'fs_level' | 'tb_code'>('fs_level');
  const [rows, setRows] = useState<AssertionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importingPY, setImportingPY] = useState(false);
  const [autoCompleting, setAutoCompleting] = useState(false);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const emptyAssertions = (): AssertionRow['assertions'] => {
    const obj = {} as AssertionRow['assertions'];
    for (const col of ASSERTION_COLS) {
      obj[col.key] = { checked: false, source: 'manual' };
    }
    return obj;
  };

  const buildRows = useCallback((type: 'fs_level' | 'tb_code'): AssertionRow[] => {
    if (type === 'fs_level') {
      return fsHeadings.map(h => ({
        rowKey: h.toLowerCase().replace(/[^a-z0-9]/g, '_'),
        rowLabel: h,
        assertions: emptyAssertions(),
      }));
    }
    return chartOfAccounts.map(a => ({
      rowKey: a.accountCode,
      rowLabel: `${a.accountCode} - ${a.accountName}`,
      assertions: emptyAssertions(),
    }));
  }, [fsHeadings, chartOfAccounts]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleClientChange = (clientId: string) => {
    setSelectedClientId(clientId);
    setSelectedPeriodId('');
    setRows([]);
  };

  const handlePeriodChange = async (periodId: string) => {
    setSelectedPeriodId(periodId);
    setLoading(true);
    try {
      const res = await fetch(`/api/fs-assertions?clientId=${selectedClientId}&periodId=${periodId}&mappingType=${mappingType}`);
      if (res.ok) {
        const data = await res.json();
        if (data.mappings?.length) {
          setRows(data.mappings.map((m: { rowKey: string; rowLabel: string; completeness: boolean; occurrence: boolean; cutOff: boolean; classification: boolean; presentation: boolean; existence: boolean; valuation: boolean; rights: boolean; source: string }) => ({
            rowKey: m.rowKey,
            rowLabel: m.rowLabel,
            assertions: {
              completeness: { checked: m.completeness, source: m.source as AssertionRow['assertions']['completeness']['source'] },
              occurrence: { checked: m.occurrence, source: m.source as AssertionRow['assertions']['completeness']['source'] },
              cutOff: { checked: m.cutOff, source: m.source as AssertionRow['assertions']['completeness']['source'] },
              classification: { checked: m.classification, source: m.source as AssertionRow['assertions']['completeness']['source'] },
              presentation: { checked: m.presentation, source: m.source as AssertionRow['assertions']['completeness']['source'] },
              existence: { checked: m.existence, source: m.source as AssertionRow['assertions']['completeness']['source'] },
              valuation: { checked: m.valuation, source: m.source as AssertionRow['assertions']['completeness']['source'] },
              rights: { checked: m.rights, source: m.source as AssertionRow['assertions']['completeness']['source'] },
            },
          })));
        } else {
          setRows(buildRows(mappingType));
        }
      } else {
        setRows(buildRows(mappingType));
      }
    } catch {
      setRows(buildRows(mappingType));
    }
    setLoading(false);
  };

  const handleToggleType = (type: 'fs_level' | 'tb_code') => {
    setMappingType(type);
    if (selectedPeriodId) {
      // Re-fetch
      handlePeriodChange(selectedPeriodId);
    }
  };

  const toggleAssertion = (rowKey: string, colKey: AssertionKey) => {
    setRows(prev => prev.map(r => {
      if (r.rowKey !== rowKey) return r;
      const current = r.assertions[colKey];
      return {
        ...r,
        assertions: {
          ...r.assertions,
          [colKey]: { checked: !current.checked, source: 'manual' as const },
        },
      };
    }));
  };

  const handleImportPY = async () => {
    if (!selectedClientId || !selectedPeriodId) return;
    setImportingPY(true);
    try {
      const res = await fetch('/api/fs-assertions/import-py', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: selectedClientId, periodId: selectedPeriodId, mappingType }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.mappings?.length) {
          setRows(data.mappings.map((m: { rowKey: string; rowLabel: string; completeness: boolean; occurrence: boolean; cutOff: boolean; classification: boolean; presentation: boolean; existence: boolean; valuation: boolean; rights: boolean }) => ({
            rowKey: m.rowKey,
            rowLabel: m.rowLabel,
            assertions: {
              completeness: { checked: m.completeness, source: 'import_py' as const },
              occurrence: { checked: m.occurrence, source: 'import_py' as const },
              cutOff: { checked: m.cutOff, source: 'import_py' as const },
              classification: { checked: m.classification, source: 'import_py' as const },
              presentation: { checked: m.presentation, source: 'import_py' as const },
              existence: { checked: m.existence, source: 'import_py' as const },
              valuation: { checked: m.valuation, source: 'import_py' as const },
              rights: { checked: m.rights, source: 'import_py' as const },
            },
          })));
        }
      }
    } catch { /* ignore */ }
    setImportingPY(false);
  };

  const handleAutoComplete = async () => {
    if (!selectedClientId || !selectedPeriodId) return;
    setAutoCompleting(true);
    try {
      const res = await fetch('/api/fs-assertions/auto-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: selectedClientId,
          periodId: selectedPeriodId,
          mappingType,
          rows: rows.map(r => ({ rowKey: r.rowKey, rowLabel: r.rowLabel })),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.suggestions) {
          setRows(prev => prev.map(r => {
            const suggestion = (data.suggestions as Record<string, Record<AssertionKey, boolean>>)[r.rowKey];
            if (!suggestion) return r;
            const newAssertions = { ...r.assertions };
            for (const key of Object.keys(suggestion) as AssertionKey[]) {
              if (suggestion[key] && !r.assertions[key].checked) {
                newAssertions[key] = { checked: true, source: 'auto_complete' };
              }
            }
            return { ...r, assertions: newAssertions };
          }));
        }
      }
    } catch { /* ignore */ }
    setAutoCompleting(false);
  };

  const handleAcceptAll = () => {
    setRows(prev => prev.map(r => {
      const newAssertions = { ...r.assertions };
      for (const key of Object.keys(newAssertions) as AssertionKey[]) {
        if (newAssertions[key].checked && newAssertions[key].source !== 'manual') {
          newAssertions[key] = { checked: true, source: 'manual' };
        }
      }
      return { ...r, assertions: newAssertions };
    }));
  };

  const handleSave = async () => {
    if (!selectedClientId || !selectedPeriodId) return;
    setSaving(true);
    try {
      await fetch('/api/fs-assertions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: selectedClientId,
          periodId: selectedPeriodId,
          mappingType,
          rows: rows.map(r => ({
            rowKey: r.rowKey,
            rowLabel: r.rowLabel,
            completeness: r.assertions.completeness.checked,
            occurrence: r.assertions.occurrence.checked,
            cutOff: r.assertions.cutOff.checked,
            classification: r.assertions.classification.checked,
            presentation: r.assertions.presentation.checked,
            existence: r.assertions.existence.checked,
            valuation: r.assertions.valuation.checked,
            rights: r.assertions.rights.checked,
            source: r.assertions.completeness.source, // representative source
          })),
        }),
      });
    } catch { /* ignore */ }
    setSaving(false);
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const hasSession = !!selectedClientId && !!selectedPeriodId;

  const getDotColor = (a: { checked: boolean; source: string }) => {
    if (!a.checked) return 'bg-slate-200';
    if (a.source === 'import_py') return 'bg-orange-300';
    if (a.source === 'auto_complete') return 'bg-slate-800';
    return 'bg-green-500';
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Sticky Client / Period selector */}
      <div className="sticky top-16 z-40 bg-white border-b shadow-sm px-6 py-3">
        <div className="flex items-center gap-4 max-w-7xl mx-auto">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">Client</label>
            <select
              value={selectedClientId}
              onChange={e => handleClientChange(e.target.value)}
              className="rounded-md border-slate-300 text-sm py-1.5 px-3 bg-white shadow-sm"
            >
              <option value="">Select client...</option>
              {assignedClients.map(c => (
                <option key={c.id} value={c.id}>{c.clientName}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">Period</label>
            <select
              value={selectedPeriodId}
              onChange={e => handlePeriodChange(e.target.value)}
              disabled={!selectedClientId}
              className="rounded-md border-slate-300 text-sm py-1.5 px-3 bg-white shadow-sm disabled:opacity-50"
            >
              <option value="">Select period...</option>
              {selectedClient?.periods.map(p => (
                <option key={p.id} value={p.id}>
                  {new Date(p.startDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  {' – '}
                  {new Date(p.endDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {!hasSession ? (
        <div className="flex items-center justify-center h-[calc(100vh-12rem)]">
          <div className="text-center text-slate-500">
            <p className="text-lg font-medium">FS Assertions Mapping</p>
            <p className="mt-2 text-sm">Select a client and period to begin.</p>
          </div>
        </div>
      ) : (
        <div className="max-w-7xl mx-auto px-6 py-6 space-y-4">
          {/* Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex bg-white border rounded-lg overflow-hidden">
              <button
                onClick={() => handleToggleType('fs_level')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  mappingType === 'fs_level'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                Financial Statements Level
              </button>
              <button
                onClick={() => handleToggleType('tb_code')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  mappingType === 'tb_code'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                TB Code Level
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleImportPY}
                disabled={importingPY}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-orange-50 text-orange-700 border border-orange-200 rounded-md hover:bg-orange-100 disabled:opacity-50"
              >
                {importingPY ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Import className="h-3.5 w-3.5" />}
                Import from PY
              </button>
              <button
                onClick={handleAutoComplete}
                disabled={autoCompleting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200 rounded-md hover:bg-slate-200 disabled:opacity-50"
              >
                {autoCompleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Auto-Complete
              </button>
              <button
                onClick={handleAcceptAll}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-50 text-green-700 border border-green-200 rounded-md hover:bg-green-100"
              >
                <Check className="h-3.5 w-3.5" /> Accept All
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Save
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
            </div>
          ) : (
            <div className="bg-white rounded-lg border shadow-sm overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-slate-600 border-b min-w-[250px]">
                      {mappingType === 'fs_level' ? 'Financial Statement Heading' : 'Account Code / Description'}
                    </th>
                    {ASSERTION_COLS.map(col => (
                      <th key={col.key} className="px-1 py-3 border-b w-[70px]">
                        <div className="writing-vertical text-slate-500 font-medium whitespace-nowrap"
                          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', minHeight: '100px' }}
                        >
                          {col.label}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.rowKey} className="border-b hover:bg-slate-50/50">
                      <td className="px-4 py-2 text-slate-700 font-medium">{row.rowLabel}</td>
                      {ASSERTION_COLS.map(col => {
                        const a = row.assertions[col.key];
                        return (
                          <td key={col.key} className="text-center px-1 py-2 border-l border-slate-100">
                            <button
                              onClick={() => toggleAssertion(row.rowKey, col.key)}
                              className="mx-auto"
                            >
                              <div className={`w-4 h-4 rounded-full transition-colors ${getDotColor(a)}`} />
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Legend */}
              <div className="flex items-center gap-4 px-4 py-2 border-t bg-slate-50 text-xs text-slate-500">
                <span className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-green-500" /> Manual / Accepted</span>
                <span className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-orange-300" /> Imported from PY</span>
                <span className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-slate-800" /> Auto-Completed</span>
                <span className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-slate-200" /> Not selected</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
