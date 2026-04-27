'use client';

/**
 * PlanCustomiserModal — per-engagement customisation of the auto-generated
 * audit plan. Opened from two entry points:
 *   (a) AuditPlanPanel's FS Note tab row (Edit Audit Plan button)
 *   (b) TestExecutionPanel header (Plan Customiser button)
 *
 * Both call the same modal with a pre-selected FS Line context. The modal:
 *   - Lists every test allocated to the scoped FS Line (firm-wide allocation)
 *     alongside any engagement-specific custom tests that were previously
 *     added for this FS Line.
 *   - Each allocated test can be toggled between active and "N/A". When N/A
 *     is chosen, the user must pick a reason category and optionally provide
 *     free-text detail.
 *   - Custom tests can be created (engagement-only) with name, description,
 *     test type, assertions, and framework.
 *   - Custom tests can be edited or removed.
 *   - N/A tests are shown greyed-out in this modal (so the auditor can see
 *     what's been excluded and undo if needed) but HIDDEN from the main
 *     audit plan view.
 *
 * Persistence is via POST /api/engagements/{id}/plan-customiser with one of
 * the action shapes: set_na, clear_na, add_custom, remove_custom, update_custom.
 */

import { useState, useEffect, useMemo } from 'react';
import { X, Loader2, Plus, Check, Ban, Trash2, Save, Edit2, Table } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface FsLineOption {
  id: string;
  name: string;
}

interface AllocatedTest {
  id: string;
  name: string;
  description: string | null;
  testTypeCode: string;
  assertions: string[] | null;
  framework: string;
  category?: string;
}

interface CustomTest {
  id: string;
  name: string;
  description: string;
  fsLineId: string;
  fsLineName?: string;
  fsNote?: string;
  testTypeCode: string;
  assertions: string[];
  framework: string;
  // Display Results — controls how this test's results are rendered
  // when the auditor opens it from the Audit Plan. Mirrors the
  // outputFormat field on firm-wide tests (methodology_test).
  outputFormat?: string;
  createdBy: { id: string; name: string };
  createdAt: string;
}

// Display Results options shown in the dropdown. Codes match the
// outputFormat field on the methodology_test model so a custom test
// renders identically to a firm-wide test of the same shape.
const OUTPUT_FORMAT_OPTIONS: { value: string; label: string; description: string }[] = [
  { value: 'three_section_no_sampling', label: 'Three-section (no sampling)', description: 'Standard test workspace: population, work performed, conclusion' },
  { value: 'three_section_sampling',     label: 'Three-section (with sampling)', description: 'Standard workspace + sampling section for selecting items' },
  { value: 'document_summary',           label: 'Document summary', description: 'Single-document review with AI-extracted summary' },
  { value: 'spreadsheet',                label: 'Spreadsheet', description: 'Free-form spreadsheet workspace with formula support' },
];

interface Override {
  status: 'na';
  reasonCategory: string;
  reason: string;
  setBy: { id: string; name: string };
  setAt: string;
}

interface PlanCustomiserData {
  overrides: Record<string, Override>;
  customTests: CustomTest[];
}

interface Props {
  engagementId: string;
  fsLineId: string;
  fsLineName: string;
  /** Firm-wide allocations for this fsLineId, loaded by the caller. */
  allocatedTests: AllocatedTest[];
  /** Called on close. */
  onClose: () => void;
  /** Called after any mutation with the fresh data so the parent can refresh. */
  onChange?: (data: PlanCustomiserData) => void;
}

const NA_REASON_CATEGORIES = [
  'Not applicable to this period',
  'Covered by another test',
  'Immaterial balance',
  'Area not audited (low risk)',
  'Alternative evidence obtained',
  'Client-specific exclusion',
  'Other',
];

export function PlanCustomiserModal({
  engagementId,
  fsLineId,
  fsLineName,
  allocatedTests,
  onClose,
  onChange,
}: Props) {
  const [data, setData] = useState<PlanCustomiserData>({ overrides: {}, customTests: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // N/A reason dialog state
  const [naDialogFor, setNaDialogFor] = useState<AllocatedTest | null>(null);
  const [naCategory, setNaCategory] = useState(NA_REASON_CATEGORIES[0]);
  const [naReason, setNaReason] = useState('');

  // Add/edit form state. editingId !== null means we're editing an
  // existing custom test rather than creating a new one — same form
  // either way, just a different submit handler.
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newAssertions, setNewAssertions] = useState<string[]>([]);
  const [newFramework, setNewFramework] = useState('IFRS');
  const [newTestTypeCode, setNewTestTypeCode] = useState('team_action');
  const [newOutputFormat, setNewOutputFormat] = useState<string>('three_section_no_sampling');

  function resetForm() {
    setShowAddForm(false);
    setEditingId(null);
    setNewName('');
    setNewDesc('');
    setNewAssertions([]);
    setNewFramework('IFRS');
    setNewTestTypeCode('team_action');
    setNewOutputFormat('three_section_no_sampling');
  }

  function startEdit(t: CustomTest) {
    setEditingId(t.id);
    setNewName(t.name);
    setNewDesc(t.description || '');
    setNewAssertions(Array.isArray(t.assertions) ? t.assertions : []);
    setNewFramework(t.framework || 'IFRS');
    setNewTestTypeCode(t.testTypeCode || 'team_action');
    setNewOutputFormat(t.outputFormat || 'three_section_no_sampling');
    setShowAddForm(true);
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/engagements/${engagementId}/plan-customiser`);
        if (res.ok) {
          const json = await res.json();
          setData(json.data || { overrides: {}, customTests: [] });
        } else {
          setError('Failed to load Plan Customiser data');
        }
      } catch (err: any) {
        setError(err?.message || 'Failed to load Plan Customiser data');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [engagementId]);

  async function post(body: Record<string, any>): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/plan-customiser`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || `Save failed (${res.status})`);
        return false;
      }
      const json = await res.json();
      setData(json.data);
      onChange?.(json.data);
      return true;
    } catch (err: any) {
      setError(err?.message || 'Save failed');
      return false;
    } finally {
      setSaving(false);
    }
  }

  function overrideKey(testId: string): string {
    return `${testId}__${fsLineId}`;
  }

  function isNa(testId: string): Override | null {
    return data.overrides[overrideKey(testId)] || null;
  }

  async function markNa() {
    if (!naDialogFor) return;
    const reason = naReason.trim() || naCategory;
    const ok = await post({
      action: 'set_na',
      testId: naDialogFor.id,
      fsLineId,
      reasonCategory: naCategory,
      reason,
    });
    if (ok) {
      setNaDialogFor(null);
      setNaReason('');
      setNaCategory(NA_REASON_CATEGORIES[0]);
    }
  }

  async function clearNa(testId: string) {
    await post({ action: 'clear_na', testId, fsLineId });
  }

  async function saveCustom() {
    if (!newName.trim()) {
      setError('Test name is required');
      return;
    }
    const payload = {
      name: newName.trim(),
      description: newDesc.trim(),
      fsLineId,
      fsLineName,
      testTypeCode: newTestTypeCode,
      assertions: newAssertions,
      framework: newFramework,
      outputFormat: newOutputFormat,
    };
    const ok = editingId
      ? await post({ action: 'update_custom', id: editingId, patch: payload })
      : await post({ action: 'add_custom', customTest: payload });
    if (ok) resetForm();
  }

  // Quick-add: drop a fresh spreadsheet test in with sensible defaults.
  // The user spec called out a "simple option" for adding a blank
  // spreadsheet — they can edit name/description/etc. via the per-row
  // Edit button afterwards, but the Add Blank Spreadsheet button is
  // a single click for the common case.
  async function addBlankSpreadsheet() {
    const ok = await post({
      action: 'add_custom',
      customTest: {
        name: 'Blank Spreadsheet',
        description: 'Bespoke working paper — free-form spreadsheet',
        fsLineId,
        fsLineName,
        testTypeCode: 'team_action',
        assertions: [],
        framework: 'ALL',
        outputFormat: 'spreadsheet',
      },
    });
    if (ok) resetForm();
  }

  async function removeCustom(id: string) {
    if (!confirm('Remove this custom test? This cannot be undone.')) return;
    await post({ action: 'remove_custom', id });
  }

  const customTestsForLine = useMemo(
    () => data.customTests.filter(t => t.fsLineId === fsLineId),
    [data.customTests, fsLineId],
  );

  const assertionOptions = ['E', 'C', 'A', 'V', 'R&O', 'P&D', 'CO'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Plan Customiser</h2>
            <p className="text-xs text-slate-500">{fsLineName} — remove tests that aren't relevant or add engagement-specific custom tests</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="px-4 py-2 bg-red-50 text-red-700 text-xs border-b border-red-200">{error}</div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : (
            <>
              {/* Firm-wide allocated tests */}
              <div>
                <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">Allocated Tests ({allocatedTests.length})</h3>
                {allocatedTests.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No tests are allocated to this FS Line at firm level.</p>
                ) : (
                  <div className="border border-slate-200 rounded overflow-hidden">
                    <div className="grid grid-cols-[1fr_80px_90px] gap-x-2 px-3 py-1.5 text-[10px] font-semibold text-slate-600 uppercase bg-slate-50 border-b border-slate-200">
                      <div>Test</div>
                      <div>Type</div>
                      <div className="text-right">Status</div>
                    </div>
                    {allocatedTests.map(t => {
                      const na = isNa(t.id);
                      return (
                        <div
                          key={t.id}
                          className={`grid grid-cols-[1fr_80px_90px] gap-x-2 px-3 py-2 border-b border-slate-100 last:border-b-0 ${na ? 'bg-slate-50 opacity-60' : 'bg-white'}`}
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-slate-800 truncate" title={t.name}>
                              {t.name}
                            </div>
                            {t.description && (
                              <div className="text-[10px] text-slate-500 truncate" title={t.description}>
                                {t.description}
                              </div>
                            )}
                            {na && (
                              <div className="text-[10px] text-amber-700 mt-0.5">
                                <Ban className="inline h-2.5 w-2.5 mr-0.5" />
                                <span className="font-semibold">{na.reasonCategory}</span>
                                {na.reason && na.reason !== na.reasonCategory ? ` — ${na.reason}` : ''}
                                <span className="text-slate-400 ml-1">({na.setBy.name})</span>
                              </div>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 self-center truncate">{t.testTypeCode}</div>
                          <div className="self-center text-right">
                            {na ? (
                              <Button size="sm" variant="outline" disabled={saving} onClick={() => clearNa(t.id)} className="text-[10px] h-6">
                                Restore
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={saving}
                                onClick={() => {
                                  setNaDialogFor(t);
                                  setNaCategory(NA_REASON_CATEGORIES[0]);
                                  setNaReason('');
                                }}
                                className="text-[10px] h-6 text-amber-700 border-amber-300 hover:bg-amber-50"
                              >
                                Mark N/A
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Custom tests for this engagement */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                    Engagement-Specific Custom Tests ({customTestsForLine.length})
                  </h3>
                  <div className="flex items-center gap-1.5">
                    {/* Add Blank Spreadsheet — single-click quick-add for
                        the common "I just want a working paper" case.
                        Skips the form entirely. */}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void addBlankSpreadsheet()}
                      disabled={saving}
                      title="Create a blank spreadsheet workspace for this FS Line"
                    >
                      <Table className="h-3 w-3 mr-1" /> Add Blank Spreadsheet
                    </Button>
                    <Button size="sm" onClick={() => { resetForm(); setShowAddForm(true); }} disabled={saving}>
                      <Plus className="h-3 w-3 mr-1" /> Add Custom Test
                    </Button>
                  </div>
                </div>
                {showAddForm && (
                  <div className="border border-blue-200 bg-blue-50/40 rounded p-3 mb-2 space-y-2">
                    <div className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">
                      {editingId ? 'Edit custom test' : 'New custom test'}
                    </div>
                    <input
                      type="text"
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      placeholder="Test name"
                      className="w-full text-xs px-2 py-1 border border-slate-300 rounded"
                    />
                    <textarea
                      value={newDesc}
                      onChange={e => setNewDesc(e.target.value)}
                      placeholder="Description / instructions"
                      className="w-full text-xs px-2 py-1 border border-slate-300 rounded resize-y min-h-[48px]"
                    />
                    <div className="flex flex-wrap items-center gap-2 text-[10px]">
                      <label className="text-slate-600">Type:</label>
                      <select
                        value={newTestTypeCode}
                        onChange={e => setNewTestTypeCode(e.target.value)}
                        className="text-xs border border-slate-300 rounded px-1.5 py-0.5"
                      >
                        <option value="team_action">Team</option>
                        <option value="ai_action">AI</option>
                        <option value="client_action">Client</option>
                      </select>
                      <label className="text-slate-600 ml-2">Framework:</label>
                      <select
                        value={newFramework}
                        onChange={e => setNewFramework(e.target.value)}
                        className="text-xs border border-slate-300 rounded px-1.5 py-0.5"
                      >
                        <option value="IFRS">IFRS</option>
                        <option value="FRS102">FRS 102</option>
                        <option value="FRS101">FRS 101</option>
                        <option value="ALL">All</option>
                      </select>
                    </div>
                    {/* Display Results dropdown — picks the test's
                        outputFormat, which controls how the workspace
                        renders when the auditor opens the test. */}
                    <div className="flex flex-col gap-1 text-[10px]">
                      <label className="text-slate-600 font-medium">Display Results</label>
                      <select
                        value={newOutputFormat}
                        onChange={e => setNewOutputFormat(e.target.value)}
                        className="text-xs border border-slate-300 rounded px-2 py-1"
                      >
                        {OUTPUT_FORMAT_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <span className="text-[9px] text-slate-400 italic">
                        {OUTPUT_FORMAT_OPTIONS.find(o => o.value === newOutputFormat)?.description}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1 text-[10px]">
                      <span className="text-slate-600 mr-1">Assertions:</span>
                      {assertionOptions.map(a => {
                        const selected = newAssertions.includes(a);
                        return (
                          <button
                            key={a}
                            type="button"
                            onClick={() => setNewAssertions(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a])}
                            className={`px-1.5 py-0.5 rounded border text-[10px] ${selected ? 'bg-blue-100 border-blue-400 text-blue-700' : 'bg-white border-slate-300 text-slate-500'}`}
                          >
                            {a}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={resetForm} disabled={saving}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={() => void saveCustom()} disabled={saving || !newName.trim()}>
                        {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
                        {editingId ? 'Save changes' : 'Save'}
                      </Button>
                    </div>
                  </div>
                )}
                {customTestsForLine.length === 0 && !showAddForm ? (
                  <p className="text-xs text-slate-400 italic">No custom tests yet.</p>
                ) : customTestsForLine.length > 0 ? (
                  <div className="border border-slate-200 rounded overflow-hidden">
                    {customTestsForLine.map(t => {
                      const fmtLabel = OUTPUT_FORMAT_OPTIONS.find(o => o.value === t.outputFormat)?.label || 'Three-section';
                      const isEditing = editingId === t.id;
                      return (
                      <div
                        key={t.id}
                        className={`grid grid-cols-[1fr_120px_80px_80px] gap-x-2 px-3 py-2 border-b border-slate-100 last:border-b-0 ${isEditing ? 'bg-blue-50/60' : 'bg-white'}`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-slate-800 truncate">{t.name}</div>
                          {t.description && (
                            <div className="text-[10px] text-slate-500 truncate">{t.description}</div>
                          )}
                          <div className="text-[9px] text-slate-400 mt-0.5">
                            Created by {t.createdBy.name} · {new Date(t.createdAt).toLocaleDateString('en-GB')}
                          </div>
                        </div>
                        <div className="text-[10px] text-slate-500 self-center truncate" title={fmtLabel}>{fmtLabel}</div>
                        <div className="text-[10px] text-slate-500 self-center truncate">{t.testTypeCode}</div>
                        <div className="self-center text-right flex items-center gap-1 justify-end">
                          <button
                            onClick={() => startEdit(t)}
                            disabled={saving}
                            className="text-blue-500 hover:text-blue-700 disabled:opacity-50 p-1"
                            title="Edit"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => void removeCustom(t.id)}
                            disabled={saving}
                            className="text-red-500 hover:text-red-700 disabled:opacity-50 p-1"
                            title="Remove"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <span className="text-[10px] text-slate-400">
            Changes save automatically. N/A tests are hidden from the main audit plan but remain visible here.
          </span>
          <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
        </div>

        {/* N/A reason dialog */}
        {naDialogFor && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center p-4" onClick={() => setNaDialogFor(null)}>
            <div
              className="bg-white rounded-lg shadow-xl max-w-md w-full p-4 space-y-3"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-sm font-semibold text-slate-800">Mark as N/A</h3>
              <p className="text-xs text-slate-500">"{naDialogFor.name}"</p>
              <label className="block text-xs">
                <span className="text-slate-600 font-medium">Reason category</span>
                <select
                  value={naCategory}
                  onChange={e => setNaCategory(e.target.value)}
                  className="w-full mt-1 text-xs border border-slate-300 rounded px-2 py-1"
                >
                  {NA_REASON_CATEGORIES.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs">
                <span className="text-slate-600 font-medium">Detail (optional)</span>
                <textarea
                  value={naReason}
                  onChange={e => setNaReason(e.target.value)}
                  placeholder="Optional free-text reason for audit trail"
                  className="w-full mt-1 text-xs border border-slate-300 rounded px-2 py-1 resize-y min-h-[60px]"
                />
              </label>
              <div className="flex items-center justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setNaDialogFor(null)} disabled={saving}>
                  Cancel
                </Button>
                <Button size="sm" onClick={markNa} disabled={saving}>
                  {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
                  Mark N/A
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
