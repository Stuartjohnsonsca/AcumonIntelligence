'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Save, Loader2 } from 'lucide-react';
import type { ToolAvailability } from '@/types/methodology';

interface ToolSetting {
  id: string;
  firmId: string;
  toolName: string;
  methodName: string;
  availability: string;
  auditType: string;
}

interface Props {
  firmId: string;
  initialSettings: ToolSetting[];
}

// Tools and their configurable methods discovered from the codebase
const TOOL_METHODS = [
  {
    tool: 'Sampling Calculator',
    methods: [
      'Random Sampling',
      'Systematic Sampling',
      'Monetary Unit Sampling (MUS)',
      'Judgemental Sampling',
      'Composite Sampling',
      'Stratified Sampling',
    ],
  },
  {
    tool: 'Bank Audit',
    methods: [
      'Cut-off Testing',
      'Completeness Testing',
      'Bank Reconciliation',
      'Foreign Currency Testing',
      'Interest Recalculation',
    ],
  },
  {
    tool: 'Data Extraction',
    methods: [
      'AI Extraction',
      'Manual Entry',
      'Xero Import',
    ],
  },
  {
    tool: 'FS Assertions',
    methods: [
      'Auto-mapping',
      'Manual Mapping',
    ],
  },
  {
    tool: 'Document Summary',
    methods: [
      'AI Analysis',
      'Manual Review',
    ],
  },
];

const AUDIT_TYPES = ['ALL', 'SME', 'PIE', 'SME_CONTROLS', 'PIE_CONTROLS'];
const AVAILABILITY_OPTIONS: { value: ToolAvailability; label: string }[] = [
  { value: 'unavailable', label: 'Unavailable' },
  { value: 'discretion', label: 'Discretion' },
  { value: 'available', label: 'Available' },
];

export function ToolsSettingsClient({ firmId, initialSettings }: Props) {
  const [settings, setSettings] = useState<Record<string, ToolAvailability>>(() => {
    const map: Record<string, ToolAvailability> = {};
    for (const s of initialSettings) {
      map[`${s.toolName}|${s.methodName}|${s.auditType}`] = s.availability as ToolAvailability;
    }
    return map;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeAuditType, setActiveAuditType] = useState('ALL');

  const getKey = (tool: string, method: string, auditType: string) =>
    `${tool}|${method}|${auditType}`;

  const getValue = (tool: string, method: string): ToolAvailability =>
    settings[getKey(tool, method, activeAuditType)] || 'available';

  const handleChange = (tool: string, method: string, value: ToolAvailability) => {
    setSettings((prev) => ({
      ...prev,
      [getKey(tool, method, activeAuditType)]: value,
    }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/methodology-admin/tools', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmId, settings }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Audit Type Tabs */}
      <div className="flex space-x-2 border-b pb-2">
        {AUDIT_TYPES.map((at) => (
          <button
            key={at}
            onClick={() => setActiveAuditType(at)}
            className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
              activeAuditType === at
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {at === 'ALL' ? 'All Types' : at.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save'}
        </Button>
      </div>

      {/* Tool method grids */}
      {TOOL_METHODS.map(({ tool, methods }) => (
        <div key={tool} className="border rounded-lg">
          <div className="px-4 py-3 bg-slate-50 rounded-t-lg">
            <h3 className="text-md font-semibold text-slate-900">{tool}</h3>
          </div>
          <div className="p-4">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-left text-sm font-medium text-slate-600 p-2 border-b">Method</th>
                  {AVAILABILITY_OPTIONS.map((opt) => (
                    <th key={opt.value} className="text-center text-sm font-medium text-slate-600 p-2 border-b w-32">
                      {opt.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {methods.map((method) => {
                  const current = getValue(tool, method);
                  return (
                    <tr key={method} className="hover:bg-slate-50">
                      <td className="p-2 text-sm text-slate-700 border-b">{method}</td>
                      {AVAILABILITY_OPTIONS.map((opt) => (
                        <td key={opt.value} className="p-2 text-center border-b">
                          <button
                            onClick={() => handleChange(tool, method, opt.value)}
                            className={`h-5 w-5 rounded-full border-2 inline-block transition-colors ${
                              current === opt.value
                                ? opt.value === 'unavailable'
                                  ? 'bg-red-500 border-red-500'
                                  : opt.value === 'discretion'
                                  ? 'bg-amber-500 border-amber-500'
                                  : 'bg-emerald-500 border-emerald-500'
                                : 'bg-white border-slate-300 hover:border-slate-400'
                            }`}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
