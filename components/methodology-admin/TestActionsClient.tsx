'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Save, Loader2, GripVertical, ChevronUp, ChevronDown, Copy } from 'lucide-react';

interface TestAction {
  id: string;
  name: string;
  description: string;
  actionType: 'client' | 'ai' | 'human' | 'review';
  isReusable: boolean;
}

interface Props {
  initialActions: TestAction[];
}

const ACTION_TYPES = [
  { value: 'client', label: 'Client Action', color: 'bg-blue-100 text-blue-700' },
  { value: 'human', label: 'Human Action', color: 'bg-green-100 text-green-700' },
  { value: 'ai', label: 'AI Action', color: 'bg-purple-100 text-purple-700' },
  { value: 'review', label: 'Review/Conclude', color: 'bg-amber-100 text-amber-700' },
];

const PRESET_ACTIONS: Omit<TestAction, 'id'>[] = [
  { name: 'Request Data', description: 'Ask client for breakdown of data or supporting schedules', actionType: 'client', isReusable: true },
  { name: 'Select Sample', description: 'Select a representative sample from the population for testing', actionType: 'human', isReusable: true },
  { name: 'Request Evidence', description: 'Ask client for supporting evidence (contracts, invoices, etc.)', actionType: 'client', isReusable: true },
  { name: 'Inspect & Verify', description: 'Inspect documents and verify against the sample selection', actionType: 'human', isReusable: true },
  { name: 'AI Analysis', description: 'Use AI to analyse patterns, anomalies, or extract data', actionType: 'ai', isReusable: true },
  { name: 'Assess Error', description: 'Evaluate any errors or misstatements identified during testing', actionType: 'review', isReusable: true },
  { name: 'Conclude', description: 'Document the conclusion and whether the assertion is satisfied', actionType: 'review', isReusable: true },
  { name: 'Recalculate', description: 'Independently recalculate amounts to verify accuracy', actionType: 'human', isReusable: true },
  { name: 'Confirm Externally', description: 'Obtain independent confirmation from a third party', actionType: 'client', isReusable: true },
  { name: 'Analytical Review', description: 'Perform analytical procedures to identify unusual items', actionType: 'human', isReusable: true },
];

let counter = 0;
function uid() { return `ta_${Date.now()}_${++counter}`; }

export function TestActionsClient({ initialActions }: Props) {
  const [actions, setActions] = useState<TestAction[]>(
    initialActions.length > 0 ? initialActions : PRESET_ACTIONS.map(a => ({ ...a, id: uid() }))
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  function addAction() {
    setActions([...actions, { id: uid(), name: '', description: '', actionType: 'human', isReusable: true }]);
    setSaved(false);
  }

  function removeAction(id: string) {
    setActions(actions.filter(a => a.id !== id));
    setSaved(false);
  }

  function updateAction(id: string, field: keyof TestAction, value: any) {
    setActions(actions.map(a => a.id === id ? { ...a, [field]: value } : a));
    setSaved(false);
  }

  function moveAction(id: string, dir: -1 | 1) {
    const idx = actions.findIndex(a => a.id === id);
    if (idx < 0 || idx + dir < 0 || idx + dir >= actions.length) return;
    const copy = [...actions];
    [copy[idx], copy[idx + dir]] = [copy[idx + dir], copy[idx]];
    setActions(copy);
    setSaved(false);
  }

  function duplicateAction(id: string) {
    const source = actions.find(a => a.id === id);
    if (!source) return;
    const idx = actions.findIndex(a => a.id === id);
    const copy = { ...source, id: uid(), name: `${source.name} (Copy)` };
    const newActions = [...actions];
    newActions.splice(idx + 1, 0, copy);
    setActions(newActions);
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await fetch('/api/methodology-admin/risk-tables', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableType: 'test_actions', data: actions }),
      });
      setSaved(true);
    } finally { setSaving(false); }
  }

  function getColor(actionType: string) {
    return ACTION_TYPES.find(a => a.value === actionType)?.color || 'bg-slate-100 text-slate-600';
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Test Actions</h1>
          <p className="text-sm text-slate-500 mt-1">
            Define reusable test action steps. These can be assigned as steps within tests in the Test Bank.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={addAction} size="sm" variant="outline">
            <Plus className="h-4 w-4 mr-1" /> Add Action
          </Button>
          <Button onClick={handleSave} size="sm" disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            {saved ? 'Saved' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {actions.map((action, i) => (
          <div key={action.id} className={`border rounded-lg p-3 ${editingId === action.id ? 'border-blue-300 bg-blue-50/20' : 'border-slate-200'}`}>
            <div className="flex items-start gap-2">
              {/* Reorder */}
              <div className="flex flex-col gap-0.5 mt-1">
                <button onClick={() => moveAction(action.id, -1)} disabled={i === 0} className="p-0.5 hover:bg-slate-200 rounded disabled:opacity-20">
                  <ChevronUp className="h-3 w-3 text-slate-500" />
                </button>
                <GripVertical className="h-3 w-3 text-slate-300" />
                <button onClick={() => moveAction(action.id, 1)} disabled={i === actions.length - 1} className="p-0.5 hover:bg-slate-200 rounded disabled:opacity-20">
                  <ChevronDown className="h-3 w-3 text-slate-500" />
                </button>
              </div>

              {/* Order number */}
              <span className="text-xs font-bold text-slate-400 mt-1.5 w-5">{i + 1}.</span>

              {/* Content */}
              <div className="flex-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={action.name}
                    onChange={e => updateAction(action.id, 'name', e.target.value)}
                    onFocus={() => setEditingId(action.id)}
                    onBlur={() => setEditingId(null)}
                    placeholder="Action name (e.g. Select Sample)"
                    className="flex-1 text-sm font-medium border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <select
                    value={action.actionType}
                    onChange={e => updateAction(action.id, 'actionType', e.target.value)}
                    className={`text-xs border rounded px-2 py-1 font-medium ${getColor(action.actionType)}`}
                  >
                    {ACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <input
                  type="text"
                  value={action.description}
                  onChange={e => updateAction(action.id, 'description', e.target.value)}
                  placeholder="Description of what this action involves..."
                  className="w-full text-xs border rounded px-2 py-1 text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-0.5 mt-1">
                <button onClick={() => duplicateAction(action.id)} title="Duplicate" className="p-1 hover:bg-slate-100 rounded">
                  <Copy className="h-3 w-3 text-slate-400" />
                </button>
                <button onClick={() => removeAction(action.id)} title="Remove" className="p-1 hover:bg-red-50 rounded">
                  <Trash2 className="h-3 w-3 text-red-400" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {actions.length === 0 && (
        <div className="text-center py-12 border rounded-lg">
          <p className="text-sm text-slate-400">No test actions defined yet.</p>
          <button onClick={addAction} className="mt-2 text-xs text-blue-600 hover:text-blue-800">+ Add your first action</button>
        </div>
      )}
    </div>
  );
}
