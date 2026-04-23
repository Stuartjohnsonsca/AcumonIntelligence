'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Save, Loader2, ChevronDown, ChevronUp, Plus, X, ShieldCheck } from 'lucide-react';
import { IndependenceQuestionsClient } from '@/components/methodology-admin/IndependenceQuestionsClient';
import { IndependenceRefreshDaysClient } from '@/components/methodology-admin/IndependenceRefreshDaysClient';
import type { IndependenceQuestion, IndependenceRefreshDaysRule } from '@/lib/independence';
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
  initialMaterialityRange?: { benchmark: string; low: number; high: number }[];
  initialMaterialityRounding?: number;
  initialTechnicalTeam?: { email: string; members: { name: string; email: string; role: string }[] };
  initialRiskClassification?: Record<string, RiskClassification> | null;
  initialFxProvider?: string | null;
  initialTestCategories?: string[];
  initialArConfidenceFactor?: number;
  initialLargeUnusualScoring?: any;
  /** Legacy back-compat: seeded into firmVariables as a firm_fees row on first load */
  initialFirmFees?: number;
  /** Firm-wide hard-coded numeric variables referenced from schedule formulas */
  initialFirmVariables?: Array<{ name: string; label: string; value: number }>;
  /** Firm-wide Independence Questions — every team member must answer these
   *  before they can view or interact with an engagement. */
  initialIndependenceQuestions?: IndependenceQuestion[];
  /** Re-confirmation cadence — number of days per audit type before we
   *  prompt the team member to re-confirm their independence. */
  initialIndependenceRefreshRules?: IndependenceRefreshDaysRule[];
}

const LIKELIHOODS: Likelihood[] = ['Remote', 'Unlikely', 'Neutral', 'Likely', 'Very Likely'];
const MAGNITUDES: Magnitude[] = ['Remote', 'Low', 'Medium', 'High', 'Very High'];
const RISK_LEVELS: RiskLevel[] = ['Remote', 'Low', 'Medium', 'High', 'Very High'];
const CONTROL_RISK_LEVELS: ControlRiskLevel[] = ['Not Tested', 'Effective', 'Not Effective', 'Partially Effective'];

const CLASSIFICATION_OPTIONS = ['Significant Risk', 'Area of Focus', 'AR'] as const;
type RiskClassification = typeof CLASSIFICATION_OPTIONS[number];

const CLASSIFICATION_COLORS: Record<string, string> = {
  'Significant Risk': 'bg-red-200 text-red-900',
  'Area of Focus': 'bg-orange-100 text-orange-800',
  'AR': 'bg-green-50 text-green-700',
};

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
  initialRiskClassification,
  initialFxProvider,
  initialTestCategories,
  initialArConfidenceFactor,
  initialLargeUnusualScoring,
  initialFirmFees,
  initialFirmVariables,
  initialIndependenceQuestions,
  initialIndependenceRefreshRules,
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
  const [testCategories, setTestCategories] = useState<string[]>(
    Array.isArray(initialTestCategories) ? initialTestCategories : ['Significant Risk', 'Area of Focus', 'Normal', 'Analytical Review', 'Mandatory']
  );
  const [newCategory, setNewCategory] = useState('');
  const [arConfidenceFactor, setArConfidenceFactor] = useState<number>(
    initialArConfidenceFactor ?? 1.0
  );

  // Firm variables — hard-coded numeric values referenced from schedule formulas.
  // Seeded from the new initialFirmVariables prop. If the legacy firm_fees row
  // exists and no firm_variables row yet, synthesise a firm_fees entry so the
  // existing Ethics schedule formulas keep working.
  const [firmVariables, setFirmVariables] = useState<Array<{ name: string; label: string; value: number }>>(() => {
    if (Array.isArray(initialFirmVariables) && initialFirmVariables.length > 0) {
      return initialFirmVariables;
    }
    if (typeof initialFirmFees === 'number' && initialFirmFees > 0) {
      return [{ name: 'firm_fees', label: 'Firm Annual Fee Income', value: initialFirmFees }];
    }
    return [];
  });
  const [luPatterns, setLuPatterns] = useState<{ pattern: string; category: string; weight: number }[]>(
    initialLargeUnusualScoring?.descriptionPatterns || []
  );
  const [luThresholds, setLuThresholds] = useState<{ highRisk: number; mediumRisk: number; financialPctPM: number }>(
    { ...{ highRisk: 40, mediumRisk: 15, financialPctPM: 5 }, ...(initialLargeUnusualScoring?.thresholds || {}) }
  );
  const [newLuPattern, setNewLuPattern] = useState('');
  const [newLuCategory, setNewLuCategory] = useState('');
  const [newLuWeight, setNewLuWeight] = useState(15);
  const [riskClassification, setRiskClassification] = useState<Record<string, RiskClassification>>(() => {
    const init = initialRiskClassification;
    return (init && typeof init === 'object') ? init : {
      'Remote': 'AR', 'Low': 'AR', 'Medium': 'Area of Focus', 'High': 'Significant Risk', 'Very High': 'Significant Risk',
    };
  });
  const [fxProvider, setFxProvider] = useState<string>(initialFxProvider || 'frankfurter');
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

  const [saveError, setSaveError] = useState<string | null>(null);
  const [firmVariablesSaving, setFirmVariablesSaving] = useState(false);

  // Persist the firm_variables table immediately (used by Add / Delete so rows
  // survive a page refresh without forcing the admin to hit "Save All").
  const persistFirmVariables = useCallback(async (
    variables: Array<{ name: string; label: string; value: number }>
  ) => {
    setFirmVariablesSaving(true);
    try {
      const { invalidateFirmVariables } = await import('@/hooks/useFirmVariables');
      invalidateFirmVariables();
      await fetch('/api/methodology-admin/risk-tables', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmId, tableType: 'firm_variables', data: { variables } }),
      });
    } catch (err) {
      console.error('Auto-save firm_variables failed:', err);
    } finally {
      setFirmVariablesSaving(false);
    }
  }, [firmId]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // Invalidate the firm-variables memo cache so schedule formulas reflect
      // any new / changed variables on the next DynamicAppendixForm render.
      const { invalidateFirmVariables } = await import('@/hooks/useFirmVariables');
      invalidateFirmVariables();

      // Dedup firm variables by name — keeps the LAST entry so an admin editing a
      // duplicate row sees their change take effect. Blank-name rows are PRESERVED
      // so an admin who clicked "Add Variable" and pressed Save before filling in
      // a name doesn't silently lose the row.
      const cleanedFirmVariables = (() => {
        const seen = new Map<string, { name: string; label: string; value: number }>();
        const blanks: Array<{ name: string; label: string; value: number }> = [];
        for (const v of firmVariables) {
          const trimmedName = (v.name || '').trim();
          const row = { name: trimmedName, label: v.label || trimmedName, value: Number(v.value) || 0 };
          if (!trimmedName) {
            blanks.push(row);
            continue;
          }
          seen.set(trimmedName, row);
        }
        return [...Array.from(seen.values()), ...blanks];
      })();

      // Save firm_variables in its own isolated call so an unrelated row failure
      // in the batch below can't drop it.
      async function saveTable(tableType: string, data: any) {
        const r = await fetch('/api/methodology-admin/risk-tables', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ firmId, tableType, data }),
        });
        if (!r.ok) {
          let detail = '';
          try { detail = (await r.json()).error || ''; } catch {}
          throw new Error(`${tableType}: ${r.status} ${detail}`);
        }
      }

      // Critical tables first, isolated per call so we can tell which one failed
      const errors: string[] = [];
      for (const [tableType, data] of [
        ['firm_variables', { variables: cleanedFirmVariables }],
        ['inherent', inherentRisk],
        ['control', controlRisk],
        ['assertions', assertions],
        ['specialistRoles', { roles: specialistRoles }],
        ['testCategories', { categories: testCategories }],
        ['arConfidenceFactor', { confidenceFactor: arConfidenceFactor }],
        ['fxProvider', { provider: fxProvider }],
        ['riskClassification', riskClassification ?? {}],
        ['large_unusual_scoring', {
          descriptionPatterns: luPatterns,
          thresholds: luThresholds,
          sizeScoring: initialLargeUnusualScoring?.sizeScoring,
          timingScoring: initialLargeUnusualScoring?.timingScoring,
          otherScoring: initialLargeUnusualScoring?.otherScoring,
        }],
      ] as const) {
        try {
          await saveTable(tableType, data);
        } catch (e: any) {
          errors.push(e?.message || String(e));
        }
      }

      // Confidence is a separate endpoint
      try {
        const cr = await fetch('/api/methodology-admin/confidence', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ firmId, confidenceLevel }),
        });
        if (!cr.ok) throw new Error(`confidence: ${cr.status}`);
      } catch (e: any) {
        errors.push(e?.message || String(e));
      }

      // Reflect the cleaned list back into state so the admin sees exactly what
      // was saved (empty rows gone, duplicates collapsed).
      setFirmVariables(cleanedFirmVariables);

      if (errors.length > 0) {
        setSaveError(`Saved with errors: ${errors.join('; ')}`);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (err: any) {
      console.error('Save failed:', err);
      setSaveError(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Save button + error banner */}
      <div className="flex items-center justify-end gap-3">
        {saveError && (
          <div className="flex-1 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
            <strong>Save error:</strong> {saveError}
          </div>
        )}
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

      {/* Risk Classification Table — maps Overall Risk → test allocation category */}
      <div className="border rounded-lg">
        <button
          onClick={() => toggleSection('riskClassification')}
          className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 rounded-t-lg"
        >
          <h2 className="text-lg font-semibold text-slate-900">Risk Classification (Test Allocation)</h2>
          {expandedSections.riskClassification ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </button>
        {expandedSections.riskClassification && (
          <div className="p-4">
            <p className="text-sm text-slate-500 mb-3">
              Determines which tests are allocated based on the Overall Risk from the Control Risk Table above.
              The <strong>Test Classification</strong> column is derived automatically and shows which Audit Test
              Categories will be pulled for each row in the Audit Plan.
            </p>
            <table className="border-collapse">
              <thead>
                <tr>
                  <th className="border border-slate-300 p-2 bg-slate-100 text-sm font-medium text-left min-w-[120px]">Overall Risk Level</th>
                  <th className="border border-slate-300 p-2 bg-slate-100 text-sm font-medium text-center min-w-[180px]">Classification</th>
                  <th className="border border-slate-300 p-2 bg-slate-100 text-sm font-medium text-center min-w-[220px]">Test Classification</th>
                </tr>
              </thead>
              <tbody>
                {RISK_LEVELS.map(level => {
                  const val = riskClassification[level] || 'AR';
                  // Derived: Significant Risk and Area of Focus broaden into "+ Normal"
                  // so the Audit Plan pulls Normal tests in addition to the higher-tier
                  // tests for those rows. AR and Normal stay as-is.
                  const testClassification =
                    val === 'Significant Risk' ? 'Significant Risk + Normal' :
                    val === 'Area of Focus' ? 'Area of Focus + Normal' :
                    val === 'AR' ? 'AR' :
                    'Normal';
                  return (
                    <tr key={level}>
                      <td className={`border border-slate-300 p-2 text-sm font-medium ${RISK_COLORS[level] || ''}`}>{level}</td>
                      <td className={`border border-slate-300 p-1 ${CLASSIFICATION_COLORS[val] || ''}`}>
                        <select
                          value={val}
                          onChange={e => { setRiskClassification(prev => ({ ...prev, [level]: e.target.value as RiskClassification })); setSaved(false); }}
                          className="w-full text-sm border-0 bg-transparent focus:ring-1 focus:ring-blue-500 rounded p-1 cursor-pointer"
                        >
                          {CLASSIFICATION_OPTIONS.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </td>
                      <td className="border border-slate-300 p-2 text-sm text-slate-700 text-center bg-slate-50/50 italic">
                        {testClassification}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[10px] text-slate-400 mt-2">
              Test Classification is derived from Classification — Significant Risk and Area of Focus rows
              automatically include Normal tests as well. The Audit Plan reads this to filter tests per row.
            </p>
          </div>
        )}
      </div>

      {/* FX Rate Provider */}
      <div className="border rounded-lg">
        <button
          onClick={() => toggleSection('fxProvider')}
          className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 rounded-t-lg"
        >
          <h2 className="text-lg font-semibold text-slate-900">FX Rate Provider</h2>
          {expandedSections.fxProvider ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </button>
        {expandedSections.fxProvider && (
          <div className="p-4">
            <p className="text-sm text-slate-500 mb-3">Select the provider used for historical date-specific exchange rates when translating foreign currency transactions into the functional currency.</p>
            <select
              value={fxProvider}
              onChange={e => { setFxProvider(e.target.value); setSaved(false); }}
              className="w-full max-w-md text-sm border rounded px-3 py-2 bg-white"
            >
              <option value="frankfurter">Frankfurter (ECB rates — free, no key required)</option>
              <option value="exchangerate_api">ExchangeRate-API (free tier, key required)</option>
              <option value="fixer">Fixer.io (ECB rates — free tier, key required)</option>
              <option value="wise">Wise / TransferWise (market rates — key required)</option>
              <option value="manual">Manual Entry (no automatic lookup)</option>
            </select>
            {fxProvider === 'frankfurter' && (
              <p className="text-xs text-green-600 mt-2">European Central Bank reference rates. Updated daily. No API key needed.</p>
            )}
            {(fxProvider === 'exchangerate_api' || fxProvider === 'fixer' || fxProvider === 'wise') && (
              <p className="text-xs text-amber-600 mt-2">This provider requires an API key. Configure it in your environment variables.</p>
            )}
            {fxProvider === 'manual' && (
              <p className="text-xs text-slate-500 mt-2">FX rates will need to be entered manually during test execution.</p>
            )}
          </div>
        )}
      </div>

      {/* OCR / Document Intelligence Provider */}
      <div className="border rounded-lg">
        <button
          onClick={() => toggleSection('ocrProvider')}
          className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 rounded-t-lg"
        >
          <h2 className="text-lg font-semibold text-slate-900">OCR / Document Intelligence Provider</h2>
          {expandedSections.ocrProvider ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </button>
        {expandedSections.ocrProvider && (
          <div className="p-4">
            <p className="text-sm text-slate-500 mb-3">Select the provider used for extracting data from scanned documents (bank statements, invoices, etc.).</p>
            <select
              value={(riskClassification as any)._ocrProvider || 'azure_di'}
              onChange={e => { setRiskClassification(prev => ({ ...prev, _ocrProvider: e.target.value } as any)); setSaved(false); }}
              className="w-full max-w-md text-sm border rounded px-3 py-2 bg-white"
            >
              <option value="azure_di">Azure Document Intelligence (fast, handles text + scanned PDFs)</option>
              <option value="ai_vision">AI Vision (slower, no extra service needed)</option>
            </select>
            {((riskClassification as any)._ocrProvider || 'azure_di') === 'azure_di' && (
              <p className="text-xs text-blue-600 mt-2">Requires AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY environment variables. Processes 57-page PDFs in ~10 seconds.</p>
            )}
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

      {/* Test Categories */}
      <div className="border rounded-lg">
        <button
          onClick={() => toggleSection('testCategories')}
          className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 rounded-t-lg"
        >
          <h2 className="text-lg font-semibold text-slate-900">Audit Test Categories</h2>
          {expandedSections.testCategories ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </button>
        {expandedSections.testCategories && (
          <div className="p-4">
            <p className="text-sm text-slate-500 mb-3">Define test categories used in the Test Bank. Each test is assigned one category which drives risk-based test selection in the Audit Plan.</p>
            <div className="space-y-2 mb-3">
              {testCategories.map((cat, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    cat === 'Significant Risk' ? 'bg-red-500' :
                    cat === 'Area of Focus' ? 'bg-orange-500' :
                    cat === 'Analytical Review' ? 'bg-green-500' :
                    cat === 'Mandatory' ? 'bg-blue-500' : 'bg-slate-400'
                  }`} />
                  <span className="text-sm text-slate-700 flex-1">{cat}</span>
                  <button
                    onClick={() => { setTestCategories(prev => prev.filter((_, i) => i !== idx)); setSaved(false); }}
                    className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {testCategories.length === 0 && (
                <p className="text-sm text-slate-400 italic">No test categories defined.</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newCategory}
                onChange={e => setNewCategory(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newCategory.trim()) {
                    setTestCategories(prev => [...prev, newCategory.trim()]);
                    setNewCategory('');
                    setSaved(false);
                  }
                }}
                placeholder="Add category (e.g. Special Purpose)"
                className="flex-1 max-w-xs px-3 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <button
                onClick={() => {
                  if (newCategory.trim()) {
                    setTestCategories(prev => [...prev, newCategory.trim()]);
                    setNewCategory('');
                    setSaved(false);
                  }
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>
          </div>
        )}
      </div>

      {/* AR Confidence Factor */}
      <div className="border rounded-lg">
        <button
          onClick={() => toggleSection('arConfidence')}
          className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 rounded-t-lg"
        >
          <h2 className="text-lg font-semibold text-slate-900">AR Confidence Factor</h2>
          {expandedSections.arConfidence ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </button>
        {expandedSections.arConfidence && (
          <div className="p-4">
            <p className="text-sm text-slate-500 mb-3">
              The confidence factor is multiplied by tolerance materiality to set the threshold for analytical review procedures.
              A higher value requires smaller differences to pass. Default is 1.0.
            </p>
            <div className="flex items-center space-x-4">
              <label className="text-sm font-medium text-slate-700">Confidence Factor</label>
              <input
                type="number"
                min={0.1}
                max={5}
                step={0.1}
                value={arConfidenceFactor}
                onChange={(e) => { setArConfidenceFactor(Number(e.target.value)); setSaved(false); }}
                className="w-24 border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* Firm Variables — hard-coded numeric values referenced from schedule formulas */}
      <div className="border rounded-lg">
        <button
          onClick={() => toggleSection('firmVariables')}
          className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 rounded-t-lg"
        >
          <h2 className="text-lg font-semibold text-slate-900">Firm Variables</h2>
          {expandedSections.firmVariables ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </button>
        {expandedSections.firmVariables && (
          <div className="p-4 space-y-3">
            <p className="text-sm text-slate-500">
              Hard-coded numeric values that can be referenced from any schedule formula.
              Give each one a short <strong>name</strong> (snake_case, no spaces — this is the identifier
              you type in formulas), a human-friendly <strong>label</strong>, and a <strong>value</strong>.
              Example: a variable named <code className="bg-slate-100 px-1 rounded text-xs">firm_fees</code>{' '}
              can then be used in the Ethics schedule formula{' '}
              <code className="bg-slate-100 px-1 rounded text-xs">total_fees / firm_fees * 100</code>.
              Changes flow through to every engagement on next load — they&apos;re not baked into old engagements.
            </p>

            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-xs text-slate-500 uppercase">
                    <th className="px-3 py-2 font-semibold w-48">Name (identifier)</th>
                    <th className="px-3 py-2 font-semibold">Label</th>
                    <th className="px-3 py-2 font-semibold w-40">Value</th>
                    <th className="px-3 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {firmVariables.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-xs text-slate-400 italic">
                        No firm variables yet. Click &quot;Add Variable&quot; to create one.
                      </td>
                    </tr>
                  )}
                  {firmVariables.map((v, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={v.name}
                          onChange={(e) => {
                            const clean = e.target.value.replace(/[^a-zA-Z0-9_]/g, '');
                            setFirmVariables(prev => prev.map((x, i) => i === idx ? { ...x, name: clean } : x));
                            setSaved(false);
                          }}
                          onBlur={() => void persistFirmVariables(firmVariables)}
                          placeholder="firm_fees"
                          className="w-full border border-slate-300 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={v.label}
                          onChange={(e) => {
                            setFirmVariables(prev => prev.map((x, i) => i === idx ? { ...x, label: e.target.value } : x));
                            setSaved(false);
                          }}
                          onBlur={() => void persistFirmVariables(firmVariables)}
                          placeholder="Firm Annual Fee Income"
                          className="w-full border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          step="any"
                          value={v.value}
                          onChange={(e) => {
                            setFirmVariables(prev => prev.map((x, i) => i === idx ? { ...x, value: Number(e.target.value) || 0 } : x));
                            setSaved(false);
                          }}
                          onBlur={() => void persistFirmVariables(firmVariables)}
                          className="w-full border border-slate-300 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => {
                            const next = firmVariables.filter((_, i) => i !== idx);
                            setFirmVariables(next);
                            setSaved(false);
                            void persistFirmVariables(next);
                          }}
                          className="text-slate-400 hover:text-red-500"
                          aria-label="Delete variable"
                          title="Delete variable"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              onClick={() => {
                const next = [...firmVariables, { name: '', label: '', value: 0 }];
                setFirmVariables(next);
                setSaved(false);
                // Persist immediately so the new row survives a refresh — the
                // admin no longer has to remember to click "Save All" after
                // adding a row.
                void persistFirmVariables(next);
              }}
              disabled={firmVariablesSaving}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60"
            >
              {firmVariablesSaving ? (
                <><Loader2 className="h-3 w-3 animate-spin" /> Saving...</>
              ) : (
                <>+ Add Variable</>
              )}
            </button>

            {/* Duplicate name warning */}
            {(() => {
              const seen = new Set<string>();
              const dupes = new Set<string>();
              for (const v of firmVariables) {
                if (v.name && seen.has(v.name)) dupes.add(v.name);
                if (v.name) seen.add(v.name);
              }
              if (dupes.size > 0) {
                return (
                  <p className="text-xs text-red-600">
                    Duplicate variable names: {Array.from(dupes).join(', ')}. Names must be unique.
                  </p>
                );
              }
              return null;
            })()}
          </div>
        )}
      </div>

      {/* Large & Unusual Scoring Rules */}
      <div className="border rounded-lg">
        <button
          onClick={() => toggleSection('largeUnusual')}
          className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 rounded-t-lg"
        >
          <h2 className="text-lg font-semibold text-slate-900">Large & Unusual Transaction Scoring</h2>
          {expandedSections.largeUnusual ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </button>
        {expandedSections.largeUnusual && (
          <div className="p-4 space-y-4">
            <p className="text-sm text-slate-500">
              Configure the description patterns used to flag unusual transactions. Each pattern is matched against transaction descriptions.
              The weight determines how much it contributes to the composite unusualness score. Items above the threshold are highlighted for auditor review.
            </p>

            {/* Thresholds */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">Scoring Threshold</label>
                <input type="number" min={1} max={200} value={luThresholds.mediumRisk}
                  onChange={e => { setLuThresholds(prev => ({ ...prev, mediumRisk: parseInt(e.target.value) || 15 })); setSaved(false); }}
                  className="w-full border rounded px-3 py-2 text-sm" />
                <span className="text-[10px] text-slate-400 block mt-1">
                  Items scoring at or above this appear <span className="text-orange-600 font-medium">orange</span> for review.
                  Below = white. Auditor decides red (investigate) or exclude to white.
                </span>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">Financial Threshold (% of PM)</label>
                <input type="number" min={0} max={100} step={1} value={luThresholds.financialPctPM}
                  onChange={e => { setLuThresholds(prev => ({ ...prev, financialPctPM: parseFloat(e.target.value) || 5 })); setSaved(false); }}
                  className="w-full border rounded px-3 py-2 text-sm" />
                <span className="text-[10px] text-slate-400 block mt-1">
                  Transactions below this % of Performance Materiality are filtered out before scoring.
                  E.g. 5% of £100,000 PM = items below £5,000 excluded from the orange/white/red population.
                </span>
              </div>
            </div>

            {/* Pattern list */}
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-2">Description Patterns ({luPatterns.length})</label>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-100 border-b">
                      <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Keywords (regex)</th>
                      <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Category</th>
                      <th className="px-2 py-1.5 text-right font-semibold text-slate-600 w-20">Weight</th>
                      <th className="px-2 py-1.5 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {luPatterns.map((p, i) => (
                      <tr key={i} className="border-b border-slate-50">
                        <td className="px-2 py-1">
                          <input value={p.pattern} onChange={e => { const u = [...luPatterns]; u[i] = { ...u[i], pattern: e.target.value }; setLuPatterns(u); setSaved(false); }}
                            className="w-full border border-slate-200 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-blue-300" />
                        </td>
                        <td className="px-2 py-1">
                          <input value={p.category} onChange={e => { const u = [...luPatterns]; u[i] = { ...u[i], category: e.target.value }; setLuPatterns(u); setSaved(false); }}
                            className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-300" />
                        </td>
                        <td className="px-2 py-1">
                          <input type="number" min={1} max={100} value={p.weight} onChange={e => { const u = [...luPatterns]; u[i] = { ...u[i], weight: parseInt(e.target.value) || 10 }; setLuPatterns(u); setSaved(false); }}
                            className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-right font-mono focus:outline-none focus:border-blue-300" />
                        </td>
                        <td className="px-1 py-1 text-center">
                          <button onClick={() => { setLuPatterns(prev => prev.filter((_, idx) => idx !== i)); setSaved(false); }}
                            className="p-0.5 text-slate-400 hover:text-red-500"><X className="h-3 w-3" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Add new pattern */}
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="text-[10px] text-slate-500 block mb-0.5">Keywords (plain words — comma or space separated)</label>
                <input value={newLuPattern} onChange={e => setNewLuPattern(e.target.value)}
                  placeholder="e.g. bonus, incentive, commission" className="w-full border rounded px-2 py-1.5 text-xs" />
              </div>
              <div className="flex-1">
                <label className="text-[10px] text-slate-500 block mb-0.5">Category name</label>
                <input value={newLuCategory} onChange={e => setNewLuCategory(e.target.value)}
                  placeholder="e.g. Bonus/incentive" className="w-full border rounded px-2 py-1.5 text-xs" />
              </div>
              <div className="w-20">
                <label className="text-[10px] text-slate-500 block mb-0.5">Weight</label>
                <input type="number" min={1} max={100} value={newLuWeight} onChange={e => setNewLuWeight(parseInt(e.target.value) || 15)}
                  className="w-full border rounded px-2 py-1.5 text-xs text-right font-mono" />
              </div>
              <button onClick={() => {
                if (newLuPattern.trim() && newLuCategory.trim()) {
                  // Convert plain words to regex: "bonus, incentive, commission" → "bonus|incentive|commission"
                  const words = newLuPattern.trim().split(/[,\s]+/).map(w => w.trim()).filter(Boolean);
                  const regex = words.join('|');
                  setLuPatterns(prev => [...prev, { pattern: regex, category: newLuCategory.trim(), weight: newLuWeight }]);
                  setNewLuPattern(''); setNewLuCategory(''); setNewLuWeight(15); setSaved(false);
                }
              }} className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">
                <Plus className="h-3 w-3 inline mr-0.5" /> Add
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

      {/* ═══ Materiality Settings ═══ */}
      <MaterialitySettingsSection firmId={firmId} onSave={() => setSaved(true)} />

      {/* ═══ Technical Team ═══ */}
      <TechnicalTeamSection firmId={firmId} onSave={() => setSaved(true)} />

      {/* ═══ PAR Significant Change Criteria ═══ */}
      <PARCriteriaSection firmId={firmId} onSave={() => setSaved(true)} />

      {/* ═══ Revenue Recognition ═══ */}
      <RevenueRecognitionSection firmId={firmId} onSave={() => setSaved(true)} />

      {/* ═══ Communication Headings ═══ */}
      <CommunicationHeadingsSection firmId={firmId} onSave={() => setSaved(true)} />

      {/* ═══ Independence Questions ═══
          Firm-wide questionnaire every team member must confirm before they
          can view or interact with an engagement. Has its own Save button
          (via the embedded IndependenceQuestionsClient) independent of the
          "Save All" above. */}
      <div className="border rounded-lg">
        <button
          onClick={() => toggleSection('independence')}
          className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 rounded-t-lg"
        >
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" /> Independence Questions
          </h2>
          {expandedSections.independence ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </button>
        {expandedSections.independence && (
          <div className="p-4">
            <p className="text-sm text-slate-600 mb-4">
              These questions appear as a blocking modal the first time each team member opens an engagement after
              the audit has started — and again each time their last confirmation is older than the cadence set
              below. A team member cannot view or interact with the engagement until they confirm. If they answer
              &ldquo;No&rdquo; to any <strong>Critical</strong> question — or explicitly declare they are NOT
              independent — the Responsible Individual and Ethics Partner are emailed automatically and the team
              member is locked out of the engagement.
            </p>
            <IndependenceRefreshDaysClient initialRules={initialIndependenceRefreshRules || [{ auditType: 'ALL', days: 30 }]} />
            <IndependenceQuestionsClient initialQuestions={initialIndependenceQuestions || []} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Materiality Range + Rounding ────────────────────────────────────
const DEFAULT_RANGE = [
  { benchmark: 'Profit before Tax', low: 0.05, high: 0.10 },
  { benchmark: 'Gross Profit', low: 0.01, high: 0.04 },
  { benchmark: 'Total Revenue', low: 0.005, high: 0.02 },
  { benchmark: 'Total Expenses', low: 0.005, high: 0.02 },
  { benchmark: 'Total Equity or Net Assets', low: 0.01, high: 0.05 },
  { benchmark: 'Total Assets', low: 0.005, high: 0.02 },
];

function MaterialitySettingsSection({ firmId, onSave }: { firmId: string; onSave: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [range, setRange] = useState<{ benchmark: string; low: number; high: number }[]>(DEFAULT_RANGE);
  const [roundingM, setRoundingM] = useState(3);
  const [roundingPM, setRoundingPM] = useState(3);
  const [roundingCT, setRoundingCT] = useState(3);
  const [pmPresets, setPmPresets] = useState<{ low: number; medium: number; high: number }>({ low: 50, medium: 62.5, high: 75 });
  const [ctSettings, setCtSettings] = useState<{ basis: string; pct: number }>({ basis: 'Materiality', pct: 5 });
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (loaded) return;
    try {
      const [rangeRes, roundRes, pmRes, ctRes] = await Promise.all([
        fetch('/api/methodology-admin/risk-tables?tableType=materiality_range'),
        fetch('/api/methodology-admin/risk-tables?tableType=materiality_rounding'),
        fetch('/api/methodology-admin/risk-tables?tableType=pm_presets'),
        fetch('/api/methodology-admin/risk-tables?tableType=clearly_trivial'),
      ]);
      if (rangeRes.ok) {
        const d = await rangeRes.json();
        if (d.table?.data && Array.isArray(d.table.data) && d.table.data.length > 0) setRange(d.table.data);
      }
      if (roundRes.ok) {
        const d = await roundRes.json();
        if (d.table?.data) {
          setRoundingM(d.table.data.materiality ?? d.table.data.rounding ?? 3);
          setRoundingPM(d.table.data.performanceMateriality ?? d.table.data.rounding ?? 3);
          setRoundingCT(d.table.data.clearlyTrivial ?? d.table.data.rounding ?? 3);
        }
      }
      if (pmRes.ok) {
        const d = await pmRes.json();
        if (d.table?.data) setPmPresets(d.table.data);
      }
      if (ctRes.ok) {
        const d = await ctRes.json();
        if (d.table?.data) setCtSettings(d.table.data);
      }
    } catch {}
    setLoaded(true);
  }, [loaded]);

  async function handleSave() {
    setSaving(true);
    try {
      await Promise.all([
        fetch('/api/methodology-admin/risk-tables', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableType: 'materiality_range', data: range }),
        }),
        fetch('/api/methodology-admin/risk-tables', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableType: 'materiality_rounding', data: { materiality: roundingM, performanceMateriality: roundingPM, clearlyTrivial: roundingCT } }),
        }),
        fetch('/api/methodology-admin/risk-tables', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableType: 'pm_presets', data: pmPresets }),
        }),
        fetch('/api/methodology-admin/risk-tables', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableType: 'clearly_trivial', data: ctSettings }),
        }),
      ]);
      onSave();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => { setExpanded(!expanded); if (!expanded) load(); }}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <h2 className="text-sm font-semibold text-slate-800">Materiality Settings</h2>
        {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>
      {expanded && (
        <div className="p-4 space-y-4">
          {/* Rounding — separate for each measure */}
          <div>
            <h3 className="text-sm font-medium text-slate-700 mb-2">Rounding (round down to nearest)</h3>
            <div className="flex items-center gap-6">
              <div>
                <label className="text-xs text-slate-500 block mb-0.5">Materiality</label>
                <select value={roundingM} onChange={e => setRoundingM(Number(e.target.value))} className="border rounded px-2 py-1.5 text-sm">
                  {[1,2,3,4,5,6,7,8,9].map(r => <option key={r} value={r}>10^{r} ({Math.pow(10,r).toLocaleString()})</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-0.5">Performance Materiality</label>
                <select value={roundingPM} onChange={e => setRoundingPM(Number(e.target.value))} className="border rounded px-2 py-1.5 text-sm">
                  {[1,2,3,4,5,6,7,8,9].map(r => <option key={r} value={r}>10^{r} ({Math.pow(10,r).toLocaleString()})</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-0.5">Clearly Trivial</label>
                <select value={roundingCT} onChange={e => setRoundingCT(Number(e.target.value))} className="border rounded px-2 py-1.5 text-sm">
                  {[1,2,3,4,5,6,7,8,9].map(r => <option key={r} value={r}>10^{r} ({Math.pow(10,r).toLocaleString()})</option>)}
                </select>
              </div>
            </div>
          </div>
          {/* Benchmark Range Table */}
          <div>
            <h3 className="text-sm font-medium text-slate-700 mb-2">Materiality Benchmark Ranges</h3>
            <table className="w-full text-sm border rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-slate-100">
                  <th className="text-left px-3 py-2 font-medium text-slate-600">Benchmark</th>
                  <th className="text-right px-3 py-2 font-medium text-slate-600 w-28">Low %</th>
                  <th className="text-right px-3 py-2 font-medium text-slate-600 w-28">High %</th>
                </tr>
              </thead>
              <tbody>
                {range.map((r, i) => {
                  const lowInvalid = r.low < 0;
                  const highInvalid = r.high < 0 || r.high < r.low;
                  return (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2 text-slate-700">{r.benchmark}</td>
                      <td className="px-3 py-1">
                        <input type="text" inputMode="decimal" value={r.low * 100} onChange={e => {
                          const v = e.target.value.replace(/[^0-9.]/g, '');
                          const n = parseFloat(v);
                          const updated = [...range];
                          updated[i] = { ...r, low: (v === '' || isNaN(n)) ? 0 : Math.max(0, n) / 100 };
                          setRange(updated);
                        }} className={`w-full text-right border rounded px-2 py-1 text-sm ${lowInvalid ? 'border-red-400 bg-red-50' : ''}`} />
                      </td>
                      <td className="px-3 py-1">
                        <input type="text" inputMode="decimal" value={r.high * 100} onChange={e => {
                          const v = e.target.value.replace(/[^0-9.]/g, '');
                          const n = parseFloat(v);
                          const updated = [...range];
                          updated[i] = { ...r, high: (v === '' || isNaN(n)) ? 0 : Math.max(0, n) / 100 };
                          setRange(updated);
                        }} className={`w-full text-right border rounded px-2 py-1 text-sm ${highInvalid ? 'border-red-400 bg-red-50' : ''}`} />
                        {highInvalid && r.high < r.low && <span className="text-[9px] text-red-500">Must be &ge; Low</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Performance Materiality Preset Values */}
          <div>
            <h3 className="text-sm font-medium text-slate-700 mb-2">Performance Materiality Preset Values (%)</h3>
            <div className="flex items-center gap-4">
              <div>
                <label className="text-xs text-slate-500 block mb-0.5">Low</label>
                <input type="text" inputMode="decimal" value={pmPresets.low} onChange={e => {
                  const n = parseFloat(e.target.value.replace(/[^0-9.]/g, ''));
                  setPmPresets(p => ({ ...p, low: isNaN(n) ? 0 : Math.max(0, n) }));
                }} className="w-24 text-right border rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-0.5">Medium</label>
                <input type="text" inputMode="decimal" value={pmPresets.medium} onChange={e => {
                  const n = parseFloat(e.target.value.replace(/[^0-9.]/g, ''));
                  setPmPresets(p => ({ ...p, medium: isNaN(n) ? 0 : Math.max(0, n) }));
                }} className="w-24 text-right border rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-0.5">High</label>
                <input type="text" inputMode="decimal" value={pmPresets.high} onChange={e => {
                  const n = parseFloat(e.target.value.replace(/[^0-9.]/g, ''));
                  setPmPresets(p => ({ ...p, high: isNaN(n) ? 0 : Math.max(0, n) }));
                }} className="w-24 text-right border rounded px-2 py-1.5 text-sm" />
              </div>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">The weighted PM indicator average is rounded to the nearest of these values</p>
          </div>

          {/* Clearly Trivial Settings */}
          <div>
            <h3 className="text-sm font-medium text-slate-700 mb-2">Clearly Trivial</h3>
            <div className="flex items-center gap-4">
              <div>
                <label className="text-xs text-slate-500 block mb-0.5">Based on</label>
                <select value={ctSettings.basis} onChange={e => setCtSettings(p => ({ ...p, basis: e.target.value }))} className="border rounded px-2 py-1.5 text-sm">
                  <option value="Materiality">Materiality</option>
                  <option value="Performance Materiality">Performance Materiality</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-0.5">Percentage</label>
                <div className="flex items-center gap-1">
                  <input type="text" inputMode="decimal" value={ctSettings.pct} onChange={e => {
                    const n = parseFloat(e.target.value.replace(/[^0-9.]/g, ''));
                    setCtSettings(p => ({ ...p, pct: isNaN(n) ? 0 : Math.max(0, n) }));
                  }} className="w-20 text-right border rounded px-2 py-1.5 text-sm" />
                  <span className="text-sm text-slate-500">%</span>
                </div>
              </div>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">Clearly Trivial = {ctSettings.basis} × {ctSettings.pct}%</p>
          </div>

          <Button onClick={handleSave} size="sm" disabled={saving || range.some(r => r.high < r.low)}>
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            Save Materiality Settings
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Technical Team ──────────────────────────────────────────────────
function TechnicalTeamSection({ firmId, onSave }: { firmId: string; onSave: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [teamEmail, setTeamEmail] = useState('');
  const [members, setMembers] = useState<{ name: string; email: string; role: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('Technical Reviewer');

  const load = useCallback(async () => {
    if (loaded) return;
    try {
      const res = await fetch('/api/methodology-admin/risk-tables?tableType=technical_team');
      if (res.ok) {
        const d = await res.json();
        if (d.table?.data) {
          setTeamEmail(d.table.data.email || '');
          setMembers(d.table.data.members || []);
        }
      }
    } catch {}
    setLoaded(true);
  }, [loaded]);

  async function handleSave() {
    setSaving(true);
    try {
      await fetch('/api/methodology-admin/risk-tables', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableType: 'technical_team', data: { email: teamEmail, members } }),
      });
      onSave();
    } finally {
      setSaving(false);
    }
  }

  function addMember() {
    if (!newName.trim() || !newEmail.trim()) return;
    setMembers([...members, { name: newName.trim(), email: newEmail.trim(), role: newRole }]);
    setNewName(''); setNewEmail(''); setNewRole('Technical Reviewer');
  }

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => { setExpanded(!expanded); if (!expanded) load(); }}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <h2 className="text-sm font-semibold text-slate-800">Technical Team</h2>
        {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>
      {expanded && (
        <div className="p-4 space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Team Email</label>
            <input type="email" value={teamEmail} onChange={e => setTeamEmail(e.target.value)} placeholder="technical@firm.com" className="w-full max-w-md border rounded px-3 py-2 text-sm" />
            <p className="text-[10px] text-slate-400 mt-0.5">Emails for technical breaches are sent to this address</p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-slate-700 mb-2">Team Members</h3>
            {members.length > 0 && (
              <div className="border rounded-lg divide-y mb-3">
                {members.map((m, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2">
                    <span className="text-sm text-slate-800 flex-1">{m.name}</span>
                    <span className="text-xs text-slate-500 flex-1">{m.email}</span>
                    <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{m.role}</span>
                    <button onClick={() => setMembers(members.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <div>
                <label className="text-xs text-slate-500 block mb-0.5">Name</label>
                <input type="text" value={newName} onChange={e => setNewName(e.target.value)} className="border rounded px-2 py-1.5 text-sm w-40" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-0.5">Email</label>
                <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} className="border rounded px-2 py-1.5 text-sm w-48" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-0.5">Role</label>
                <select value={newRole} onChange={e => setNewRole(e.target.value)} className="border rounded px-2 py-1.5 text-sm">
                  <option>Technical Reviewer</option>
                  <option>Technical Partner</option>
                  <option>Technical Manager</option>
                </select>
              </div>
              <Button onClick={addMember} size="sm" variant="outline" disabled={!newName.trim() || !newEmail.trim()}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
            </div>
          </div>
          <Button onClick={handleSave} size="sm" disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            Save Technical Team
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── PAR Significant Change Criteria ─────────────────────────────
function PARCriteriaSection({ firmId, onSave }: { firmId: string; onSave: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [row1Basis, setRow1Basis] = useState('Performance Materiality');
  const [row2Pct, setRow2Pct] = useState(10);
  const [combinator, setCombinator] = useState('AND');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (loaded) return;
    try {
      const res = await fetch('/api/methodology-admin/risk-tables?tableType=par_criteria');
      if (res.ok) {
        const d = await res.json();
        if (d.table?.data) {
          setRow1Basis(d.table.data.row1Basis || 'Performance Materiality');
          setRow2Pct(d.table.data.row2Pct ?? 10);
          setCombinator(d.table.data.combinator || 'AND');
        }
      }
    } catch {}
    setLoaded(true);
  }, [loaded]);

  async function handleSave() {
    setSaving(true);
    try {
      await fetch('/api/methodology-admin/risk-tables', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableType: 'par_criteria', data: { row1Basis, row2Pct, combinator } }),
      });
      onSave();
    } finally { setSaving(false); }
  }

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => { setExpanded(!expanded); if (!expanded) load(); }}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <h2 className="text-sm font-semibold text-slate-800">Preliminary Analytical Review — Significant Change Criteria</h2>
        {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>
      {expanded && (
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-700 w-56">Absolute Variance greater than</span>
            <select value={row1Basis} onChange={e => setRow1Basis(e.target.value)} className="border rounded px-2 py-1.5 text-sm">
              <option value="Materiality">Materiality</option>
              <option value="Performance Materiality">Performance Materiality</option>
              <option value="Clearly Trivial">Clearly Trivial</option>
            </select>
          </div>
          <div className="flex items-center justify-center">
            <select value={combinator} onChange={e => setCombinator(e.target.value)} className="border rounded px-3 py-1.5 text-sm font-semibold text-blue-700 bg-blue-50 border-blue-200">
              <option value="AND">AND</option>
              <option value="OR">OR</option>
            </select>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-700 w-56">Absolute Variance % change greater than</span>
            <div className="flex items-center gap-1">
              <input type="text" inputMode="decimal" value={row2Pct} onChange={e => {
                const n = parseFloat(e.target.value.replace(/[^0-9.]/g, ''));
                setRow2Pct(isNaN(n) ? 0 : Math.max(0, n));
              }} className="w-20 text-right border rounded px-2 py-1.5 text-sm" />
              <span className="text-sm text-slate-500">%</span>
            </div>
          </div>
          <p className="text-[10px] text-slate-400">
            A line is "Material" when: Absolute Variance &gt; {row1Basis} <span className="font-bold text-blue-600">{combinator}</span> Variance % &gt; {row2Pct}%
          </p>
          <Button onClick={handleSave} size="sm" disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            Save PAR Criteria
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Revenue Recognition ─────────────────────────────────────────
function RevenueRecognitionSection({ firmId, onSave }: { firmId: string; onSave: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<{ label: string }[]>([{ label: 'Invoice' }]);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (loaded) return;
    try {
      const res = await fetch('/api/methodology-admin/risk-tables?tableType=revenue_recognition');
      if (res.ok) {
        const d = await res.json();
        if (d.table?.data?.items && Array.isArray(d.table.data.items)) {
          setItems(d.table.data.items.map((i: any) => ({ label: i.label || i })));
        }
      }
    } catch {}
    setLoaded(true);
  }, [loaded]);

  async function handleSave() {
    setSaving(true);
    try {
      await fetch('/api/methodology-admin/risk-tables', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableType: 'revenue_recognition', data: { items } }),
      });
      onSave();
    } finally { setSaving(false); }
  }

  function addItem() { setItems([...items, { label: '' }]); }
  function removeItem(idx: number) { setItems(items.filter((_, i) => i !== idx)); }
  function updateItem(idx: number, val: string) {
    setItems(items.map((item, i) => i === idx ? { ...item, label: val } : item));
  }

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => { setExpanded(!expanded); if (!expanded) load(); }}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <h2 className="text-sm font-semibold text-slate-800">Revenue Recognition</h2>
        {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>
      {expanded && (
        <div className="p-4 space-y-3">
          <div className="border rounded-lg divide-y">
            <div className="grid grid-cols-[1fr,40px] gap-2 px-3 py-2 bg-slate-50 text-xs font-semibold text-slate-600">
              <span>Item</span>
              <span />
            </div>
            {items.map((item, i) => (
              <div key={i} className="grid grid-cols-[1fr,40px] gap-2 px-3 py-1.5 items-center">
                <input type="text" value={item.label} onChange={e => updateItem(i, e.target.value)} placeholder="e.g. Invoice" className="border rounded px-2 py-1 text-sm" />
                <button onClick={() => removeItem(i)} className="text-red-400 hover:text-red-600 text-center"><X className="h-3.5 w-3.5 mx-auto" /></button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={addItem} className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 font-medium">+ Add</button>
            <Button onClick={handleSave} size="sm" disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Communication Headings (Board Minutes + TCWG + Shareholders + Overall) ──
const DEFAULT_BOARD_HEADINGS = ['Litigation', 'Committed Capital Expenditure', 'Performance Concerns', 'Significant Disposals', 'Fraud'];
const DEFAULT_TCWG_HEADINGS_CFG = ['Valuations', 'Accounting Policies', 'Cashflow', 'Significant Transactions', 'Fraud', 'Audit Matters', 'Control Breaches', 'Regulator Issues'];
const DEFAULT_SHAREHOLDERS_HEADINGS_CFG = ['Dividends Declared', 'Share Issues and Buybacks', 'Director Appointments', 'Approval of Financial Statements', 'Related Party Matters', 'Auditor Appointment', 'Significant Resolutions'];
const DEFAULT_OVERALL_SUMMARY_HEADINGS = ['Impacts Financial Statements', 'Impacts Going Concern', 'Impacts Profitability', 'Indicated Significant Decision'];

function CommunicationHeadingsSection({ firmId, onSave }: { firmId: string; onSave: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [boardHeadings, setBoardHeadings] = useState<string[]>(DEFAULT_BOARD_HEADINGS);
  const [tcwgHeadings, setTcwgHeadings] = useState<string[]>(DEFAULT_TCWG_HEADINGS_CFG);
  const [shareholdersHeadings, setShareholdersHeadings] = useState<string[]>(DEFAULT_SHAREHOLDERS_HEADINGS_CFG);
  const [overallHeadings, setOverallHeadings] = useState<string[]>(DEFAULT_OVERALL_SUMMARY_HEADINGS);
  const [newBoardHeading, setNewBoardHeading] = useState('');
  const [newTcwgHeading, setNewTcwgHeading] = useState('');
  const [newShareholdersHeading, setNewShareholdersHeading] = useState('');
  const [newOverallHeading, setNewOverallHeading] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (loaded) return;
    try {
      const res = await fetch('/api/methodology-admin/communication-headings');
      if (res.ok) {
        const d = await res.json();
        if (Array.isArray(d.boardMinutesHeadings) && d.boardMinutesHeadings.length > 0) setBoardHeadings(d.boardMinutesHeadings);
        if (Array.isArray(d.tcwgHeadings) && d.tcwgHeadings.length > 0) setTcwgHeadings(d.tcwgHeadings);
        if (Array.isArray(d.shareholdersHeadings) && d.shareholdersHeadings.length > 0) setShareholdersHeadings(d.shareholdersHeadings);
        if (Array.isArray(d.overallSummaryHeadings) && d.overallSummaryHeadings.length > 0) setOverallHeadings(d.overallSummaryHeadings);
      }
    } catch {}
    setLoaded(true);
  }, [loaded]);

  async function handleSave() {
    setSaving(true);
    try {
      await fetch('/api/methodology-admin/communication-headings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boardMinutesHeadings: boardHeadings,
          tcwgHeadings,
          shareholdersHeadings,
          overallSummaryHeadings: overallHeadings,
        }),
      });
      onSave();
    } finally { setSaving(false); }
  }

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => { setExpanded(!expanded); if (!expanded) load(); }}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <h2 className="text-sm font-semibold text-slate-800">Communication Headings (Board Minutes, TCWG, Shareholders &amp; Overall Summary)</h2>
        {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>
      {expanded && (
        <div className="p-4 space-y-5">
          {/* Board Minutes Headings */}
          <div>
            <h3 className="text-sm font-medium text-slate-700 mb-2">Board Minutes Headings</h3>
            <p className="text-[10px] text-slate-400 mb-2">AI will extract content from uploaded board minutes under these headings</p>
            <div className="border rounded-lg divide-y">
              {boardHeadings.map((h, i) => (
                <div key={i} className="grid grid-cols-[1fr,40px] gap-2 px-3 py-1.5 items-center">
                  <input type="text" value={h} onChange={e => {
                    const next = [...boardHeadings];
                    next[i] = e.target.value;
                    setBoardHeadings(next);
                  }} className="border rounded px-2 py-1 text-sm" />
                  <button onClick={() => setBoardHeadings(boardHeadings.filter((_, j) => j !== i))}
                    className="text-red-400 hover:text-red-600 text-center"><X className="h-3.5 w-3.5 mx-auto" /></button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input type="text" value={newBoardHeading} onChange={e => setNewBoardHeading(e.target.value)}
                placeholder="New heading..." className="border rounded px-2 py-1 text-sm flex-1"
                onKeyDown={e => { if (e.key === 'Enter' && newBoardHeading.trim()) { setBoardHeadings([...boardHeadings, newBoardHeading.trim()]); setNewBoardHeading(''); } }} />
              <button onClick={() => { if (newBoardHeading.trim()) { setBoardHeadings([...boardHeadings, newBoardHeading.trim()]); setNewBoardHeading(''); } }}
                className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 font-medium">+ Add</button>
            </div>
          </div>

          {/* TCWG Headings */}
          <div>
            <h3 className="text-sm font-medium text-slate-700 mb-2">Audit Committee / TCWG Headings</h3>
            <p className="text-[10px] text-slate-400 mb-2">AI will extract content from uploaded TCWG minutes under these headings</p>
            <div className="border rounded-lg divide-y">
              {tcwgHeadings.map((h, i) => (
                <div key={i} className="grid grid-cols-[1fr,40px] gap-2 px-3 py-1.5 items-center">
                  <input type="text" value={h} onChange={e => {
                    const next = [...tcwgHeadings];
                    next[i] = e.target.value;
                    setTcwgHeadings(next);
                  }} className="border rounded px-2 py-1 text-sm" />
                  <button onClick={() => setTcwgHeadings(tcwgHeadings.filter((_, j) => j !== i))}
                    className="text-red-400 hover:text-red-600 text-center"><X className="h-3.5 w-3.5 mx-auto" /></button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input type="text" value={newTcwgHeading} onChange={e => setNewTcwgHeading(e.target.value)}
                placeholder="New heading..." className="border rounded px-2 py-1 text-sm flex-1"
                onKeyDown={e => { if (e.key === 'Enter' && newTcwgHeading.trim()) { setTcwgHeadings([...tcwgHeadings, newTcwgHeading.trim()]); setNewTcwgHeading(''); } }} />
              <button onClick={() => { if (newTcwgHeading.trim()) { setTcwgHeadings([...tcwgHeadings, newTcwgHeading.trim()]); setNewTcwgHeading(''); } }}
                className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 font-medium">+ Add</button>
            </div>
          </div>

          {/* Shareholders Headings */}
          <div>
            <h3 className="text-sm font-medium text-slate-700 mb-2">Shareholder Meetings Headings</h3>
            <p className="text-[10px] text-slate-400 mb-2">AI will extract content from uploaded shareholder meeting minutes under these headings</p>
            <div className="border rounded-lg divide-y">
              {shareholdersHeadings.map((h, i) => (
                <div key={i} className="grid grid-cols-[1fr,40px] gap-2 px-3 py-1.5 items-center">
                  <input type="text" value={h} onChange={e => {
                    const next = [...shareholdersHeadings];
                    next[i] = e.target.value;
                    setShareholdersHeadings(next);
                  }} className="border rounded px-2 py-1 text-sm" />
                  <button onClick={() => setShareholdersHeadings(shareholdersHeadings.filter((_, j) => j !== i))}
                    className="text-red-400 hover:text-red-600 text-center"><X className="h-3.5 w-3.5 mx-auto" /></button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input type="text" value={newShareholdersHeading} onChange={e => setNewShareholdersHeading(e.target.value)}
                placeholder="New heading..." className="border rounded px-2 py-1 text-sm flex-1"
                onKeyDown={e => { if (e.key === 'Enter' && newShareholdersHeading.trim()) { setShareholdersHeadings([...shareholdersHeadings, newShareholdersHeading.trim()]); setNewShareholdersHeading(''); } }} />
              <button onClick={() => { if (newShareholdersHeading.trim()) { setShareholdersHeadings([...shareholdersHeadings, newShareholdersHeading.trim()]); setNewShareholdersHeading(''); } }}
                className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 font-medium">+ Add</button>
            </div>
          </div>

          {/* Overall Communication Summary Headings */}
          <div>
            <h3 className="text-sm font-medium text-slate-700 mb-2">Summary of Communication Headings</h3>
            <p className="text-[10px] text-slate-400 mb-2">
              Headings used by the Communications <em>Overall</em> sub-tab. For each one, the AI produces a
              consolidated position drawn from every board/TCWG/shareholder/client/internal/expert meeting on
              the engagement. Seeded with four defaults — edit, re-order, or replace as your firm needs.
            </p>
            <div className="border rounded-lg divide-y">
              {overallHeadings.map((h, i) => (
                <div key={i} className="grid grid-cols-[1fr,40px] gap-2 px-3 py-1.5 items-center">
                  <input type="text" value={h} onChange={e => {
                    const next = [...overallHeadings];
                    next[i] = e.target.value;
                    setOverallHeadings(next);
                  }} className="border rounded px-2 py-1 text-sm" />
                  <button onClick={() => setOverallHeadings(overallHeadings.filter((_, j) => j !== i))}
                    className="text-red-400 hover:text-red-600 text-center"><X className="h-3.5 w-3.5 mx-auto" /></button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input type="text" value={newOverallHeading} onChange={e => setNewOverallHeading(e.target.value)}
                placeholder="New heading..." className="border rounded px-2 py-1 text-sm flex-1"
                onKeyDown={e => { if (e.key === 'Enter' && newOverallHeading.trim()) { setOverallHeadings([...overallHeadings, newOverallHeading.trim()]); setNewOverallHeading(''); } }} />
              <button onClick={() => { if (newOverallHeading.trim()) { setOverallHeadings([...overallHeadings, newOverallHeading.trim()]); setNewOverallHeading(''); } }}
                className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 font-medium">+ Add</button>
            </div>
          </div>

          <Button onClick={handleSave} size="sm" disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            Save Communication Headings
          </Button>
        </div>
      )}
    </div>
  );
}
