'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { CheckCircle2, Loader2, Upload, Download, AlertTriangle, Calculator, Users, Building2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * PayrollTestPanel — Multi-tab workpaper for wages & salary substantive testing.
 * Tabs: Payroll Lead | Payroll Recon | HMRC Recon | Pensions Recon | Joiners & Leavers
 */

interface Props {
  engagementId: string;
  fsLine: string;
  onClose?: () => void;
}

type PayrollTab = 'lead' | 'payroll_recon' | 'hmrc_recon' | 'pensions_recon' | 'joiners_leavers' | 'holiday_pay';

const TABS: { key: PayrollTab; label: string; icon: any }[] = [
  { key: 'lead', label: 'Payroll Lead', icon: FileText },
  { key: 'payroll_recon', label: 'Payroll Recon', icon: Calculator },
  { key: 'hmrc_recon', label: 'HMRC Recon', icon: Building2 },
  { key: 'pensions_recon', label: 'Pensions Recon', icon: Building2 },
  { key: 'joiners_leavers', label: 'Joiners & Leavers', icon: Users },
  { key: 'holiday_pay', label: 'Holiday Pay', icon: Calculator },
];

function fmt(v: number): string {
  const abs = Math.abs(v);
  const s = abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
}

function pct(v: number): string {
  return (v * 100).toFixed(1) + '%';
}

export function PayrollTestPanel({ engagementId, fsLine, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<PayrollTab>('lead');
  const [testData, setTestData] = useState<any>(null);
  const [tbRows, setTbRows] = useState<any[]>([]);
  const [materiality, setMateriality] = useState({ overall: 0, pm: 0, ct: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const saveTimeout = useRef<NodeJS.Timeout | null>(null);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/payroll-test?fsLine=${encodeURIComponent(fsLine)}`);
      if (res.ok) {
        const data = await res.json();
        setTestData(data.test);
        setTbRows(data.tbRows || []);
        setMateriality(data.materiality || { overall: 0, pm: 0, ct: 0 });
      }
    } catch {} finally { setLoading(false); }
  }, [engagementId, fsLine]);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-save helper
  function autoSave(field: string, value: any) {
    setTestData((prev: any) => ({ ...prev, [field]: value }));
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(async () => {
      setSaving(true);
      try {
        await fetch(`/api/engagements/${engagementId}/payroll-test`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fsLine, [field]: value }),
        });
      } catch {} finally { setSaving(false); }
    }, 1500);
  }

  if (loading) return <div className="p-6 text-center text-xs text-slate-400 animate-pulse">Loading payroll test...</div>;

  return (
    <div className="border border-slate-200 rounded-lg bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50/50">
        <Calculator className="h-4 w-4 text-blue-600" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-slate-800">Payroll Substantive Test</div>
          <div className="text-[10px] text-slate-400">{fsLine}</div>
        </div>
        {saving && <span className="text-[9px] text-blue-500 animate-pulse">Saving...</span>}
        <div className="text-[9px] text-slate-400">
          OM: {fmt(materiality.overall)} | PM: {fmt(materiality.pm)} | CT: {fmt(materiality.ct)}
        </div>
        {onClose && <button onClick={onClose} className="text-slate-400 hover:text-slate-600">x</button>}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-slate-200 bg-white overflow-x-auto">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1 px-3 py-2 text-[10px] font-medium whitespace-nowrap border-b-2 transition-colors ${
                isActive ? 'border-blue-500 text-blue-700 bg-blue-50/50' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}>
              <Icon className="h-3 w-3" /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="p-4 overflow-auto max-h-[600px]">
        {activeTab === 'lead' && (
          <PayrollLeadTab
            data={testData?.leadSchedule}
            tbRows={tbRows}
            materiality={materiality}
            onChange={(v: any) => autoSave('leadSchedule', v)}
            engagementId={engagementId}
            fsLine={fsLine}
          />
        )}
        {activeTab === 'payroll_recon' && (
          <PayrollReconTab
            data={testData?.payrollRecon}
            payrollData={testData?.payrollData}
            materiality={materiality}
            onChange={(v: any) => autoSave('payrollRecon', v)}
            engagementId={engagementId}
            fsLine={fsLine}
          />
        )}
        {activeTab === 'hmrc_recon' && (
          <HMRCReconTab
            data={testData?.hmrcRecon}
            payrollData={testData?.payrollData}
            materiality={materiality}
            onChange={(v: any) => autoSave('hmrcRecon', v)}
          />
        )}
        {activeTab === 'pensions_recon' && (
          <PensionsReconTab
            data={testData?.pensionsRecon}
            payrollData={testData?.payrollData}
            materiality={materiality}
            onChange={(v: any) => autoSave('pensionsRecon', v)}
          />
        )}
        {activeTab === 'joiners_leavers' && (
          <JoinersLeaversTab
            joiners={testData?.joiners}
            leavers={testData?.leavers}
            materiality={materiality}
            onChangeJoiners={(v: any) => autoSave('joiners', v)}
            onChangeLeavers={(v: any) => autoSave('leavers', v)}
          />
        )}
        {activeTab === 'holiday_pay' && (
          <HolidayPayTab
            data={testData?.holidayPay}
            materiality={materiality}
            onChange={(v: any) => autoSave('holidayPay', v)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Payroll Lead Tab ───

function PayrollLeadTab({ data, tbRows, materiality, onChange, engagementId, fsLine }: any) {
  const rows = data?.rows || [];
  const [populating, setPopulating] = useState(false);

  // Filter TB rows that look like payroll accounts
  const payrollKeywords = ['salary', 'salaries', 'wage', 'wages', 'payroll', 'bonus', 'commission', 'pension', 'nic', 'n.i', 'national insurance', 'redundancy', 'recruitment', 'health insurance', 'life insurance', 'staff', 'employment'];
  const suggestedAccounts = tbRows.filter((r: any) =>
    payrollKeywords.some(kw => r.description?.toLowerCase().includes(kw)) ||
    r.fsLevel?.toLowerCase().includes('wage') || r.fsLevel?.toLowerCase().includes('staff')
  );

  async function populateFromTB() {
    setPopulating(true);
    try {
      const codes = suggestedAccounts.map((r: any) => r.accountCode);
      const res = await fetch(`/api/engagements/${engagementId}/payroll-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'populate_lead', fsLine, accountCodes: codes }),
      });
      if (res.ok) {
        const { test } = await res.json();
        onChange(test.leadSchedule);
      }
    } finally { setPopulating(false); }
  }

  const total = rows.reduce((s: number, r: any) => s + (r.finalCY || 0), 0);
  const totalPY = rows.reduce((s: number, r: any) => s + (r.pyBalance || 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-slate-700 uppercase">Payroll Lead Schedule</h3>
        {rows.length === 0 && (
          <Button onClick={populateFromTB} disabled={populating} size="sm" className="bg-blue-600 hover:bg-blue-700 text-xs">
            {populating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Auto-Populate from TB ({suggestedAccounts.length} accounts)
          </Button>
        )}
      </div>

      {rows.length > 0 && (
        <div className="border rounded overflow-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="bg-slate-100 border-b">
                <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Account Code</th>
                <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Account Name</th>
                <th className="px-2 py-1.5 text-right font-semibold text-slate-600">CY Balance</th>
                <th className="px-2 py-1.5 text-right font-semibold text-slate-600">Adj</th>
                <th className="px-2 py-1.5 text-right font-semibold text-slate-600">Final CY</th>
                <th className="px-2 py-1.5 text-right font-semibold text-slate-600">PY Balance</th>
                <th className="px-2 py-1.5 text-right font-semibold text-slate-600">Variance</th>
                <th className="px-2 py-1.5 text-right font-semibold text-slate-600">%</th>
                <th className="px-2 py-1.5 text-left font-semibold text-slate-600">WP Ref</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any, i: number) => {
                const variance = (row.finalCY || 0) - (row.pyBalance || 0);
                const varPct = row.pyBalance ? variance / Math.abs(row.pyBalance) : 0;
                const isSignificant = Math.abs(variance) > materiality.ct;
                return (
                  <tr key={i} className={`border-b border-slate-50 ${isSignificant ? 'bg-amber-50/50' : ''}`}>
                    <td className="px-2 py-1 font-mono text-slate-500">{row.accountCode}</td>
                    <td className="px-2 py-1 text-slate-700">{row.accountName}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(row.cyBalance || 0)}</td>
                    <td className="px-2 py-1 text-right font-mono text-blue-600">{row.adjustment ? fmt(row.adjustment) : '—'}</td>
                    <td className="px-2 py-1 text-right font-mono font-medium">{fmt(row.finalCY || 0)}</td>
                    <td className="px-2 py-1 text-right font-mono text-slate-500">{fmt(row.pyBalance || 0)}</td>
                    <td className={`px-2 py-1 text-right font-mono ${variance > 0 ? 'text-green-600' : variance < 0 ? 'text-red-600' : ''}`}>{fmt(variance)}</td>
                    <td className="px-2 py-1 text-right font-mono text-slate-500">{pct(varPct)}</td>
                    <td className="px-2 py-1 text-slate-400">{row.wpRef || ''}</td>
                  </tr>
                );
              })}
              {/* Totals */}
              <tr className="bg-slate-100 font-bold">
                <td colSpan={2} className="px-2 py-1.5 text-slate-700">Total</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmt(total)}</td>
                <td></td>
                <td className="px-2 py-1.5 text-right font-mono">{fmt(total)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmt(totalPY)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmt(total - totalPY)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{totalPY ? pct((total - totalPY) / Math.abs(totalPY)) : '—'}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {rows.length === 0 && (
        <div className="text-center py-8 text-xs text-slate-400">
          <FileText className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          No lead schedule data. Click "Auto-Populate from TB" to import payroll account codes.
        </div>
      )}
    </div>
  );
}

// ─── Payroll Reconciliation Tab ───

function PayrollReconTab({ data, payrollData, materiality, onChange, engagementId, fsLine }: any) {
  const months = data?.months || [];
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const COLS = [
    { key: 'period', label: 'Period', type: 'date' },
    { key: 'gross', label: 'Gross', type: 'number' },
    { key: 'salSacrifice', label: 'Sal. Sacrifice', type: 'number' },
    { key: 'tax', label: 'Tax', type: 'number' },
    { key: 'eeNI', label: 'EE NI', type: 'number' },
    { key: 'hscLevy', label: 'HSC', type: 'number' },
    { key: 'studentLoan', label: 'Student Loan', type: 'number' },
    { key: 'eePension', label: 'EE Pension', type: 'number' },
    { key: 'netDeductions', label: 'Net Ded.', type: 'number' },
    { key: 'netPerReport', label: 'Net (Report)', type: 'number' },
    { key: 'netPerCalc', label: 'Net (Calc)', type: 'calc' },
    { key: 'diff', label: 'Diff', type: 'diff' },
    { key: 'erNI', label: "Er's NI", type: 'number' },
    { key: 'erPension', label: "Er's Pension", type: 'number' },
    { key: 'bankNetPay', label: 'Bank Net Pay', type: 'number' },
  ];

  function calcNet(row: any): number {
    return (row.gross || 0) - (row.salSacrifice || 0) - (row.tax || 0) - (row.eeNI || 0) - (row.hscLevy || 0) - (row.studentLoan || 0) - (row.eePension || 0) - (row.netDeductions || 0);
  }

  function updateCell(idx: number, key: string, value: string) {
    const updated = [...months];
    updated[idx] = { ...updated[idx], [key]: key === 'period' ? value : parseFloat(value) || 0 };
    onChange({ ...data, months: updated });
  }

  function addEmptyMonths() {
    const emptyMonths = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(2024, i, 1);
      return { period: d.toISOString().split('T')[0], gross: 0, salSacrifice: 0, tax: 0, eeNI: 0, hscLevy: 0, studentLoan: 0, eePension: 0, netDeductions: 0, netPerReport: 0, erNI: 0, erPension: 0, bankNetPay: 0 };
    });
    onChange({ ...data, months: emptyMonths });
  }

  // Parse CSV/Excel payroll data
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const text = await file.text();
      const lines = text.split('\n').map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
      // Try to detect header row and parse
      const headerIdx = lines.findIndex(l => l.some(c => c.toLowerCase().includes('gross') || c.toLowerCase().includes('period')));
      if (headerIdx >= 0) {
        const headers = lines[headerIdx].map(h => h.toLowerCase());
        const dataLines = lines.slice(headerIdx + 1).filter(l => l.length > 2 && l[0]);
        const parsed = dataLines.map(l => {
          const row: any = {};
          headers.forEach((h, i) => {
            const v = l[i] || '';
            if (h.includes('period') || h.includes('month') || h.includes('date')) row.period = v;
            else if (h.includes('gross')) row.gross = parseFloat(v) || 0;
            else if (h.includes('sacrifice')) row.salSacrifice = parseFloat(v) || 0;
            else if (h.includes('tax') || h.includes('paye')) row.tax = parseFloat(v) || 0;
            else if (h.includes('employee ni') || h.includes('ee ni')) row.eeNI = parseFloat(v) || 0;
            else if (h.includes('student')) row.studentLoan = parseFloat(v) || 0;
            else if (h.includes('employee pension') || h.includes('ee pension')) row.eePension = parseFloat(v) || 0;
            else if (h.includes('net') && !h.includes('deduction')) row.netPerReport = parseFloat(v) || 0;
            else if (h.includes('employer ni') || h.includes('er ni')) row.erNI = parseFloat(v) || 0;
            else if (h.includes('employer pension') || h.includes('er pension')) row.erPension = parseFloat(v) || 0;
          });
          return row;
        });
        if (parsed.length > 0) onChange({ ...data, months: parsed });
      }
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  // Totals
  const totals: Record<string, number> = {};
  for (const col of COLS) {
    if (col.type === 'number') totals[col.key] = months.reduce((s: number, m: any) => s + (m[col.key] || 0), 0);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-slate-700 uppercase">Payroll Reconciliation (12-Month Grid)</h3>
        <div className="flex gap-1">
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="flex items-center gap-1 px-2 py-1 text-[9px] bg-blue-50 text-blue-600 rounded hover:bg-blue-100">
            <Upload className="h-3 w-3" /> {uploading ? 'Uploading...' : 'Import CSV'}
          </button>
          <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
          {months.length === 0 && (
            <button onClick={addEmptyMonths} className="px-2 py-1 text-[9px] bg-slate-50 text-slate-600 rounded hover:bg-slate-100">
              Add 12 Empty Months
            </button>
          )}
        </div>
      </div>

      {months.length > 0 && (
        <div className="border rounded overflow-auto">
          <table className="text-[9px] border-collapse w-full">
            <thead>
              <tr className="bg-slate-100 border-b">
                {COLS.map(col => (
                  <th key={col.key} className="px-1 py-1 font-semibold text-slate-600 whitespace-nowrap text-right first:text-left">{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map((m: any, i: number) => {
                const netCalc = calcNet(m);
                const diff = (m.netPerReport || 0) - netCalc;
                const hasDiff = Math.abs(diff) > 0.01;
                return (
                  <tr key={i} className={`border-b border-slate-50 ${hasDiff ? 'bg-red-50/50' : ''}`}>
                    {COLS.map(col => (
                      <td key={col.key} className="px-0.5 py-0">
                        {col.type === 'calc' ? (
                          <span className="block text-right px-1 py-0.5 font-mono text-slate-600">{fmt(netCalc)}</span>
                        ) : col.type === 'diff' ? (
                          <span className={`block text-right px-1 py-0.5 font-mono font-bold ${hasDiff ? 'text-red-600' : 'text-green-600'}`}>
                            {fmt(diff)}
                          </span>
                        ) : (
                          <input
                            type={col.type === 'date' ? 'text' : 'text'}
                            value={col.type === 'number' ? (m[col.key] || '') : (m[col.key] || '')}
                            onChange={e => updateCell(i, col.key, e.target.value)}
                            className="w-full text-right px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none font-mono"
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {/* Totals row */}
              <tr className="bg-slate-100 font-bold border-t">
                <td className="px-1 py-1 text-left">Total</td>
                {COLS.slice(1).map(col => (
                  <td key={col.key} className="px-1 py-1 text-right font-mono">
                    {col.type === 'number' ? fmt(totals[col.key] || 0) : ''}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {months.length === 0 && (
        <div className="text-center py-8 text-xs text-slate-400">
          <Calculator className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          Import a payroll summary CSV or add empty months to start the reconciliation.
        </div>
      )}
    </div>
  );
}

// ─── HMRC Reconciliation Tab ───

function HMRCReconTab({ data, payrollData, materiality, onChange }: any) {
  const months = data?.months || [];

  const COLS = [
    { key: 'period', label: 'Month' },
    { key: 'paye', label: 'PAYE' },
    { key: 'studentLoan', label: 'Student Loan' },
    { key: 'erNI', label: "Er's NI" },
    { key: 'eeNI', label: "Ee's NI" },
    { key: 'other', label: 'Other' },
    { key: 'total', label: 'Total', calc: true },
    { key: 'notes', label: 'Notes', type: 'text' },
    { key: 'bankDate', label: 'Bank Date' },
    { key: 'bankAmount', label: 'Bank Amount' },
    { key: 'bankName', label: 'Bank' },
    { key: 'diff', label: 'Diff', diff: true },
    { key: 'bankNotes', label: 'Notes', type: 'text' },
  ];

  function calcTotal(row: any): number {
    return (row.paye || 0) + (row.studentLoan || 0) + (row.erNI || 0) + (row.eeNI || 0) + (row.other || 0);
  }

  function updateCell(idx: number, key: string, value: string) {
    const updated = [...months];
    updated[idx] = { ...updated[idx], [key]: ['period', 'notes', 'bankDate', 'bankName', 'bankNotes'].includes(key) ? value : parseFloat(value) || 0 };
    onChange({ ...data, months: updated });
  }

  function addEmptyMonths() {
    const emptyMonths = Array.from({ length: 12 }, (_, i) => ({
      period: new Date(2024, i, 1).toISOString().split('T')[0], paye: 0, studentLoan: 0, erNI: 0, eeNI: 0, other: 0, bankDate: '', bankAmount: 0, bankName: '', notes: '', bankNotes: '',
    }));
    onChange({ ...data, months: emptyMonths });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold text-slate-700 uppercase">HMRC Reconciliation</h3>
          <p className="text-[9px] text-slate-400 mt-0.5">Reconcile PAYE, NI, and Student Loan payments to HMRC against bank statements</p>
        </div>
        {months.length === 0 && (
          <button onClick={addEmptyMonths} className="px-2 py-1 text-[9px] bg-slate-50 text-slate-600 rounded hover:bg-slate-100">Add 12 Months</button>
        )}
      </div>

      {months.length > 0 && (
        <div className="border rounded overflow-auto">
          <table className="text-[9px] border-collapse w-full">
            <thead>
              <tr className="bg-slate-100 border-b">
                <th colSpan={7} className="px-1 py-1 text-center font-semibold text-slate-600 border-r border-slate-200">Payroll Register</th>
                <th colSpan={6} className="px-1 py-1 text-center font-semibold text-slate-600">Bank Statement</th>
              </tr>
              <tr className="bg-slate-50 border-b">
                {COLS.map(col => (
                  <th key={col.key} className="px-1 py-1 font-semibold text-slate-600 whitespace-nowrap text-right first:text-left">{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map((m: any, i: number) => {
                const total = calcTotal(m);
                const diff = total - (m.bankAmount || 0);
                const hasDiff = Math.abs(diff) > materiality.ct;
                return (
                  <tr key={i} className={`border-b border-slate-50 ${hasDiff ? 'bg-red-50/50' : ''}`}>
                    {COLS.map(col => (
                      <td key={col.key} className="px-0.5 py-0">
                        {col.calc ? (
                          <span className="block text-right px-1 py-0.5 font-mono text-slate-700 font-medium">{fmt(total)}</span>
                        ) : col.diff ? (
                          <span className={`block text-right px-1 py-0.5 font-mono font-bold ${hasDiff ? 'text-red-600' : 'text-green-600'}`}>{fmt(diff)}</span>
                        ) : (
                          <input
                            value={m[col.key] ?? ''}
                            onChange={e => updateCell(i, col.key, e.target.value)}
                            className={`w-full px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none font-mono ${col.type === 'text' ? 'text-left' : 'text-right'}`}
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Pensions Reconciliation Tab ───

function PensionsReconTab({ data, payrollData, materiality, onChange }: any) {
  const months = data?.months || [];

  function updateCell(idx: number, key: string, value: string) {
    const updated = [...months];
    updated[idx] = { ...updated[idx], [key]: ['period', 'bankDate', 'bankName', 'notes'].includes(key) ? value : parseFloat(value) || 0 };
    onChange({ ...data, months: updated });
  }

  function addEmptyMonths() {
    const emptyMonths = Array.from({ length: 12 }, (_, i) => ({
      period: new Date(2024, i, 1).toISOString().split('T')[0], eePension: 0, erPension: 0, bankDate: '', bankAmount: 0, bankName: '', notes: '',
    }));
    onChange({ ...data, months: emptyMonths });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold text-slate-700 uppercase">Pensions Reconciliation</h3>
          <p className="text-[9px] text-slate-400 mt-0.5">Reconcile pension contributions (employee + employer) against bank statements</p>
        </div>
        {months.length === 0 && (
          <button onClick={addEmptyMonths} className="px-2 py-1 text-[9px] bg-slate-50 text-slate-600 rounded hover:bg-slate-100">Add 12 Months</button>
        )}
      </div>

      {months.length > 0 && (
        <div className="border rounded overflow-auto">
          <table className="text-[9px] border-collapse w-full">
            <thead>
              <tr className="bg-slate-100 border-b">
                <th colSpan={4} className="px-1 py-1 text-center font-semibold text-slate-600 border-r border-slate-200">Payroll Register</th>
                <th colSpan={5} className="px-1 py-1 text-center font-semibold text-slate-600">Bank Statement</th>
              </tr>
              <tr className="bg-slate-50 border-b">
                <th className="px-1 py-1 text-left font-semibold text-slate-600">Month</th>
                <th className="px-1 py-1 text-right font-semibold text-slate-600">EE Pension</th>
                <th className="px-1 py-1 text-right font-semibold text-slate-600">ER Pension</th>
                <th className="px-1 py-1 text-right font-semibold text-slate-600 border-r border-slate-200">Total</th>
                <th className="px-1 py-1 text-left font-semibold text-slate-600">Bank Date</th>
                <th className="px-1 py-1 text-right font-semibold text-slate-600">Amount</th>
                <th className="px-1 py-1 text-left font-semibold text-slate-600">Bank</th>
                <th className="px-1 py-1 text-right font-semibold text-slate-600">Diff</th>
                <th className="px-1 py-1 text-left font-semibold text-slate-600">Notes</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m: any, i: number) => {
                const total = (m.eePension || 0) + (m.erPension || 0);
                const diff = total - (m.bankAmount || 0);
                const hasDiff = Math.abs(diff) > materiality.ct;
                return (
                  <tr key={i} className={`border-b border-slate-50 ${hasDiff ? 'bg-red-50/50' : ''}`}>
                    <td className="px-0.5 py-0"><input value={m.period || ''} onChange={e => updateCell(i, 'period', e.target.value)} className="w-full px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none font-mono" /></td>
                    <td className="px-0.5 py-0"><input value={m.eePension ?? ''} onChange={e => updateCell(i, 'eePension', e.target.value)} className="w-full text-right px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none font-mono" /></td>
                    <td className="px-0.5 py-0"><input value={m.erPension ?? ''} onChange={e => updateCell(i, 'erPension', e.target.value)} className="w-full text-right px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none font-mono" /></td>
                    <td className="px-0.5 py-0 border-r border-slate-200"><span className="block text-right px-1 py-0.5 font-mono font-medium">{fmt(total)}</span></td>
                    <td className="px-0.5 py-0"><input value={m.bankDate || ''} onChange={e => updateCell(i, 'bankDate', e.target.value)} className="w-full px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none font-mono" /></td>
                    <td className="px-0.5 py-0"><input value={m.bankAmount ?? ''} onChange={e => updateCell(i, 'bankAmount', e.target.value)} className="w-full text-right px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none font-mono" /></td>
                    <td className="px-0.5 py-0"><input value={m.bankName || ''} onChange={e => updateCell(i, 'bankName', e.target.value)} className="w-full px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none font-mono" /></td>
                    <td className="px-0.5 py-0"><span className={`block text-right px-1 py-0.5 font-mono font-bold ${hasDiff ? 'text-red-600' : 'text-green-600'}`}>{fmt(diff)}</span></td>
                    <td className="px-0.5 py-0"><input value={m.notes || ''} onChange={e => updateCell(i, 'notes', e.target.value)} className="w-full px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Joiners & Leavers Tab ───

function JoinersLeaversTab({ joiners, leavers, materiality, onChangeJoiners, onChangeLeavers }: any) {
  const joinerRows = joiners || [];
  const leaverRows = leavers || [];

  function addJoiner() {
    onChangeJoiners([...joinerRows, { name: '', contractSeen: '', startMonth: '', annualSalary: 0, monthlySalary: 0, firstFullMonthPayroll: 0, diff: 0, notes: '' }]);
  }

  function addLeaver() {
    onChangeLeavers([...leaverRows, { name: '', p45Seen: '', lastMonthPaid: '', lastMonthP45: '', diff: 0, notes: '', terminationChecks: {} }]);
  }

  function updateJoiner(idx: number, key: string, value: any) {
    const updated = [...joinerRows];
    updated[idx] = { ...updated[idx], [key]: value };
    // Auto-calc monthly salary
    if (key === 'annualSalary') updated[idx].monthlySalary = (parseFloat(value) || 0) / 12;
    // Auto-calc diff
    if (['monthlySalary', 'firstFullMonthPayroll'].includes(key) || key === 'annualSalary') {
      updated[idx].diff = (updated[idx].monthlySalary || 0) - (updated[idx].firstFullMonthPayroll || 0);
    }
    onChangeJoiners(updated);
  }

  function updateLeaver(idx: number, key: string, value: any) {
    const updated = [...leaverRows];
    updated[idx] = { ...updated[idx], [key]: value };
    onChangeLeavers(updated);
  }

  function updateTermCheck(idx: number, checkKey: string, value: string) {
    const updated = [...leaverRows];
    updated[idx] = { ...updated[idx], terminationChecks: { ...(updated[idx].terminationChecks || {}), [checkKey]: value } };
    onChangeLeavers(updated);
  }

  return (
    <div className="space-y-6">
      {/* Joiners */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-700 uppercase">Joiners</h3>
          <button onClick={addJoiner} className="px-2 py-1 text-[9px] bg-blue-50 text-blue-600 rounded hover:bg-blue-100">+ Add Joiner</button>
        </div>

        {joinerRows.length > 0 && (
          <div className="border rounded overflow-auto">
            <table className="text-[9px] border-collapse w-full">
              <thead>
                <tr className="bg-green-50 border-b">
                  <th className="px-1 py-1 text-left font-semibold text-slate-600">Name</th>
                  <th className="px-1 py-1 text-center font-semibold text-slate-600">Contract</th>
                  <th className="px-1 py-1 text-left font-semibold text-slate-600">Start Month</th>
                  <th className="px-1 py-1 text-right font-semibold text-slate-600">Annual Salary</th>
                  <th className="px-1 py-1 text-right font-semibold text-slate-600">Monthly</th>
                  <th className="px-1 py-1 text-right font-semibold text-slate-600">1st Full Month (Payroll)</th>
                  <th className="px-1 py-1 text-right font-semibold text-slate-600">Diff</th>
                  <th className="px-1 py-1 text-left font-semibold text-slate-600">Notes</th>
                </tr>
              </thead>
              <tbody>
                {joinerRows.map((j: any, i: number) => {
                  const hasDiff = Math.abs(j.diff || 0) > materiality.ct;
                  return (
                    <tr key={i} className={`border-b border-slate-50 ${hasDiff ? 'bg-amber-50/50' : ''}`}>
                      <td className="px-0.5 py-0"><input value={j.name || ''} onChange={e => updateJoiner(i, 'name', e.target.value)} className="w-full px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none" /></td>
                      <td className="px-0.5 py-0 text-center">
                        <select value={j.contractSeen || ''} onChange={e => updateJoiner(i, 'contractSeen', e.target.value)} className="text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none">
                          <option value="">—</option><option value="Yes">Yes</option><option value="No">No</option>
                        </select>
                      </td>
                      <td className="px-0.5 py-0"><input value={j.startMonth || ''} onChange={e => updateJoiner(i, 'startMonth', e.target.value)} className="w-full px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none font-mono" /></td>
                      <td className="px-0.5 py-0"><input value={j.annualSalary ?? ''} onChange={e => updateJoiner(i, 'annualSalary', e.target.value)} className="w-full text-right px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none font-mono" /></td>
                      <td className="px-0.5 py-0"><span className="block text-right px-1 py-0.5 font-mono text-slate-600">{fmt(j.monthlySalary || 0)}</span></td>
                      <td className="px-0.5 py-0"><input value={j.firstFullMonthPayroll ?? ''} onChange={e => updateJoiner(i, 'firstFullMonthPayroll', parseFloat(e.target.value) || 0)} className="w-full text-right px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none font-mono" /></td>
                      <td className={`px-0.5 py-0 text-right font-mono font-bold ${hasDiff ? 'text-red-600' : 'text-green-600'}`}>{fmt(j.diff || 0)}</td>
                      <td className="px-0.5 py-0"><input value={j.notes || ''} onChange={e => updateJoiner(i, 'notes', e.target.value)} className="w-full px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Leavers */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-700 uppercase">Leavers</h3>
          <button onClick={addLeaver} className="px-2 py-1 text-[9px] bg-orange-50 text-orange-600 rounded hover:bg-orange-100">+ Add Leaver</button>
        </div>

        {leaverRows.length > 0 && (
          <div className="border rounded overflow-auto">
            <table className="text-[9px] border-collapse w-full">
              <thead>
                <tr className="bg-orange-50 border-b">
                  <th className="px-1 py-1 text-left font-semibold text-slate-600">#</th>
                  <th className="px-1 py-1 text-left font-semibold text-slate-600">Name</th>
                  <th className="px-1 py-1 text-center font-semibold text-slate-600">P45</th>
                  <th className="px-1 py-1 text-left font-semibold text-slate-600">Last Paid (Payroll)</th>
                  <th className="px-1 py-1 text-left font-semibold text-slate-600">Last Month (P45)</th>
                  <th className="px-1 py-1 text-right font-semibold text-slate-600">Diff</th>
                  <th className="px-1 py-1 text-left font-semibold text-slate-600">Notes</th>
                </tr>
              </thead>
              <tbody>
                {leaverRows.map((l: any, i: number) => (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="px-1 py-0.5 text-slate-400">{i + 1}</td>
                    <td className="px-0.5 py-0"><input value={l.name || ''} onChange={e => updateLeaver(i, 'name', e.target.value)} className="w-full px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none" /></td>
                    <td className="px-0.5 py-0 text-center">
                      <select value={l.p45Seen || ''} onChange={e => updateLeaver(i, 'p45Seen', e.target.value)} className="text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none">
                        <option value="">—</option><option value="Yes">Yes</option><option value="No">No</option>
                      </select>
                    </td>
                    <td className="px-0.5 py-0"><input value={l.lastMonthPaid || ''} onChange={e => updateLeaver(i, 'lastMonthPaid', e.target.value)} className="w-full px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none font-mono" /></td>
                    <td className="px-0.5 py-0"><input value={l.lastMonthP45 || ''} onChange={e => updateLeaver(i, 'lastMonthP45', e.target.value)} className="w-full px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none font-mono" /></td>
                    <td className="px-0.5 py-0"><input value={l.diff ?? ''} onChange={e => updateLeaver(i, 'diff', parseFloat(e.target.value) || 0)} className="w-full text-right px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none font-mono" /></td>
                    <td className="px-0.5 py-0"><input value={l.notes || ''} onChange={e => updateLeaver(i, 'notes', e.target.value)} className="w-full px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none" /></td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Termination checks for each leaver */}
            {leaverRows.some((l: any) => l.name) && (
              <div className="border-t border-slate-200 p-3 space-y-2">
                <div className="text-[10px] font-bold text-slate-600 uppercase">Leaver Additional Checks</div>
                {leaverRows.filter((l: any) => l.name).map((l: any, i: number) => (
                  <div key={i} className="border rounded p-2 space-y-1">
                    <div className="text-[10px] font-medium text-slate-700">{l.name}</div>
                    <div className="grid grid-cols-2 gap-1 text-[9px]">
                      {[
                        { key: 'noticeGiven', label: 'Notice given?' },
                        { key: 'terminationProvisions', label: 'Termination provisions?' },
                        { key: 'settlementAgreement', label: 'Settlement agreement?' },
                        { key: 'disciplinary', label: 'Disciplinary issues?' },
                        { key: 'companyAssetsReturned', label: 'Company assets returned?' },
                        { key: 'finalPayCorrect', label: 'Final pay correct?' },
                      ].map(check => (
                        <div key={check.key} className="flex items-center gap-1">
                          <label className="text-slate-500 flex-1">{check.label}</label>
                          <select value={(l.terminationChecks || {})[check.key] || ''} onChange={e => updateTermCheck(i, check.key, e.target.value)}
                            className="text-[9px] border border-slate-200 rounded px-1 py-0.5 w-16 focus:outline-none focus:border-blue-300">
                            <option value="">—</option><option value="Yes">Yes</option><option value="No">No</option><option value="N/A">N/A</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Holiday Pay Tab ───

function HolidayPayTab({ data, materiality, onChange }: { data: any; materiality: any; onChange: (v: any) => void }) {
  const hp = data || { employees: [], policy: '', entitlement: 0, accrualMethod: '', accrualAmount: 0, liabilityAmount: 0, notes: '' };

  function update(field: string, value: any) {
    onChange({ ...hp, [field]: value });
  }

  function addEmployee() {
    update('employees', [...(hp.employees || []), { name: '', entitlement: 0, taken: 0, remaining: 0, dailyRate: 0, accrual: 0, notes: '' }]);
  }

  function updateEmployee(idx: number, field: string, value: any) {
    const updated = [...(hp.employees || [])];
    updated[idx] = { ...updated[idx], [field]: value };
    // Auto-calc remaining and accrual
    if (['entitlement', 'taken'].includes(field)) {
      updated[idx].remaining = (updated[idx].entitlement || 0) - (updated[idx].taken || 0);
    }
    if (['remaining', 'dailyRate'].includes(field) || ['entitlement', 'taken'].includes(field)) {
      const remaining = (updated[idx].entitlement || 0) - (updated[idx].taken || 0);
      updated[idx].remaining = remaining;
      updated[idx].accrual = remaining * (updated[idx].dailyRate || 0);
    }
    onChange({ ...hp, employees: updated });
  }

  const totalAccrual = (hp.employees || []).reduce((s: number, e: any) => s + (e.accrual || 0), 0);

  return (
    <div className="space-y-4">
      {/* Policy & entitlement */}
      <div className="border rounded-lg p-3 space-y-2">
        <div className="text-[10px] font-bold text-slate-600 uppercase">Holiday Pay Policy</div>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <label className="text-[10px] text-slate-500 block mb-0.5">Holiday Policy</label>
            <select value={hp.policy || ''} onChange={e => update('policy', e.target.value)}
              className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-300">
              <option value="">Select...</option>
              <option value="statutory">Statutory (28 days inc. bank holidays)</option>
              <option value="enhanced">Enhanced (above statutory)</option>
              <option value="unlimited">Unlimited</option>
              <option value="accrual">Accrual basis</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 block mb-0.5">Standard Entitlement (days)</label>
            <input type="number" value={hp.entitlement || ''} onChange={e => update('entitlement', parseFloat(e.target.value) || 0)}
              className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-blue-300" />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 block mb-0.5">Accrual Method</label>
            <select value={hp.accrualMethod || ''} onChange={e => update('accrualMethod', e.target.value)}
              className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-300">
              <option value="">Select...</option>
              <option value="daily_rate">Daily rate x days remaining</option>
              <option value="proportion">Proportion of annual salary</option>
              <option value="actual">Actual cost basis</option>
            </select>
          </div>
        </div>
      </div>

      {/* Employee holiday schedule */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-bold text-slate-600 uppercase">Employee Holiday Schedule (Sample)</div>
          <button onClick={addEmployee} className="px-2 py-1 text-[9px] bg-blue-50 text-blue-600 rounded hover:bg-blue-100">+ Add Employee</button>
        </div>

        {(hp.employees || []).length > 0 && (
          <div className="border rounded overflow-auto">
            <table className="text-[9px] border-collapse w-full">
              <thead>
                <tr className="bg-slate-100 border-b">
                  <th className="px-1.5 py-1 text-left font-semibold text-slate-600">Name</th>
                  <th className="px-1.5 py-1 text-right font-semibold text-slate-600">Entitlement</th>
                  <th className="px-1.5 py-1 text-right font-semibold text-slate-600">Taken</th>
                  <th className="px-1.5 py-1 text-right font-semibold text-slate-600">Remaining</th>
                  <th className="px-1.5 py-1 text-right font-semibold text-slate-600">Daily Rate</th>
                  <th className="px-1.5 py-1 text-right font-semibold text-slate-600">Accrual</th>
                  <th className="px-1.5 py-1 text-left font-semibold text-slate-600">Notes</th>
                </tr>
              </thead>
              <tbody>
                {(hp.employees || []).map((emp: any, i: number) => (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="px-0.5 py-0"><input value={emp.name || ''} onChange={e => updateEmployee(i, 'name', e.target.value)} className="w-full px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none" /></td>
                    <td className="px-0.5 py-0"><input type="number" value={emp.entitlement ?? ''} onChange={e => updateEmployee(i, 'entitlement', parseFloat(e.target.value) || 0)} className="w-full text-right px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none font-mono" /></td>
                    <td className="px-0.5 py-0"><input type="number" value={emp.taken ?? ''} onChange={e => updateEmployee(i, 'taken', parseFloat(e.target.value) || 0)} className="w-full text-right px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none font-mono" /></td>
                    <td className="px-0.5 py-0"><span className="block text-right px-1 py-0.5 font-mono text-slate-600">{emp.remaining || 0}</span></td>
                    <td className="px-0.5 py-0"><input type="number" value={emp.dailyRate ?? ''} onChange={e => updateEmployee(i, 'dailyRate', parseFloat(e.target.value) || 0)} className="w-full text-right px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none font-mono" /></td>
                    <td className="px-0.5 py-0"><span className={`block text-right px-1 py-0.5 font-mono font-medium ${emp.accrual > 0 ? 'text-amber-600' : 'text-green-600'}`}>{fmt(emp.accrual || 0)}</span></td>
                    <td className="px-0.5 py-0"><input value={emp.notes || ''} onChange={e => updateEmployee(i, 'notes', e.target.value)} className="w-full px-1 py-0.5 text-[9px] border-0 bg-transparent focus:bg-blue-50 focus:outline-none" /></td>
                  </tr>
                ))}
                <tr className="bg-slate-100 font-bold">
                  <td colSpan={5} className="px-1.5 py-1 text-right text-slate-700">Total Holiday Pay Accrual:</td>
                  <td className="px-1.5 py-1 text-right font-mono text-amber-700">{fmt(totalAccrual)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Year-end liability comparison */}
      <div className="border rounded-lg p-3 space-y-2">
        <div className="text-[10px] font-bold text-slate-600 uppercase">Year-End Liability</div>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <label className="text-[10px] text-slate-500 block mb-0.5">Accrual per calculation</label>
            <div className="border border-slate-200 rounded px-2 py-1.5 text-xs font-mono bg-slate-50">{fmt(totalAccrual)}</div>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 block mb-0.5">Accrual per TB / management</label>
            <input type="number" value={hp.liabilityAmount ?? ''} onChange={e => update('liabilityAmount', parseFloat(e.target.value) || 0)}
              className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-blue-300" />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 block mb-0.5">Difference</label>
            <div className={`border rounded px-2 py-1.5 text-xs font-mono font-medium ${
              Math.abs(totalAccrual - (hp.liabilityAmount || 0)) > materiality.ct ? 'border-red-300 bg-red-50 text-red-700' : 'border-green-300 bg-green-50 text-green-700'
            }`}>
              {fmt(totalAccrual - (hp.liabilityAmount || 0))}
            </div>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="text-[10px] font-bold text-slate-600 uppercase block mb-1">Notes</label>
        <textarea value={hp.notes || ''} onChange={e => update('notes', e.target.value)}
          placeholder="Overall assessment of holiday pay calculation and accrual..."
          className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs min-h-[60px] focus:outline-none focus:border-blue-300" />
      </div>
    </div>
  );
}
