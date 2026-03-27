'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Save, Loader2, ChevronDown, ChevronUp, Plus, X } from 'lucide-react';
import type {
  RiskLevel,
  Likelihood,
  Magnitude,
  ControlRiskLevel,
  InherentRiskTable,
  ControlRiskTable,
  AssertionsTable,
} from '@/types/methodology';

interface Props {
  firmId: string;
  initialInherentRisk: InherentRiskTable | null;
  initialControlRisk: ControlRiskTable | null;
  initialAssertions: AssertionsTable | null;
  initialConfidenceLevel: number;
  initialConfidenceTable: any;
  initialSpecialistRoles?: string[];
}

const LIKELIHOODS: Likelihood[] = ['Remote', 'Unlikely', 'Neutral', 'Likely', 'Very Likely'];
const MAGNITUDES: Magnitude[] = ['Remote', 'Low', 'Medium', 'High', 'Very High'];
const RISK_LEVELS: RiskLevel[] = ['Remote', 'Low', 'Medium', 'High', 'Very High'];
const CONTROL_RISK_LEVELS: ControlRiskLevel[] = ['Not Tested', 'Effective', 'Not Effective', 'Partially Effective'];

const RISK_COLORS: Record<string, string> = {
  'Remote': 'bg-white text-slate-700',
  'Low': 'bg-yellow-50 text-slate-700',
  'Medium': 'bg-yellow-100 text-slate-800',
  'High': 'bg-orange-200 text-slate-800',
  'Very High': 'bg-red-200 text-slate-900',
  'Very-High': 'bg-red-200 text-slate-900',
};

const ASSERTION_COLS = [
  { key: 'completeness', label: 'Completeness' },
  { key: 'occurrenceAccuracy', label: 'Occurrence & Accuracy' },
  { key: 'cutOff', label: 'Cut-off' },
  { key: 'classification', label: 'Classification' },
  { key: 'presentation', label: 'Presentation' },
  { key: 'existence', label: 'Existence' },
  { key: 'valuation', label: 'Valuation' },
  { key: 'rightsObligations', label: 'Rights & Obligations' },
  { key: 'nr', label: 'NR' },
];

// Default data matching the screenshots
function getDefaultInherentRisk(): InherentRiskTable {
  return {
    matrix: {
      'Remote': { 'Remote': 'Remote', 'Low': 'Remote', 'Medium': 'Low', 'High': 'Low', 'Very High': 'Low' },
      'Unlikely': { 'Remote': 'Remote', 'Low': 'Low', 'Medium': 'Low', 'High': 'Medium', 'Very High': 'High' },
      'Neutral': { 'Remote': 'Low', 'Low': 'Low', 'Medium': 'Medium', 'High': 'High', 'Very High': 'High' },
      'Likely': { 'Remote': 'Low', 'Low': 'Medium', 'Medium': 'High', 'High': 'High', 'Very High': 'Very High' },
      'Very Likely': { 'Remote': 'Low', 'Low': 'High', 'Medium': 'High', 'High': 'Very High', 'Very High': 'Very High' },
    },
  };
}

function getDefaultControlRisk(): ControlRiskTable {
  return {
    matrix: {
      'Remote': { 'Not Tested': 'Remote', 'Effective': 'Remote', 'Not Effective': 'Low', 'Partially Effective': 'Low' },
      'Low': { 'Not Tested': 'Low', 'Effective': 'Low', 'Not Effective': 'Low', 'Partially Effective': 'Medium' },
      'Medium': { 'Not Tested': 'Medium', 'Effective': 'Low', 'Not Effective': 'Medium', 'Partially Effective': 'High' },
      'High': { 'Not Tested': 'High', 'Effective': 'Medium', 'Not Effective': 'High', 'Partially Effective': 'High' },
      'Very High': { 'Not Tested': 'High', 'Effective': 'High', 'Not Effective': 'High', 'Partially Effective': 'Very High' },
    },
  };
}

function getDefaultAssertions(): AssertionsTable {
  return {
    rows: [
      { key: 'BS', label: 'BS', completeness: true, occurrenceAccuracy: false, cutOff: true, classification: true, presentation: true, existence: true, valuation: true, rightsObligations: true, nr: false },
      { key: 'PNL', label: 'PNL', completeness: true, occurrenceAccuracy: true, cutOff: true, classification: false, presentation: true, existence: false, valuation: false, rightsObligations: false, nr: false },
    ],
  };
}

export function FirmAssumptionsClient({
  firmId,
  initialInherentRisk,
  initialControlRisk,
  initialAssertions,
  initialConfidenceLevel,
  initialConfidenceTable,
  initialSpecialistRoles,
}: Props) {
  const [inherentRisk, setInherentRisk] = useState<InherentRiskTable>(() => {
    const t = initialInherentRisk;
    return (t && t.matrix && typeof t.matrix === 'object') ? t : getDefaultInherentRisk();
  });
  const [controlRisk, setControlRisk] = useState<ControlRiskTable>(() => {
    const t = initialControlRisk;
    return (t && t.matrix && typeof t.matrix === 'object') ? t : getDefaultControlRisk();
  });
  const [assertions, setAssertions] = useState<AssertionsTable>(() => {
    const t = initialAssertions;
    return (t && Array.isArray(t.rows)) ? t : getDefaultAssertions();
  });
  const [confidenceLevel, setConfidenceLevel] = useState(initialConfidenceLevel);
  const [specialistRoles, setSpecialistRoles] = useState<string[]>(
    Array.isArray(initialSpecialistRoles) ? initialSpecialistRoles : ['EQR', 'Valuations', 'Ethics', 'Technical']
  );
  const [newRole, setNewRole] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    inherent: true,
    control: true,
    assertions: true,
    confidence: true,
    specialist: true,
  });

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleInherentChange = useCallback((likelihood: Likelihood, magnitude: Magnitude, value: RiskLevel) => {
    setInherentRisk((prev) => ({
      matrix: {
        ...prev.matrix,
        [likelihood]: { ...prev.matrix[likelihood], [magnitude]: value },
      },
    }));
    setSaved(false);
  }, []);

  const handleControlChange = useCallback((inherent: RiskLevel, control: ControlRiskLevel, value: RiskLevel) => {
    setControlRisk((prev) => ({
      matrix: {
        ...prev.matrix,
        [inherent]: { ...prev.matrix[inherent], [control]: value },
      },
    }));
    setSaved(false);
  }, []);

  const handleAssertionToggle = useCallback((rowIndex: number, colKey: string) => {
    setAssertions((prev) => ({
      rows: prev.rows.map((row, i) =>
        i === rowIndex ? { ...row, [colKey]: !row[colKey as keyof typeof row] } : row
      ),
    }));
    setSaved(false);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all([
        fetch('/api/methodology-admin/risk-tables', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firmId,
            tables: {
              inherent: inherentRisk,
              control: controlRisk,
              assertions,
              specialistRoles: { roles: specialistRoles },
            },
          }),
        }),
        fetch('/api/methodology-admin/confidence', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ firmId, confidenceLevel }),
        }),
      ]);
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
      {/* Save button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save All'}
        </Button>
      </div>

      {/* Inherent Risk Table */}
      <div className="border rounded-lg">
        <button
          onClick={() => toggleSection('inherent')}
          className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 rounded-t-lg"
        >
          <h2 className="text-lg font-semibold text-slate-900">Methodology Inherent Risk Table</h2>
          {expandedSections.inherent ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </button>
        {expandedSections.inherent && (
          <div className="p-4 overflow-x-auto">
            <table className="border-collapse w-full">
              <thead>
                <tr>
                  <th className="border border-slate-300 p-2 bg-slate-100" rowSpan={2}></th>
                  <th className="border border-slate-300 p-2 bg-slate-100" rowSpan={2}></th>
                  <th className="border border-slate-300 p-2 bg-slate-100 text-center" colSpan={5}>Magnitude</th>
                </tr>
                <tr>
                  {MAGNITUDES.map((m) => (
                    <th key={m} className="border border-slate-300 p-2 bg-slate-100 text-sm font-medium text-center min-w-[100px]">{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LIKELIHOODS.map((l, li) => (
                  <tr key={l}>
                    {li === 0 && (
                      <td className="border border-slate-300 p-2 bg-slate-100 text-sm font-medium text-center" rowSpan={5} style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                        Likelihood
                      </td>
                    )}
                    <td className="border border-slate-300 p-2 bg-slate-100 text-sm font-medium">{l}</td>
                    {MAGNITUDES.map((m) => {
                      const val = inherentRisk.matrix[l]?.[m] || 'Low';
                      return (
                        <td key={m} className={`border border-slate-300 p-1 ${RISK_COLORS[val] || 'bg-yellow-50'}`}>
                          <select
                            value={val}
                            onChange={(e) => handleInherentChange(l, m, e.target.value as RiskLevel)}
                            className={`w-full text-sm border-0 bg-transparent focus:ring-1 focus:ring-blue-500 rounded p-1 cursor-pointer`}
                          >
                            {RISK_LEVELS.map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Control Risk Table */}
      <div className="border rounded-lg">
        <button
          onClick={() => toggleSection('control')}
          className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 rounded-t-lg"
        >
          <h2 className="text-lg font-semibold text-slate-900">Methodology Control Risk Table</h2>
          {expandedSections.control ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </button>
        {expandedSections.control && (
          <div className="p-4 overflow-x-auto">
            <table className="border-collapse w-full">
              <thead>
                <tr>
                  <th className="border border-slate-300 p-2 bg-slate-100" rowSpan={2}></th>
                  <th className="border border-slate-300 p-2 bg-slate-100" rowSpan={2}></th>
                  <th className="border border-slate-300 p-2 bg-slate-100 text-center" colSpan={4}>Control Risk</th>
                </tr>
                <tr>
                  {CONTROL_RISK_LEVELS.map((c) => (
                    <th key={c} className="border border-slate-300 p-2 bg-slate-100 text-sm font-medium text-center min-w-[110px]">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RISK_LEVELS.map((r, ri) => (
                  <tr key={r}>
                    {ri === 0 && (
                      <td className="border border-slate-300 p-2 bg-slate-100 text-sm font-medium text-center" rowSpan={5} style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                        Inherent Risk
                      </td>
                    )}
                    <td className="border border-slate-300 p-2 bg-slate-100 text-sm font-medium">{r}</td>
                    {CONTROL_RISK_LEVELS.map((c) => {
                      const val = controlRisk.matrix[r]?.[c] || 'Low';
                      return (
                        <td key={c} className={`border border-slate-300 p-1 ${RISK_COLORS[val] || 'bg-yellow-50'}`}>
                          <select
                            value={val}
                            onChange={(e) => handleControlChange(r, c, e.target.value as RiskLevel)}
                            className="w-full text-sm border-0 bg-transparent focus:ring-1 focus:ring-blue-500 rounded p-1 cursor-pointer"
                          >
                            {RISK_LEVELS.map((rl) => (
                              <option key={rl} value={rl}>{rl}</option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Assertions to FS Statements */}
      <div className="border rounded-lg">
        <button
          onClick={() => toggleSection('assertions')}
          className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 rounded-t-lg"
        >
          <h2 className="text-lg font-semibold text-slate-900">Assertions to FS Statements</h2>
          {expandedSections.assertions ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </button>
        {expandedSections.assertions && (
          <div className="p-4 overflow-x-auto">
            <table className="border-collapse w-full">
              <thead>
                <tr>
                  <th className="border border-slate-300 p-2 bg-blue-100 text-sm font-medium text-left min-w-[60px]"></th>
                  {ASSERTION_COLS.map((col) => (
                    <th key={col.key} className="border border-slate-300 p-2 bg-blue-100 text-sm font-medium text-center min-w-[90px]" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', height: '120px' }}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assertions.rows.map((row, ri) => (
                  <tr key={row.key}>
                    <td className="border border-slate-300 p-2 bg-slate-50 text-sm font-medium">{row.label}</td>
                    {ASSERTION_COLS.map((col) => {
                      const val = row[col.key as keyof typeof row] as boolean;
                      return (
                        <td
                          key={col.key}
                          className="border border-slate-300 p-2 text-center cursor-pointer hover:bg-blue-50"
                          onClick={() => handleAssertionToggle(ri, col.key)}
                        >
                          {val ? (
                            <span className="text-lg font-bold text-blue-600">X</span>
                          ) : (
                            <span className="text-slate-300">&mdash;</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Specialist Roles */}
      <div className="border rounded-lg">
        <button
          onClick={() => toggleSection('specialist')}
          className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 rounded-t-lg"
        >
          <h2 className="text-lg font-semibold text-slate-900">Specialist Roles</h2>
          {expandedSections.specialist ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </button>
        {expandedSections.specialist && (
          <div className="p-4">
            <p className="text-sm text-slate-500 mb-3">Define specialist role types. These appear as columns in User Settings.</p>
            <div className="space-y-2 mb-3">
              {specialistRoles.map((role, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-teal-500 flex-shrink-0" />
                  <span className="text-sm text-slate-700 flex-1">{role}</span>
                  <button
                    onClick={() => { setSpecialistRoles(prev => prev.filter((_, i) => i !== idx)); setSaved(false); }}
                    className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {specialistRoles.length === 0 && (
                <p className="text-sm text-slate-400 italic">No specialist roles defined.</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newRole}
                onChange={e => setNewRole(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newRole.trim()) {
                    setSpecialistRoles(prev => [...prev, newRole.trim()]);
                    setNewRole('');
                    setSaved(false);
                  }
                }}
                placeholder="Add role (e.g. Tax Specialist)"
                className="flex-1 max-w-xs px-3 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <button
                onClick={() => {
                  if (newRole.trim()) {
                    setSpecialistRoles(prev => [...prev, newRole.trim()]);
                    setNewRole('');
                    setSaved(false);
                  }
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-teal-600 text-white rounded hover:bg-teal-700"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Confidence Level */}
      <div className="border rounded-lg">
        <button
          onClick={() => toggleSection('confidence')}
          className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 rounded-t-lg"
        >
          <h2 className="text-lg font-semibold text-slate-900">Confidence Level</h2>
          {expandedSections.confidence ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </button>
        {expandedSections.confidence && (
          <div className="p-4">
            <div className="flex items-center space-x-4">
              <label className="text-sm font-medium text-slate-700">Confidence Level (%)</label>
              <input
                type="number"
                min={50}
                max={100}
                step={1}
                value={confidenceLevel}
                onChange={(e) => { setConfidenceLevel(Number(e.target.value)); setSaved(false); }}
                className="w-24 border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
