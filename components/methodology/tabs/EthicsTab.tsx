'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAutoSave } from '@/hooks/useAutoSave';

interface Props {
  engagementId: string;
}

type FormValues = Record<string, string | number | boolean | null>;

// Section structure matching Appendix B from Templates.xlsx
const ETHICS_SECTIONS = [
  {
    key: 'non_audit_services',
    label: 'Non Audit Services',
    rows: [
      'Preparation of accounts', 'Corporation Tax', 'Advisory / Valuation Services',
      'Internal Audit', 'Other Assurance', 'Payroll', 'VAT / Bookkeeping',
      'Recruitment, Legal & Litigation and IT Services',
    ],
    hasIssueAndSafeguard: true,
  },
  {
    key: 'threats',
    label: 'Threats',
    rows: [
      'Familiarity Threat of Audit Team', 'Self Interest Threat', 'Self-Review Threat',
      'Advocacy Threat', 'Management Threat', 'Intimidation Threat',
    ],
    hasIssueAndSafeguard: true,
  },
  {
    key: 'relationships',
    label: 'Relationships',
    rows: [
      'Financial relationship', 'Business relationship',
      'Employment relationship', 'Personal relationship',
    ],
    hasIssueAndSafeguard: true,
  },
  {
    key: 'other_considerations',
    label: 'Other Considerations',
    rows: [
      'Litigation Threat', 'Gifts & Hospitality Threat', 'Remuneration of Audit team',
    ],
    hasIssueAndSafeguard: true,
  },
] as const;

const FEE_INPUT_ROWS = [
  'Audit Fee', 'Non-Audit Fee', 'Total Fees',
  'Overdue Fees from client',
] as const;

const FEE_COMPUTED_ROWS = [
  { label: '% of Non-Audit Fee to Audit Fee', numerator: 'Non-Audit Fee', denominator: 'Audit Fee' },
  { label: '% of Total Fees to Firm Fees', numerator: 'Total Fees', denominator: '__firm_fees' },
] as const;

const ORITP_SECTIONS = [
  {
    key: 'objective',
    label: 'Objective',
    rows: [
      'Are any audit team members involved in bookkeeping or tax work?',
      'Does the audit team rely solely on non-audit outputs?',
      'Any personal/financial interests in the client?',
      'Has professional skepticism been maintained?',
      'Is audit judgment free from management influence?',
    ],
    conclusion: {
      options: [
        'Threats mitigated. Audit team remains unbiased',
        'Threats not fully mitigated. Audit team could be seen to be biased',
      ],
    },
  },
  {
    key: 'reasonable',
    label: 'Reasonable',
    rows: [
      'Are safeguards proportionate?',
      'Are non-audit fees reasonable relative to audit fees?',
      'Is segregation of audit and non-audit services evidenced?',
      'Do services comply with ethical standards?',
      'Have the Directors been informed?',
    ],
    conclusion: {
      options: [
        'A prudent auditor would consider safeguards adequate.',
        'A prudent auditor would be sceptical that safeguards adequate.',
      ],
    },
  },
  {
    key: 'informed_third_party',
    label: 'Informed Third Party',
    rows: [
      'Would an informed third party perceive independence as compromised?',
      'Could stakeholders believe the firm is auditing its own work?',
      'Would disclosure of non-audit services appear excessive?',
      'Is there transparency in safeguards?',
      'Could a regulator challenge the sufficiency of safeguards?',
    ],
    conclusion: {
      options: [
        'An informed outsider would conclude independence is preserved.',
        'An informed outsider would conclude independence is jeopardised.',
      ],
    },
  },
];

export function EthicsTab({ engagementId }: Props) {
  const [values, setValues] = useState<FormValues>({});
  const [loading, setLoading] = useState(true);
  const [initialValues, setInitialValues] = useState<FormValues>({});

  const { saving, lastSaved, error } = useAutoSave(
    `/api/engagements/${engagementId}/ethics`,
    { data: values },
    { enabled: JSON.stringify(values) !== JSON.stringify(initialValues) }
  );

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/ethics`);
      if (res.ok) {
        const json = await res.json();
        const data = (json.data || {}) as FormValues;
        setValues(data);
        setInitialValues(data);
      }
    } catch (err) {
      console.error('Failed to load ethics:', err);
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => { loadData(); }, [loadData]);

  function setValue(key: string, value: string | number | boolean | null) {
    setValues(prev => ({ ...prev, [key]: value }));
  }

  if (loading) {
    return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading Ethics...</div>;
  }

  const fieldKey = (section: string, row: string, col: string) => `${section}__${row.replace(/\s+/g, '_')}__${col}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-slate-800">Ethics</h2>
        <div className="flex items-center gap-2 text-xs">
          {saving && <span className="text-blue-500 animate-pulse">Saving...</span>}
          {lastSaved && !saving && <span className="text-green-500">Saved</span>}
          {error && <span className="text-red-500">{error}</span>}
        </div>
      </div>

      {/* Main threat/service sections - 4-column layout */}
      {ETHICS_SECTIONS.map(section => (
        <div key={section.key} className="mb-6 border border-slate-200 rounded-lg overflow-hidden">
          <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-700">{section.label}</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50">
                <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 w-1/4">Threat to objectivity</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 w-1/3">Detailed Comments</th>
                {section.hasIssueAndSafeguard && (
                  <>
                    <th className="text-center px-3 py-2 text-xs font-medium text-slate-500 w-16">Issue?</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 w-1/4">Safeguard Implemented</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {section.rows.map(row => {
                const commentKey = fieldKey(section.key, row, 'comment');
                const issueKey = fieldKey(section.key, row, 'issue');
                const safeguardKey = fieldKey(section.key, row, 'safeguard');
                return (
                  <tr key={row} className="border-b border-slate-100 hover:bg-slate-50/30">
                    <td className="px-3 py-2 text-xs text-slate-700">{row}</td>
                    <td className="px-3 py-1">
                      <textarea
                        value={(values[commentKey] as string) || ''}
                        onChange={e => setValue(commentKey, e.target.value)}
                        className="w-full border border-slate-200 rounded px-2 py-1 text-xs min-h-[32px] resize-y focus:outline-none focus:ring-1 focus:ring-blue-300"
                        rows={1}
                      />
                    </td>
                    {section.hasIssueAndSafeguard && (
                      <>
                        <td className="px-3 py-1 text-center">
                          <select
                            value={(values[issueKey] as string) || ''}
                            onChange={e => setValue(issueKey, e.target.value)}
                            className="border border-slate-200 rounded px-1 py-0.5 text-xs bg-white"
                          >
                            <option value="">-</option>
                            <option value="Y">Y</option>
                            <option value="N">N</option>
                          </select>
                        </td>
                        <td className="px-3 py-1">
                          <textarea
                            value={(values[safeguardKey] as string) || ''}
                            onChange={e => setValue(safeguardKey, e.target.value)}
                            className="w-full border border-slate-200 rounded px-2 py-1 text-xs min-h-[32px] resize-y focus:outline-none focus:ring-1 focus:ring-blue-300"
                            rows={1}
                          />
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {/* Fee Assessment */}
      <div className="mb-6 border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-700">Fee Assessment</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {/* Input rows */}
          {FEE_INPUT_ROWS.map(row => {
            const valKey = `fee__${row.replace(/\s+/g, '_')}__value`;
            const issueKey = `fee__${row.replace(/\s+/g, '_')}__issue`;
            return (
              <div key={row} className="px-4 py-2 flex items-center gap-4 hover:bg-slate-50/30">
                <span className="text-xs text-slate-700 flex-1">{row}</span>
                <input
                  type="number"
                  value={(values[valKey] as string) || ''}
                  onChange={e => setValue(valKey, e.target.value)}
                  className="w-32 border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
                  placeholder="£"
                />
                <select
                  value={(values[issueKey] as string) || ''}
                  onChange={e => setValue(issueKey, e.target.value)}
                  className="border border-slate-200 rounded px-1 py-0.5 text-xs bg-white w-12"
                >
                  <option value="">-</option>
                  <option value="Y">Y</option>
                  <option value="N">N</option>
                </select>
              </div>
            );
          })}
          {/* Firm Fees input (set by Methodology Admin, editable here for now) */}
          <div className="px-4 py-2 flex items-center gap-4 hover:bg-slate-50/30 bg-blue-50/30">
            <span className="text-xs text-slate-700 flex-1">Firm Fees <span className="text-[10px] text-slate-400">(set by Methodology Admin)</span></span>
            <input
              type="number"
              value={(values['fee__firm_fees__value'] as string) || ''}
              onChange={e => setValue('fee__firm_fees__value', e.target.value)}
              className="w-32 border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
              placeholder="£"
            />
            <div className="w-12" />
          </div>
          {/* Computed percentage rows */}
          {FEE_COMPUTED_ROWS.map(row => {
            const numKey = `fee__${row.numerator.replace(/\s+/g, '_')}__value`;
            const denKey = row.denominator === '__firm_fees' ? 'fee__firm_fees__value' : `fee__${row.denominator.replace(/\s+/g, '_')}__value`;
            const issueKey = `fee__${row.label.replace(/\s+/g, '_')}__issue`;
            const num = parseFloat((values[numKey] as string) || '0') || 0;
            const den = parseFloat((values[denKey] as string) || '0') || 0;
            const pct = den > 0 ? ((num / den) * 100).toFixed(1) : '—';
            return (
              <div key={row.label} className="px-4 py-2 flex items-center gap-4 hover:bg-slate-50/30 bg-yellow-50/30">
                <span className="text-xs text-slate-700 flex-1">{row.label}</span>
                <span className="w-32 text-xs font-medium text-slate-800 text-right px-2 py-1">
                  {pct === '—' ? '—' : `${pct}%`}
                </span>
                <select
                  value={(values[issueKey] as string) || ''}
                  onChange={e => setValue(issueKey, e.target.value)}
                  className="border border-slate-200 rounded px-1 py-0.5 text-xs bg-white w-12"
                >
                  <option value="">-</option>
                  <option value="Y">Y</option>
                  <option value="N">N</option>
                </select>
              </div>
            );
          })}
        </div>
      </div>

      {/* ORITP Sections */}
      <div className="mb-6 border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-700">ORITP Assessment</h3>
        </div>
        {ORITP_SECTIONS.map(section => (
          <div key={section.key} className="border-b border-slate-200 last:border-b-0">
            <div className="px-4 py-2 bg-slate-50/50">
              <span className="text-xs font-semibold text-slate-600">{section.label}</span>
            </div>
            <div className="divide-y divide-slate-100">
              {section.rows.map(row => {
                const key = `oritp__${section.key}__${row.replace(/\s+/g, '_')}`;
                return (
                  <div key={row} className="px-4 py-2 flex items-center gap-3 hover:bg-slate-50/30">
                    <span className="text-xs text-slate-700 flex-1">{row}</span>
                    <select
                      value={(values[key] as string) || ''}
                      onChange={e => setValue(key, e.target.value)}
                      className="border border-slate-200 rounded px-1 py-0.5 text-xs bg-white w-12"
                    >
                      <option value="">-</option>
                      <option value="Y">Y</option>
                      <option value="N">N</option>
                    </select>
                  </div>
                );
              })}
              {/* Conclusion dropdown */}
              <div className="px-4 py-2 bg-yellow-50/50 flex items-center gap-3">
                <span className="text-xs font-medium text-slate-700 flex-1">Conclusion</span>
                <select
                  value={(values[`oritp__${section.key}__conclusion`] as string) || ''}
                  onChange={e => setValue(`oritp__${section.key}__conclusion`, e.target.value)}
                  className="border border-slate-200 rounded px-2 py-1 text-xs bg-white flex-1 max-w-md"
                >
                  <option value="">Select conclusion...</option>
                  {section.conclusion.options.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
