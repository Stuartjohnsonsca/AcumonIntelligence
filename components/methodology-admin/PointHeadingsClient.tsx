'use client';

import { useState } from 'react';
import { Plus, X, Save, Loader2, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  managementHeadings: string[];
  representationHeadings: string[];
  managementTemplateId: string | null;
  representationTemplateId: string | null;
}

export function PointHeadingsClient({ managementHeadings: initMgt, representationHeadings: initRep, managementTemplateId, representationTemplateId }: Props) {
  const [mgtHeadings, setMgtHeadings] = useState(initMgt);
  const [repHeadings, setRepHeadings] = useState(initRep);
  const [mgtNew, setMgtNew] = useState('');
  const [repNew, setRepNew] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      // Save management headings
      if (managementTemplateId) {
        await fetch('/api/methodology-admin/templates', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: managementTemplateId, items: mgtHeadings }),
        });
      } else {
        await fetch('/api/methodology-admin/templates', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateType: 'management_headings', auditType: 'ALL', items: mgtHeadings }),
        });
      }
      // Save representation headings
      if (representationTemplateId) {
        await fetch('/api/methodology-admin/templates', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: representationTemplateId, items: repHeadings }),
        });
      } else {
        await fetch('/api/methodology-admin/templates', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateType: 'representation_headings', auditType: 'ALL', items: repHeadings }),
        });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  }

  function renderHeadingList(headings: string[], setHeadings: (h: string[]) => void, newValue: string, setNewValue: (v: string) => void) {
    return (
      <div className="space-y-1">
        {headings.map((h, i) => (
          <div key={`h-${i}`} className="flex items-center gap-2 group">
            <GripVertical className="h-3 w-3 text-slate-300 flex-shrink-0" />
            <input value={h} onChange={e => { const next = [...headings]; next[i] = e.target.value; setHeadings(next); }}
              className="flex-1 border border-slate-200 rounded px-2 py-1.5 text-sm focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none" />
            <button onClick={() => setHeadings(headings.filter((_, j) => j !== i))}
              className="p-1 text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2 mt-2">
          <input value={newValue} onChange={e => setNewValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newValue.trim()) {
                setHeadings([...headings, newValue.trim()]);
                setNewValue('');
              }
            }}
            placeholder="Add heading..."
            className="flex-1 border border-dashed border-slate-300 rounded px-2 py-1.5 text-sm" />
          <Button onClick={() => { if (newValue.trim()) { setHeadings([...headings, newValue.trim()]); setNewValue(''); } }}
            size="sm" variant="outline" disabled={!newValue.trim()}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-8">
        {/* Management Letter Headings */}
        <div className="border rounded-lg p-4">
          <h3 className="text-sm font-semibold text-orange-700 mb-1">Management Letter Headings</h3>
          <p className="text-xs text-slate-500 mb-3">Categories for management letter points. Users can also add custom headings per engagement.</p>
          {renderHeadingList(mgtHeadings, setMgtHeadings, mgtNew, setMgtNew)}
        </div>

        {/* Representation Letter Headings */}
        <div className="border rounded-lg p-4">
          <h3 className="text-sm font-semibold text-purple-700 mb-1">Representation Letter Headings</h3>
          <p className="text-xs text-slate-500 mb-3">Categories for representation letter points. Users can also add custom headings per engagement.</p>
          {renderHeadingList(repHeadings, setRepHeadings, repNew, setRepNew)}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
          Save Headings
        </Button>
        {saved && <span className="text-sm text-green-600 font-medium">Saved successfully</span>}
      </div>
    </div>
  );
}
