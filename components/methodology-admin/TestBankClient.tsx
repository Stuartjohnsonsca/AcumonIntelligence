'use client';

import React, { useState, useRef, lazy, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, X, Loader2, Save, Download, Upload, Pencil, Trash2, GitBranch, Settings2 } from 'lucide-react';
const TestFlowEditor = lazy(() => import('./TestFlowEditor').then(m => ({ default: m.TestFlowEditor })));
import { ExecutionDefEditor } from './ExecutionDefEditor';
import { ASSERTION_TYPES } from '@/types/methodology';

interface TestType {
  id: string;
  name: string;
  code: string;
  actionType: string;
  codeSection?: string | null;
  executionDef?: any | null;
}

interface MethodologyTestItem {
  id: string;
  firmId: string;
  name: string;
  description: string | null;
  testTypeCode: string;
  assertions: string[] | null;
  framework: string;
  significantRisk: boolean;
  flow: any | null;
  sortOrder: number;
  isActive: boolean;
}

interface TestActionItem {
  id: string;
  name: string;
  description: string;
  actionType: 'client' | 'ai' | 'human' | 'review';
  isReusable: boolean;
}

interface Props {
  firmId: string;
  initialTestTypes: TestType[];
  initialTests: MethodologyTestItem[];
  initialFrameworkOptions?: string[];
  initialTestActions?: TestActionItem[];
  canEditFlow?: boolean;
}

const DEFAULT_FRAMEWORKS = ['IFRS', 'FRS102'];

type TopTab = 'test-allocations' | 'test-bank' | 'test-actions' | 'grid-view';

export function TestBankClient({ firmId, initialTestTypes, initialTests, initialFrameworkOptions, initialTestActions, canEditFlow }: Props) {
  const frameworkOptions = initialFrameworkOptions && initialFrameworkOptions.length > 0 ? initialFrameworkOptions : DEFAULT_FRAMEWORKS;
  const [topTab, setTopTab] = useState<TopTab>('test-allocations');
  const [testTypes, setTestTypes] = useState(initialTestTypes);
  const [tests, setTests] = useState(initialTests);
  const [saving, setSaving] = useState(false);

  // Test Bank tab state
  const [editingTest, setEditingTest] = useState<MethodologyTestItem | null>(null);
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testForm, setTestForm] = useState({ name: '', description: '', testTypeCode: '', assertions: [] as string[], framework: '', significantRisk: false });
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Flow editor state
  const [flowEditorOpen, setFlowEditorOpen] = useState(false);
  const [flowTestId, setFlowTestId] = useState<string | null>(null);
  const testActionsLib = initialTestActions || [];

  // Test Types state
  const [newTestTypeName, setNewTestTypeName] = useState('');
  const [newActionType, setNewActionType] = useState('human_action');
  const [newCodeSection, setNewCodeSection] = useState('');
  const [editingTestType, setEditingTestType] = useState<string | null>(null);
  const [editTestTypeName, setEditTestTypeName] = useState('');
  const [editActionType, setEditActionType] = useState('human_action');
  const [editCodeSection, setEditCodeSection] = useState('');
  const [expandedActionId, setExpandedActionId] = useState<string | null>(null);
  const [savingExecDef, setSavingExecDef] = useState(false);

  // ── Test Bank CRUD ──
  function openNewTestModal() {
    setEditingTest(null);
    setTestForm({ name: '', description: '', testTypeCode: '', assertions: [], framework: '', significantRisk: false });
    setTestModalOpen(true);
  }

  function openEditTestModal(test: MethodologyTestItem) {
    setEditingTest(test);
    setTestForm({
      name: test.name,
      description: test.description || '',
      testTypeCode: test.testTypeCode,
      assertions: (test.assertions as string[]) || [],
      framework: test.framework === 'ALL' ? '' : test.framework,
      significantRisk: test.significantRisk,
    });
    setTestModalOpen(true);
  }

  async function handleSaveTest() {
    setSaving(true);
    try {
      if (editingTest) {
        const res = await fetch('/api/methodology-admin/tests', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingTest.id,
            name: testForm.name.trim(),
            description: testForm.description.trim() || null,
            testTypeCode: testForm.testTypeCode,
            assertions: testForm.assertions,
            framework: testForm.framework || 'ALL',
            significantRisk: testForm.significantRisk,
          }),
        });
        if (res.ok) {
          const { test } = await res.json();
          setTests(prev => prev.map(t => t.id === test.id ? test : t));
        }
      } else {
        const res = await fetch('/api/methodology-admin/tests', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: testForm.name.trim(),
            description: testForm.description.trim() || null,
            testTypeCode: testForm.testTypeCode,
            assertions: testForm.assertions,
            framework: testForm.framework || 'ALL',
            significantRisk: testForm.significantRisk,
          }),
        });
        if (res.ok) {
          const { test } = await res.json();
          setTests(prev => [...prev, test]);
        }
      }
    } finally { setSaving(false); setTestModalOpen(false); }
  }

  async function handleDeleteTest(id: string) {
    if (!confirm('Delete this test?')) return;
    const res = await fetch('/api/methodology-admin/tests', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      setTests(prev => prev.filter(t => t.id !== id));
    }
  }

  async function handleSaveFlow(testId: string, flow: any) {
    const res = await fetch('/api/methodology-admin/tests', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: testId, flow }),
    });
    if (res.ok) {
      const { test } = await res.json();
      setTests(prev => prev.map(t => t.id === test.id ? test : t));
    }
    setFlowEditorOpen(false);
  }

  function downloadTestBank() {
    const rows = tests.map(t => {
      const tt = testTypes.find(ty => ty.code === t.testTypeCode);
      return {
        'Name': t.name,
        'Description': t.description || '',
        'Action Type': tt?.name || t.testTypeCode,
        'Assertions': ((t.assertions as string[]) || []).join('; '),
        'Framework': t.framework || 'All',
        'Significant Risk': t.significantRisk ? 'Yes' : 'No',
        'Has Flow': t.flow?.nodes?.length > 0 ? 'Yes' : 'No',
      };
    });
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]).join(',');
    const csv = [headers, ...rows.map(r => Object.values(r).map(v => `"${String(v || '')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'test_bank.csv'; a.click(); URL.revokeObjectURL(url);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/methodology-admin/test-bank/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'validation') {
          const errorList = data.errors.join('\n');
          const more = data.hasMore ? `\n...and ${data.count - 20} more errors` : '';
          setUploadResult(`Upload rejected \u2014 ${data.count} validation error${data.count > 1 ? 's' : ''}.\n\n${errorList}${more}`);
        } else { setUploadResult(`Upload failed: ${data.error}`); }
      } else {
        const testsRes = await fetch('/api/methodology-admin/tests');
        if (testsRes.ok) {
          const testsData = await testsRes.json();
          setTests(testsData.tests || []);
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

  // ── Test Type CRUD ──
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
      body: JSON.stringify({ id: editingTestType, name: editTestTypeName.trim(), actionType: editActionType, codeSection: editCodeSection.trim() || null }),
    });
    if (res.ok) {
      const { testType } = await res.json();
      setTestTypes(prev => prev.map(t => t.id === testType.id ? testType : t));
      setEditingTestType(null);
    }
  }

  async function saveExecutionDef(id: string, executionDef: any) {
    setSavingExecDef(true);
    try {
      const res = await fetch('/api/methodology-admin/test-types', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, executionDef }),
      });
      if (res.ok) {
        const { testType } = await res.json();
        setTestTypes(prev => prev.map(t => t.id === testType.id ? testType : t));
      }
    } finally { setSavingExecDef(false); }
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
        <button onClick={() => setTopTab('test-allocations')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${topTab === 'test-allocations' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
          Test Allocations
        </button>
        <button onClick={() => setTopTab('test-bank')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${topTab === 'test-bank' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
          Test Bank
        </button>
        <button onClick={() => setTopTab('test-actions')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${topTab === 'test-actions' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
          Test Actions
        </button>
        <button onClick={() => setTopTab('grid-view')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${topTab === 'grid-view' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
          Grid View
        </button>
      </div>

      {/* ─── TEST ALLOCATIONS TAB ─── */}
      {topTab === 'test-allocations' && (
        <div className="border rounded-lg p-8 text-center">
          <h3 className="text-sm font-semibold text-slate-800 mb-2">Test Allocations</h3>
          <p className="text-xs text-slate-500">Assign tests from the Test Bank to FS lines and industries. Coming soon.</p>
        </div>
      )}

      {/* ─── TEST BANK TAB ─── */}
      {topTab === 'test-bank' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Test Bank ({tests.length} tests)</h3>
              <p className="text-xs text-slate-500">All audit tests. Add, edit, or delete tests. Upload/download as CSV.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={openNewTestModal} size="sm" variant="outline"><Plus className="h-3.5 w-3.5 mr-1" /> Add Test</Button>
              <Button onClick={downloadTestBank} size="sm" variant="outline"><Download className="h-3.5 w-3.5 mr-1" /> Download CSV</Button>
              <Button onClick={() => fileInputRef.current?.click()} size="sm" variant="outline" disabled={uploading}><Upload className="h-3.5 w-3.5 mr-1" /> Upload</Button>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} className="hidden" />
            </div>
          </div>

          {uploadResult && (
            <div className={`text-sm px-4 py-2 rounded-lg whitespace-pre-wrap ${uploadResult.includes('failed') || uploadResult.includes('rejected') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
              {uploadResult}
            </div>
          )}

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100 border-b">
                  <th className="text-left px-3 py-2 text-slate-600 font-semibold">Test Name</th>
                  <th className="text-left px-3 py-2 text-slate-600 font-semibold w-28">Action Type</th>
                  <th className="text-left px-3 py-2 text-slate-600 font-semibold w-32">Assertions</th>
                  <th className="text-left px-3 py-2 text-slate-600 font-semibold w-20">Framework</th>
                  <th className="text-center px-3 py-2 text-slate-600 font-semibold w-12">Flow</th>
                  <th className="text-center px-3 py-2 text-slate-600 font-semibold w-10">Sig.</th>
                  <th className="w-20 px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {tests.map((test, i) => {
                  const tt = testTypes.find(t => t.code === test.testTypeCode);
                  const hasFlow = !!test.flow?.nodes?.length;
                  return (
                    <tr key={test.id} className={`border-b border-slate-50 hover:bg-slate-50/50 group ${i % 2 ? 'bg-slate-50/20' : ''}`}>
                      <td className="px-3 py-2">
                        <div className="text-slate-700 text-xs font-medium">{test.name}</div>
                        {test.description && <div className="text-slate-400 text-[10px] mt-0.5 line-clamp-1">{test.description}</div>}
                      </td>
                      <td className="px-3 py-2">
                        {tt && (
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                            tt.actionType === 'client_action' ? 'bg-amber-100 text-amber-700' :
                            tt.actionType === 'ai_action' ? 'bg-purple-100 text-purple-700' :
                            'bg-blue-100 text-blue-700'
                          }`}>{tt.name}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {((test.assertions as string[]) || []).map((a, ai) => (
                          <span key={ai} className="text-[10px] px-1 py-0.5 bg-purple-100 text-purple-700 rounded mr-0.5">{a.length > 12 ? a.split(' ').map(w => w[0]).join('') : a}</span>
                        ))}
                      </td>
                      <td className="px-3 py-2 text-[10px] text-slate-500">{test.framework || 'All'}</td>
                      <td className="px-3 py-2 text-center">
                        <button onClick={() => { setFlowTestId(test.id); setFlowEditorOpen(true); }}
                          className={`p-0.5 rounded hover:bg-blue-50 ${hasFlow ? 'text-green-600' : 'text-slate-300'}`}
                          title={hasFlow ? 'Edit flow' : 'Add flow'}>
                          <GitBranch className="h-3.5 w-3.5" />
                        </button>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {test.significantRisk && <span className="inline-block w-3 h-3 rounded-full bg-red-500" title="Significant risk" />}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center gap-0.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openEditTestModal(test)} className="p-1 hover:bg-slate-200 rounded" title="Edit"><Pencil className="h-3 w-3 text-slate-500" /></button>
                          <button onClick={() => handleDeleteTest(test.id)} className="p-1 hover:bg-red-100 rounded" title="Delete"><Trash2 className="h-3 w-3 text-red-500" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {tests.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-8 text-slate-400 text-sm">No tests yet. Add tests or upload a CSV.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-slate-500">{tests.length} tests</div>
        </div>
      )}

      {/* ─── TEST ACTIONS TAB ─── */}
      {topTab === 'test-actions' && (
        <div className="border rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Test Actions ({testTypes.length})</h3>
          <p className="text-xs text-slate-500 mb-4">Define reusable audit actions with execution definitions. Each action specifies what the system should do when triggered in a test flow.</p>

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100 border-b">
                  <th className="text-left px-3 py-2 text-slate-600 font-semibold">Action</th>
                  <th className="text-left px-3 py-2 text-slate-600 font-semibold w-44">Type</th>
                  <th className="text-left px-3 py-2 text-slate-600 font-semibold w-48">Code Section</th>
                  <th className="text-center px-3 py-2 text-slate-600 font-semibold w-24">Execution</th>
                  <th className="w-20 px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {testTypes.map(tt => (
                  <React.Fragment key={tt.id}>
                    <tr className="border-b border-slate-50 hover:bg-slate-50/50 group">
                      {editingTestType === tt.id ? (
                        <>
                          <td className="px-2 py-1.5">
                            <input value={editTestTypeName} onChange={e => setEditTestTypeName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveEditTestType(); if (e.key === 'Escape') setEditingTestType(null); }}
                              className="w-full border border-slate-300 rounded px-2 py-1 text-sm" autoFocus />
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
                          <td></td>
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
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                              tt.actionType === 'client_action' ? 'bg-amber-100 text-amber-700' :
                              tt.actionType === 'ai_action' ? 'bg-purple-100 text-purple-700' :
                              'bg-blue-100 text-blue-700'
                            }`}>
                              {tt.actionType === 'client_action' ? 'Client Action' :
                               tt.actionType === 'ai_action' ? 'AI Action' : 'Human Action'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-500 text-xs font-mono">{tt.codeSection || '\u2014'}</td>
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => setExpandedActionId(expandedActionId === tt.id ? null : tt.id)}
                              className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md border transition-colors ${
                                expandedActionId === tt.id
                                  ? 'bg-blue-100 border-blue-300 text-blue-700'
                                  : tt.executionDef
                                  ? 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100'
                                  : 'bg-orange-50 border-orange-300 text-orange-700 hover:bg-orange-100'
                              }`}
                            >
                              <Settings2 className="h-3 w-3" />
                              {expandedActionId === tt.id ? 'Close' : tt.executionDef ? 'Edit' : 'Configure'}
                            </button>
                          </td>
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
                    {expandedActionId === tt.id && (
                      <tr>
                        <td colSpan={5} className="px-3 pb-3 bg-slate-50/50">
                          <ExecutionDefEditor
                            actionType={tt.actionType}
                            executionDef={tt.executionDef || null}
                            onChange={(def) => saveExecutionDef(tt.id, def)}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

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

      {/* ─── FLOW EDITOR ─── */}
      {flowEditorOpen && flowTestId && (() => {
        const flowTest = tests.find(t => t.id === flowTestId);
        if (!flowTest) return null;
        return (
          <Suspense fallback={<div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-white" /></div>}>
            <TestFlowEditor
              testDescription={flowTest.name}
              initialFlow={flowTest.flow || null}
              testActions={testActionsLib}
              onSave={async (flow) => handleSaveFlow(flowTest.id, flow)}
              onClose={() => setFlowEditorOpen(false)}
            />
          </Suspense>
        );
      })()}

      {/* ─── GRID VIEW TAB ─── */}
      {topTab === 'grid-view' && (
        <div className="border rounded-lg p-8 text-center">
          <h3 className="text-sm font-semibold text-slate-800 mb-2">Grid View</h3>
          <p className="text-xs text-slate-500">Visual grid of tests across FS lines and industries. Coming soon.</p>
        </div>
      )}

      {/* ─── TEST MODAL (Add/Edit) ─── */}
      {testModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-lg shadow-xl w-[700px] max-h-[80vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">
                {editingTest ? 'Edit Test' : 'Add New Test'}
              </h3>
              <button onClick={() => setTestModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Test Name *</label>
                <input value={testForm.name} onChange={e => setTestForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm" placeholder="e.g. Revenue Completeness Test" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Description</label>
                <textarea value={testForm.description} onChange={e => setTestForm(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm min-h-[60px]" rows={2}
                  placeholder="Detailed description of what the test does..." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Action Type</label>
                  <select value={testForm.testTypeCode} onChange={e => setTestForm(prev => ({ ...prev, testTypeCode: e.target.value }))}
                    className="w-full border border-slate-300 rounded-md px-2 py-2 text-sm bg-white">
                    <option value="">Select...</option>
                    {testTypes.map(tt => <option key={tt.code} value={tt.code}>{tt.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Framework</label>
                  <select value={testForm.framework} onChange={e => setTestForm(prev => ({ ...prev, framework: e.target.value }))}
                    className="w-full border border-slate-300 rounded-md px-2 py-2 text-sm bg-white">
                    <option value="">All Frameworks</option>
                    {frameworkOptions.map(fw => <option key={fw} value={fw}>{fw}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Assertions</label>
                <div className="flex flex-wrap gap-1">
                  {ASSERTION_TYPES.map(a => {
                    const isChecked = testForm.assertions.includes(a);
                    return (
                      <label key={a} className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border cursor-pointer transition-colors ${
                        isChecked ? 'bg-purple-100 border-purple-300 text-purple-700' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                      }`}>
                        <input type="checkbox" checked={isChecked} className="hidden"
                          onChange={e => {
                            setTestForm(prev => ({
                              ...prev,
                              assertions: e.target.checked ? [...prev.assertions, a] : prev.assertions.filter(x => x !== a),
                            }));
                          }}
                        />
                        {a.length > 15 ? a.split(' ').map(w => w[0]).join('') : a}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={testForm.significantRisk}
                    onChange={e => setTestForm(prev => ({ ...prev, significantRisk: e.target.checked }))}
                    className="w-4 h-4 rounded border-slate-300 text-red-500" />
                  <span className="text-sm text-slate-700">Significant Risk</span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-6">
              <Button onClick={() => setTestModalOpen(false)} size="sm" variant="outline">Cancel</Button>
              <Button onClick={handleSaveTest} size="sm" disabled={saving || !testForm.name.trim()} className="bg-blue-600 hover:bg-blue-700">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                {editingTest ? 'Update' : 'Create'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
