'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, Save, Loader2, GripVertical, ChevronUp, ChevronDown, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

const DEFAULT_TRIGGERS = [
  'On Start',
  'On Upload',
  'On Push to Portal',
  'On Verification',
  'On Portal Response',
  'On Section Sign Off',
];

export function ActionTriggersAdmin() {
  const [triggers, setTriggers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newTrigger, setNewTrigger] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/methodology-admin/templates?templateType=action_triggers&auditType=ALL');
        if (res.ok) {
          const data = await res.json();
          const items = data.template?.items || data.items;
          if (Array.isArray(items) && items.length > 0) {
            setTriggers(items);
          } else {
            setTriggers([...DEFAULT_TRIGGERS]);
          }
        } else {
          setTriggers([...DEFAULT_TRIGGERS]);
        }
      } catch {
        setTriggers([...DEFAULT_TRIGGERS]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function addTrigger() {
    const val = newTrigger.trim();
    if (!val || triggers.includes(val)) return;
    setTriggers([...triggers, val]);
    setNewTrigger('');
    setSaved(false);
  }

  function removeTrigger(index: number) {
    setTriggers(triggers.filter((_, i) => i !== index));
    setSaved(false);
  }

  function moveTrigger(index: number, dir: -1 | 1) {
    if (index + dir < 0 || index + dir >= triggers.length) return;
    const copy = [...triggers];
    [copy[index], copy[index + dir]] = [copy[index + dir], copy[index]];
    setTriggers(copy);
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await fetch('/api/methodology-admin/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateType: 'action_triggers', auditType: 'ALL', items: triggers }),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400 mr-2" />
        <span className="text-sm text-slate-500">Loading triggers...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500" />
            Action Triggers
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Define the global list of action triggers used across schedules, questionnaires, and workflows
          </p>
        </div>
        <Button onClick={handleSave} size="sm" disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
          {saved ? 'Saved' : 'Save'}
        </Button>
      </div>

      <div className="border rounded-lg divide-y max-w-lg">
        {triggers.map((trigger, i) => (
          <div key={`${trigger}-${i}`} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50">
            <GripVertical className="h-3.5 w-3.5 text-slate-300 flex-shrink-0" />
            <span className="flex-1 text-sm text-slate-800">{trigger}</span>
            <div className="flex items-center gap-0.5">
              <button onClick={() => moveTrigger(i, -1)} disabled={i === 0} className="p-0.5 hover:bg-slate-200 rounded disabled:opacity-30">
                <ChevronUp className="h-3 w-3 text-slate-500" />
              </button>
              <button onClick={() => moveTrigger(i, 1)} disabled={i === triggers.length - 1} className="p-0.5 hover:bg-slate-200 rounded disabled:opacity-30">
                <ChevronDown className="h-3 w-3 text-slate-500" />
              </button>
              <button onClick={() => removeTrigger(i)} className="p-0.5 hover:bg-red-100 rounded ml-1">
                <Trash2 className="h-3 w-3 text-red-400" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 max-w-lg">
        <input
          type="text"
          value={newTrigger}
          onChange={(e) => setNewTrigger(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTrigger()}
          placeholder="New trigger name..."
          className="flex-1 border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
        <Button onClick={addTrigger} size="sm" variant="outline" disabled={!newTrigger.trim()}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>
    </div>
  );
}
