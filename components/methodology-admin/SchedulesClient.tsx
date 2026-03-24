'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Save, Loader2, Plus, X } from 'lucide-react';
import {
  DEFAULT_AGREED_DATES,
  DEFAULT_INFO_REQUEST_STANDARD,
  DEFAULT_INFO_REQUEST_PRELIMINARY,
  PERMANENT_FILE_SECTIONS,
} from '@/types/methodology';

interface Template {
  id: string;
  firmId: string;
  templateType: string;
  auditType: string;
  items: any;
}

interface Props {
  firmId: string;
  initialTemplates: Template[];
}

const TEMPLATE_TYPES = [
  { key: 'agreed_dates', label: 'Agreed Dates', defaults: DEFAULT_AGREED_DATES },
  { key: 'information_request_standard', label: 'Information Request (Standard)', defaults: DEFAULT_INFO_REQUEST_STANDARD },
  { key: 'information_request_preliminary', label: 'Information Request (Preliminary)', defaults: DEFAULT_INFO_REQUEST_PRELIMINARY },
  { key: 'permanent_file', label: 'Permanent File Sections', defaults: PERMANENT_FILE_SECTIONS.map((s) => s.label) },
];

const AUDIT_TYPES = ['ALL', 'SME', 'PIE', 'SME_CONTROLS', 'PIE_CONTROLS'];

export function SchedulesClient({ firmId, initialTemplates }: Props) {
  const [templates, setTemplates] = useState<Record<string, string[]>>(() => {
    const map: Record<string, string[]> = {};
    for (const t of initialTemplates) {
      map[`${t.templateType}|${t.auditType}`] = t.items as string[];
    }
    return map;
  });
  const [activeTemplateType, setActiveTemplateType] = useState(TEMPLATE_TYPES[0].key);
  const [activeAuditType, setActiveAuditType] = useState('ALL');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newItem, setNewItem] = useState('');

  const key = `${activeTemplateType}|${activeAuditType}`;
  const currentItems = templates[key] || TEMPLATE_TYPES.find((t) => t.key === activeTemplateType)?.defaults || [];

  const setItems = (items: string[]) => {
    setTemplates((prev) => ({ ...prev, [key]: items }));
    setSaved(false);
  };

  const handleAdd = () => {
    if (newItem.trim()) {
      setItems([...currentItems, newItem.trim()]);
      setNewItem('');
    }
  };

  const handleRemove = (index: number) => {
    setItems(currentItems.filter((_, i) => i !== index));
  };

  const handleReorder = (from: number, to: number) => {
    const items = [...currentItems];
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    setItems(items);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/methodology-admin/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateType: activeTemplateType,
          auditType: activeAuditType,
          items: currentItems,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // handle error
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Template Type Tabs */}
      <div className="flex flex-wrap gap-2 border-b pb-2">
        {TEMPLATE_TYPES.map((tt) => (
          <button
            key={tt.key}
            onClick={() => setActiveTemplateType(tt.key)}
            className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
              activeTemplateType === tt.key ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {tt.label}
          </button>
        ))}
      </div>

      {/* Audit Type Filter */}
      <div className="flex space-x-2">
        {AUDIT_TYPES.map((at) => (
          <button
            key={at}
            onClick={() => setActiveAuditType(at)}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
              activeAuditType === at ? 'bg-slate-700 text-white' : 'text-slate-600 bg-slate-100 hover:bg-slate-200'
            }`}
          >
            {at === 'ALL' ? 'All Types' : at.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Items List */}
      <div className="border rounded-lg">
        <div className="px-4 py-3 bg-slate-50 rounded-t-lg flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">
            {TEMPLATE_TYPES.find((t) => t.key === activeTemplateType)?.label} ({activeAuditType === 'ALL' ? 'All Types' : activeAuditType.replace('_', ' ')})
          </h3>
          <Button onClick={handleSave} disabled={saving} size="sm" className="bg-blue-600 hover:bg-blue-700">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            {saved ? 'Saved' : 'Save'}
          </Button>
        </div>
        <div className="p-4 space-y-2">
          {currentItems.map((item, i) => (
            <div key={i} className="flex items-center space-x-2 group">
              <span className="text-xs text-slate-400 w-6 text-right">{i + 1}.</span>
              <span className="flex-1 text-sm text-slate-700 bg-white border border-slate-200 rounded px-3 py-2">
                {typeof item === 'string' ? item : (item as any).label || JSON.stringify(item)}
              </span>
              <div className="opacity-0 group-hover:opacity-100 flex space-x-1 transition-opacity">
                {i > 0 && (
                  <button onClick={() => handleReorder(i, i - 1)} className="text-slate-400 hover:text-slate-600 text-xs px-1">
                    ↑
                  </button>
                )}
                {i < currentItems.length - 1 && (
                  <button onClick={() => handleReorder(i, i + 1)} className="text-slate-400 hover:text-slate-600 text-xs px-1">
                    ↓
                  </button>
                )}
                <button onClick={() => handleRemove(i)} className="text-red-400 hover:text-red-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}

          {/* Add new item */}
          <div className="flex items-center space-x-2 pt-2 border-t mt-3">
            <input
              type="text"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              placeholder="Add new item..."
              className="flex-1 border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <Button onClick={handleAdd} size="sm" variant="outline">
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
