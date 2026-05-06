'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Save, Loader2 } from 'lucide-react';
import type { ToolAvailability } from '@/types/methodology';
import { AUDIT_TOOLS, AUDIT_TOOLS_GROUP } from '@/lib/audit-tools';

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
  // Plan-Customiser Audit Tools — every tool the auditor sees in
  // the Plan Customiser dropdown is gated by its row here. Marking
  // a row Unavailable hides it from the dropdown for this firm
  // (use this for tools the firm hasn't purchased); Discretion
  // shows it but flags that RI approval is expected; Available
  // makes it freely deployable. Sourced from lib/audit-tools so
  // the admin grid + the modal share one definition.
  {
    tool: AUDIT_TOOLS_GROUP,
    methods: AUDIT_TOOLS.map(t => t.label),
  },
  // Calculators — firm-licensed working-paper calculators that
  // appear in the relevant FS Line workspaces. Same Unavailable /
  // Discretion / Available semantics as the Audit Tools group
  // above: Unavailable hides the calculator entirely (firm
  // hasn't purchased), Discretion gates it behind RI approval,
  // Available exposes it to every team member.
  {
    tool: 'Calculators',
    methods: [
      'VAT Reconciliation',
      'Loan Calculator',
      'Loan Costs Amortisation',
      'Tax Calculator',
      'Deferred Income',
    ],
  },
];

// Single audit-type bucket — the per-type tabs (SME / PIE /
// SME_CONTROLS / PIE_CONTROLS) were removed because the firm
// admin's purchasing decision applies across every engagement
// type. We persist as auditType='ALL' on the wire so the existing
// MethodologyToolSetting unique key (firmId, toolName, methodName,
// auditType) still works without a schema change. Old per-type
// rows from before this change remain in the database but are no
// longer read or written from this page.
const AUDIT_TYPE_KEY = 'ALL';
const AVAILABILITY_OPTIONS: { value: ToolAvailability; label: string }[] = [
  { value: 'unavailable', label: 'Unavailable' },
  { value: 'discretion', label: 'Discretion' },
  { value: 'available', label: 'Available' },
];

export function ToolsSettingsClient({ firmId, initialSettings }: Props) {
  const [settings, setSettings] = useState<Record<string, ToolAvailability>>(() => {
    const map: Record<string, ToolAvailability> = {};
    // On hydrate we accept whatever's in the DB, but the UI only
    // surfaces and writes the 'ALL' bucket from now on. If a firm
    // had legacy per-type rows, those stay untouched — but the
    // grid below shows the ALL row only, so the admin sees one
    // consistent state per (tool, method).
    for (const s of initialSettings) {
      map[`${s.toolName}|${s.methodName}|${s.auditType}`] = s.availability as ToolAvailability;
    }
    return map;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const getKey = (tool: string, method: string) =>
    `${tool}|${method}|${AUDIT_TYPE_KEY}`;

  const getValue = (tool: string, method: string): ToolAvailability =>
    settings[getKey(tool, method)] || 'available';

  const handleChange = (tool: string, method: string, value: ToolAvailability) => {
    setSettings((prev) => ({
      ...prev,
      [getKey(tool, method)]: value,
    }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Only push the rows we manage from this page (auditType=ALL).
      // Legacy per-type rows in the DB are intentionally not sent —
      // the PUT endpoint upserts on the (firm, tool, method, type)
      // unique key, so untouched rows stay where they are.
      const payload: Record<string, ToolAvailability> = {};
      for (const [k, v] of Object.entries(settings)) {
        if (k.endsWith(`|${AUDIT_TYPE_KEY}`)) payload[k] = v;
      }
      await fetch('/api/methodology-admin/tools', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmId, settings: payload }),
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
      {/* Save button + applies-to-all hint */}
      <div className="flex justify-between items-center">
        <p className="text-xs text-slate-500">
          Settings here apply to <span className="font-semibold">every audit type</span>. When a tool is marked Available, the firm has access to it on every engagement.
        </p>
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
