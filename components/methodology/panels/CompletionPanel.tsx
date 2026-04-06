'use client';

import { useState } from 'react';
import { FileText, CheckSquare, ClipboardList, BarChart3, Eye, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { AuditTestSummaryPanel } from './AuditTestSummaryPanel';
import { ErrorSchedulePanel } from './ErrorSchedulePanel';

/**
 * CompletionPanel — Appears when user clicks "Completion" button.
 * Contains sub-tabs for the completion phase of the audit:
 * - Audit Summary Memo (Template Schedule)
 * - Update Procedures (Template Schedule)
 * - Audit Completion Checklist (Template Schedule)
 * - Audit Test Summary Results (code component — rollup view)
 * - Overall Review of FS (Template Schedule)
 * - Financial Statement Review
 * - Error Schedule
 */

interface Props {
  engagementId: string;
  clientId: string;
  userRole?: string;
  userId?: string;
  onClose?: () => void;
}

const COMPLETION_TABS = [
  { key: 'summary-memo', label: 'Audit Summary Memo', icon: FileText, templateType: 'audit_summary_memo' },
  { key: 'update-procedures', label: 'Update Procedures', icon: ClipboardList, templateType: 'update_procedures' },
  { key: 'completion-checklist', label: 'Completion Checklist', icon: CheckSquare, templateType: 'completion_checklist' },
  { key: 'test-summary', label: 'Test Summary Results', icon: BarChart3, templateType: null },
  { key: 'overall-review', label: 'Overall Review of FS', icon: Eye, templateType: 'overall_review_fs' },
  { key: 'fs-review', label: 'FS Review', icon: FileText, templateType: null },
  { key: 'error-schedule', label: 'Error Schedule', icon: AlertTriangle, templateType: null },
] as const;

type CompletionTabKey = typeof COMPLETION_TABS[number]['key'];

export function CompletionPanel({ engagementId, clientId, userRole, userId, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<CompletionTabKey>('test-summary');

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-200 bg-slate-50/50 overflow-x-auto">
        {COMPLETION_TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium rounded-md whitespace-nowrap transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Icon className="h-3 w-3" />
              {tab.label}
            </button>
          );
        })}
        {onClose && (
          <button onClick={onClose} className="ml-auto text-xs text-slate-400 hover:text-slate-600 px-2">Close Completion</button>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'test-summary' && (
          <AuditTestSummaryPanel engagementId={engagementId} userRole={userRole} userId={userId} />
        )}

        {activeTab === 'error-schedule' && (
          <ErrorSchedulePanel engagementId={engagementId} />
        )}

        {activeTab === 'fs-review' && (
          <FinancialStatementReviewPlaceholder engagementId={engagementId} />
        )}

        {/* Template Schedule tabs — render schedule form */}
        {['summary-memo', 'update-procedures', 'completion-checklist', 'overall-review'].includes(activeTab) && (
          <TemplateScheduleTab
            engagementId={engagementId}
            templateType={COMPLETION_TABS.find(t => t.key === activeTab)?.templateType || ''}
            title={COMPLETION_TABS.find(t => t.key === activeTab)?.label || ''}
          />
        )}
      </div>
    </div>
  );
}

// ─── Template Schedule Sub-component ───

function TemplateScheduleTab({ engagementId, templateType, title }: { engagementId: string; templateType: string; title: string }) {
  const [items, setItems] = useState<{ id: string; question: string; answer: string; notes: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // Load template and data
  useState(() => {
    (async () => {
      try {
        // Try to load existing data
        const dataRes = await fetch(`/api/engagements/${engagementId}/completion?templateType=${templateType}`);
        if (dataRes.ok) {
          const data = await dataRes.json();
          if (data.items?.length > 0) {
            setItems(data.items);
            setLoading(false);
            return;
          }
        }
        // Load template questions
        const tplRes = await fetch(`/api/methodology-admin/templates?templateType=${templateType}&auditType=ALL`);
        if (tplRes.ok) {
          const tplData = await tplRes.json();
          const questions = tplData.questions || tplData.items || [];
          setItems(questions.map((q: any, i: number) => ({
            id: q.id || `q-${i}`,
            question: q.questionText || q.question || q.text || `Item ${i + 1}`,
            answer: '',
            notes: '',
          })));
        }
      } catch {} finally { setLoading(false); }
    })();
  });

  async function saveItem(index: number, field: 'answer' | 'notes', value: string) {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
    // Auto-save
    try {
      await fetch(`/api/engagements/${engagementId}/completion`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateType, items: items.map((item, i) => i === index ? { ...item, [field]: value } : item) }),
      });
    } catch {}
  }

  if (loading) return <div className="p-6 text-center text-xs text-slate-400 animate-pulse">Loading {title}...</div>;

  if (items.length === 0) {
    return (
      <div className="p-6 text-center text-slate-400 space-y-2">
        <FileText className="h-8 w-8 mx-auto text-slate-300" />
        <p className="text-sm">No template configured for "{title}"</p>
        <p className="text-xs">Add a template in Methodology Admin → Template Documents with type "{templateType}"</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-slate-700">{title}</h3>
      <div className="border rounded-lg divide-y divide-slate-100">
        {items.map((item, i) => (
          <div key={item.id} className="p-3 space-y-2">
            <div className="text-xs font-medium text-slate-700">{i + 1}. {item.question}</div>
            <textarea
              value={item.answer}
              onChange={e => saveItem(i, 'answer', e.target.value)}
              placeholder="Enter response..."
              className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs min-h-[40px] focus:outline-none focus:border-blue-300"
            />
            <textarea
              value={item.notes}
              onChange={e => saveItem(i, 'notes', e.target.value)}
              placeholder="Notes / working paper reference..."
              className="w-full border border-slate-200 rounded px-2 py-1 text-[10px] min-h-[28px] text-slate-500 focus:outline-none focus:border-blue-300"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Financial Statement Review Placeholder ───

function FinancialStatementReviewPlaceholder({ engagementId }: { engagementId: string }) {
  const [tbSummary, setTbSummary] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useState(() => {
    (async () => {
      try {
        const res = await fetch(`/api/engagements/${engagementId}/trial-balance`);
        if (res.ok) {
          const data = await res.json();
          setTbSummary(data.rows || []);
        }
      } catch {} finally { setLoading(false); }
    })();
  });

  if (loading) return <div className="p-6 text-center text-xs text-slate-400 animate-pulse">Loading financial statements...</div>;

  // Group by FS Statement
  const byStatement = new Map<string, any[]>();
  for (const row of tbSummary) {
    const stmt = row.fsStatement || 'Unclassified';
    if (!byStatement.has(stmt)) byStatement.set(stmt, []);
    byStatement.get(stmt)!.push(row);
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-slate-700">Financial Statement Review</h3>
      <p className="text-xs text-slate-400">Review the trial balance amounts against the financial statements. Flag any items requiring adjustment.</p>

      {Array.from(byStatement.entries()).map(([stmt, rows]) => {
        const totalCY = rows.reduce((s: number, r: any) => s + (Number(r.currentYear) || 0), 0);
        const totalPY = rows.reduce((s: number, r: any) => s + (Number(r.priorYear) || 0), 0);
        return (
          <div key={stmt} className="border rounded-lg overflow-hidden">
            <div className="bg-slate-100 px-3 py-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">{stmt}</span>
              <div className="text-[10px] text-slate-500">
                CY: {totalCY.toLocaleString('en-GB', { minimumFractionDigits: 2 })} | PY: {totalPY.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
              </div>
            </div>
            <table className="w-full text-[10px]">
              <thead>
                <tr className="bg-slate-50 border-b">
                  <th className="text-left px-2 py-1 text-slate-600">Account</th>
                  <th className="text-left px-2 py-1 text-slate-600">Description</th>
                  <th className="text-left px-2 py-1 text-slate-600">FS Level</th>
                  <th className="text-right px-2 py-1 text-slate-600">Current Year</th>
                  <th className="text-right px-2 py-1 text-slate-600">Prior Year</th>
                  <th className="text-right px-2 py-1 text-slate-600">Variance</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map((row: any) => {
                  const cy = Number(row.currentYear) || 0;
                  const py = Number(row.priorYear) || 0;
                  const variance = cy - py;
                  const pctChange = py !== 0 ? ((variance / Math.abs(py)) * 100).toFixed(1) : '—';
                  return (
                    <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="px-2 py-1 font-mono text-slate-500">{row.accountCode}</td>
                      <td className="px-2 py-1 text-slate-700">{row.description}</td>
                      <td className="px-2 py-1 text-slate-400">{row.fsLevel || '—'}</td>
                      <td className="px-2 py-1 text-right font-mono">{cy.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-500">{py.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
                      <td className={`px-2 py-1 text-right font-mono ${variance > 0 ? 'text-green-600' : variance < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                        {variance.toLocaleString('en-GB', { minimumFractionDigits: 2 })} ({pctChange}%)
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
