'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAutoSave } from '@/hooks/useAutoSave';
import { calculateFeePerHour } from '@/lib/formula-engine';

interface Props {
  engagementId: string;
}

type FormValues = Record<string, string | number | boolean | null>;

const ENTITY_TYPES = ['Limited Company', 'PIE', 'Charity'] as const;
const CONTINUITY_TYPES = ['First Year of Audit', 'Our First Year of Audit', 'Existing Client from prior period'] as const;
const CONTROL_ENV = ['Functioning as designed', 'Partially Functioning as Designed', 'Not Functioning as Designed'] as const;
const COMPETENCE_OPTIONS = ['Assessed as Competent', 'Assessed as Not Competent', 'Not Assessed'] as const;
const FEE_COMMENT_TYPES = ['Agreed fixed fee', 'Agreed time & materials', 'PY + Inflation', 'PY', 'Other'] as const;
const FEE_REASONABLE_OPTIONS = ['Fee is considered reasonable', 'Fee is not reasonable'] as const;

const SERVICE_ROWS = [
  'Audit', 'Corporation Tax', 'Advisory / Valuation Services', 'Internal Audit',
  'Other Assurance', 'Payroll', 'VAT / Bookkeeping', 'Recruitment, Legal & Litigation and IT Services',
] as const;

const STAFFING_LEVELS = [
  'Partner/RI', 'Senior Manager', 'Manager', 'Assistant Manager',
  'Senior', 'Semi-Senior/Snr. Associate', 'Junior',
] as const;

const AML_QUESTIONS = [
  'Has the client changed professional advisers frequently or had a service they requested turned down by another adviser without good reason?',
  'Is the client willing to pay over the odds in fees for the current year without good reason?',
  'Has the client moved/started operations in a geographical area of high risk?',
  'Are we aware that the client has entered into transactions that are complex and unusually large?',
  'Did the client open multiple foreign bank accounts with no good reason during the year?',
  'Changes in corporate structure of the client made it excessively complex during the year?',
  'Is the client unduly secretive or uncooperative based on our prior year experience?',
  'Have there been any adverse media reports in connection with the client?',
  'Is the client, or has the client previously been, the subject of any asset freeze or on any terrorist list?',
  'Is the client potentially involved in illegal activities?',
  'Did we receive payments from unknown or unassociated third parties in the prior year?',
  'Have any of the documents or information supplied to us been found to be false or stolen?',
  'Is there any change in status - client or beneficial owner become a PEP?',
  'Has the client been in any way obstructive or evasive when asked for information?',
  'Are there any other factors that present a higher risk of money laundering or terrorist financing?',
] as const;

const NATURE_ASSIGNMENT_QS = [
  'Is there anything unusual regarding the services requested or the purpose of the business relationship?',
  'Has the client required us to provide services of nominee directors / shareholders / shadow directors?',
  'Is there any reason to believe that the services or products requested lend themselves to money laundering?',
  'Did the client request us to handle client money in the year?',
  'Are we planning to provide investment, trust or company services for this client?',
] as const;

const ORG_ENV_QS = [
  'Is there any change in operations involving countries where drugs, trafficking, corruption or terrorism may be prevalent?',
  'Is the organisation subject to sanctions during the year?',
  'Do we know if money moved about between different accounts without apparent reason?',
  'Did the client start making use of bitcoin or similar digital currencies?',
  'Is there any funding in the current year that lacks logical explanation?',
  'Did the entity become a cash intensive organisation in the year?',
  'Did the entity start dealing in any business identified by the UK NRA as being used for laundering money?',
] as const;

const FRAUD_QS = [
  'Are there reasons to question the honesty and integrity of the management, directors and shareholders?',
  'Are we aware of any adverse relationships between the organisation and employees with access to assets?',
  'Are we aware of any history of fraud, theft or error within the organisation?',
  'Are supervisory controls over the organisation lacking?',
  'Are there inadequate internal controls over assets susceptible to misappropriation?',
  'Did we identify any disregard for the need for internal control over misappropriation of assets?',
  'Does available information indicate a significant number of non-routine or non-systematic transactions at period end?',
] as const;

const LAWS_QS = [
  'Is there any changes to laws and regulations central to the ability of the client to conduct operations?',
  'Is the client currently undergoing or anticipating an external investigation eg. by HMRC?',
  'Is there a known history of violations of laws and regulations or claims against the proposed client alleging fraud?',
] as const;

export function ContinuanceTab({ engagementId }: Props) {
  const [values, setValues] = useState<FormValues>({});
  const [loading, setLoading] = useState(true);
  const [initialValues, setInitialValues] = useState<FormValues>({});

  const { saving, lastSaved, error } = useAutoSave(
    `/api/engagements/${engagementId}/continuance`,
    { data: values },
    { enabled: JSON.stringify(values) !== JSON.stringify(initialValues) }
  );

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/continuance`);
      if (res.ok) { const json = await res.json(); const d = (json.data || {}) as FormValues; setValues(d); setInitialValues(d); }
    } catch (err) { console.error('Failed to load:', err); }
    finally { setLoading(false); }
  }, [engagementId]);

  useEffect(() => { loadData(); }, [loadData]);

  function v(key: string) { return values[key] ?? ''; }
  function set(key: string, val: string | number | boolean | null) { setValues(prev => ({ ...prev, [key]: val })); }

  // Computed: conditional text based on continuity type
  const continuityText = useMemo(() => {
    const ct = values.continuity_type as string;
    if (ct === 'First Year of Audit') return 'As this is the first year of audit for the Entity, there are no prior year management letter points to report.';
    if (ct === 'Our First Year of Audit') return 'As this is our first year of audit for the Entity, we will review the previous auditor\'s management letter points from the prior year.';
    return 'We will review any prior year management letter points.';
  }, [values.continuity_type]);

  const controlText = useMemo(() => {
    const ce = values.control_env as string;
    if (ce === 'Functioning as designed') return 'Based on our discussions with management, we observed that the Entity\'s internal control environment is functioning as designed.';
    if (ce === 'Partially Functioning as Designed') return 'Based on our discussions with management, we observed that the Entity\'s internal control environment is partially functioning as designed.';
    return 'Based on our discussions with management, we observed that the Entity\'s internal control environment is not functioning as designed.';
  }, [values.control_env]);

  // Fee calculations
  const pyFeeTotal = useMemo(() => SERVICE_ROWS.reduce((s, r) => s + (Number(values[`py_fee_${r}`]) || 0), 0), [values]);
  const pyHoursTotal = useMemo(() => SERVICE_ROWS.reduce((s, r) => s + (Number(values[`py_hours_${r}`]) || 0), 0), [values]);
  const cyFeeTotal = useMemo(() => SERVICE_ROWS.reduce((s, r) => s + (Number(values[`cy_fee_${r}`]) || 0), 0), [values]);
  const cyHoursTotal = useMemo(() => SERVICE_ROWS.reduce((s, r) => s + (Number(values[`cy_hours_${r}`]) || 0), 0), [values]);
  const staffTotal = useMemo(() => STAFFING_LEVELS.reduce((s, r) => s + (Number(values[`staff_${r}`]) || 0), 0), [values]);

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading Continuance...</div>;

  const inputCls = 'w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400';
  const selectCls = `${inputCls} bg-white`;
  const numCls = 'w-24 border border-slate-200 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-300';

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-slate-800">Continuance (Appendix C)</h2>
        <div className="flex items-center gap-2 text-xs">
          {saving && <span className="text-blue-500 animate-pulse">Saving...</span>}
          {lastSaved && !saving && <span className="text-green-500">Saved</span>}
          {error && <span className="text-red-500">{error}</span>}
        </div>
      </div>

      {/* Entity Details */}
      <Section title="Entity Details">
        <Row label="What type of audit client">
          <select value={v('entity_type') as string} onChange={e => set('entity_type', e.target.value)} className={selectCls}>
            <option value="">Select...</option>
            {ENTITY_TYPES.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </Row>
        <Row label="Is the client listed?">
          <select value={v('is_listed') as string} onChange={e => set('is_listed', e.target.value)} className={selectCls}>
            <option value="">Select...</option>
            {ENTITY_TYPES.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </Row>
      </Section>

      {/* Ownership */}
      <Section title="Ownership Information">
        {['Discuss with management to assess if shareholders with more than 25% shareholding has changed during the year?',
          'Discuss with management to assess if there is any change Ultimate Beneficial Owners (UBO) during the year?',
          'For change in the shareholders (>25%) and UBO, did the audit team update the AML procedures?',
        ].map(q => (
          <Row key={q} label={q}>
            <select value={v(`own_${q.slice(0, 30)}`) as string} onChange={e => set(`own_${q.slice(0, 30)}`, e.target.value)} className={selectCls}>
              <option value="">-</option><option value="Y">Y</option><option value="N">N</option>
            </select>
          </Row>
        ))}
      </Section>

      {/* Continuity */}
      <Section title="Continuity">
        <Row label="Prior Year Management Letter Points">
          <select value={v('continuity_type') as string} onChange={e => set('continuity_type', e.target.value)} className={selectCls}>
            <option value="">Select...</option>
            {CONTINUITY_TYPES.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </Row>
        {continuityText && (
          <div className="px-4 py-2 bg-blue-50/30 text-xs text-blue-700 italic">{continuityText}</div>
        )}
        <Row label="Internal control environment">
          <select value={v('control_env') as string} onChange={e => set('control_env', e.target.value)} className={selectCls}>
            <option value="">Select...</option>
            {CONTROL_ENV.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </Row>
        {controlText && (
          <div className="px-4 py-2 bg-blue-50/30 text-xs text-blue-700 italic">{controlText}</div>
        )}
        <Row label="Engagement Letter Signed Date">
          <input type="date" value={(v('engagement_letter_date') as string)?.split('T')[0] || ''} onChange={e => set('engagement_letter_date', e.target.value)} className={inputCls} />
        </Row>
      </Section>

      {/* Management Info */}
      <Section title="Management Information">
        <YNRow label="Discuss with management to assess if there is any changes in directors/trustees during the year?" k="mgmt_directors_change" v={v} set={set} cls={selectCls} />
        <YNRow label="Are there any concerns over the skills and integrity of the owners, directors and management?" k="mgmt_concerns" v={v} set={set} cls={selectCls} />
        <Row label="Assess management's skills and competence in relation to new directors">
          <select value={v('mgmt_competence') as string} onChange={e => set('mgmt_competence', e.target.value)} className={selectCls}>
            <option value="">Select...</option>
            {COMPETENCE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </Row>
      </Section>

      {/* Nature of Business */}
      <Section title="Nature of Business">
        {['Is there any change in the principal activities of the entity during the year?',
          'Is there any change in the group structure of the entity?',
          'Has the entity established new subsidiaries in any of the non-co-operating countries?',
          'Is there any change in sources of funding in the year?',
        ].map(q => <YNRow key={q} label={q} k={`biz_${q.slice(0, 25)}`} v={v} set={set} cls={selectCls} />)}
        <Row label="Results of company search on Google and websites such as Companies House">
          <textarea value={v('biz_search_results') as string || ''} onChange={e => set('biz_search_results', e.target.value)} className={`${inputCls} min-h-[60px]`} />
        </Row>
      </Section>

      {/* Fee Considerations - Prior Year */}
      <Section title="Fee Considerations">
        <div className="px-4 py-2"><span className="text-xs font-semibold text-slate-600">Prior Year</span></div>
        <table className="w-full text-xs">
          <thead><tr className="border-b border-slate-200 bg-slate-50/50">
            <th className="px-3 py-1 text-left text-slate-500 font-medium">Service</th>
            <th className="px-3 py-1 text-right text-slate-500 font-medium w-24">Fee (£)</th>
            <th className="px-3 py-1 text-right text-slate-500 font-medium w-24">Hours</th>
            <th className="px-3 py-1 text-right text-slate-500 font-medium w-24">Fee/hour</th>
            <th className="px-3 py-1 text-left text-slate-500 font-medium w-48">Details</th>
          </tr></thead>
          <tbody>
            {SERVICE_ROWS.map(row => {
              const fee = Number(values[`py_fee_${row}`]) || 0;
              const hours = Number(values[`py_hours_${row}`]) || 0;
              const fph = calculateFeePerHour(fee, hours);
              return (
                <tr key={row} className="border-b border-slate-100">
                  <td className="px-3 py-1 text-slate-700">{row}</td>
                  <td className="px-3 py-1"><input type="number" value={fee || ''} onChange={e => set(`py_fee_${row}`, Number(e.target.value) || null)} className={numCls} min={0} /></td>
                  <td className="px-3 py-1"><input type="number" value={hours || ''} onChange={e => set(`py_hours_${row}`, Number(e.target.value) || null)} className={numCls} min={0} step="0.5" /></td>
                  <td className="px-3 py-1 text-right text-slate-500">{fph !== null ? fph.toFixed(2) : ''}</td>
                  <td className="px-3 py-1"><input type="text" value={(v(`py_detail_${row}`) as string) || ''} onChange={e => set(`py_detail_${row}`, e.target.value)} className="w-full border border-slate-200 rounded px-1 py-0.5 text-xs" /></td>
                </tr>
              );
            })}
            <tr className="bg-slate-50 font-medium">
              <td className="px-3 py-1">Total</td>
              <td className="px-3 py-1 text-right">{pyFeeTotal > 0 ? pyFeeTotal.toLocaleString() : ''}</td>
              <td className="px-3 py-1 text-right">{pyHoursTotal > 0 ? pyHoursTotal.toFixed(1) : ''}</td>
              <td className="px-3 py-1 text-right text-slate-500">{calculateFeePerHour(pyFeeTotal, pyHoursTotal)?.toFixed(2) || ''}</td>
              <td></td>
            </tr>
          </tbody>
        </table>

        {/* Current Year */}
        <div className="px-4 py-2 mt-4"><span className="text-xs font-semibold text-slate-600">Current Year</span></div>
        <table className="w-full text-xs">
          <thead><tr className="border-b border-slate-200 bg-slate-50/50">
            <th className="px-3 py-1 text-left text-slate-500 font-medium">Service</th>
            <th className="px-3 py-1 text-right text-slate-500 font-medium w-24">Fee (£)</th>
            <th className="px-3 py-1 text-right text-slate-500 font-medium w-24">Hours</th>
            <th className="px-3 py-1 text-right text-slate-500 font-medium w-24">Fee/hour</th>
            <th className="px-3 py-1 text-left text-slate-500 font-medium w-32">Comments</th>
            <th className="px-3 py-1 text-left text-slate-500 font-medium w-32">Reasonableness</th>
          </tr></thead>
          <tbody>
            {SERVICE_ROWS.map(row => {
              const fee = Number(values[`cy_fee_${row}`]) || 0;
              const hours = Number(values[`cy_hours_${row}`]) || 0;
              const fph = calculateFeePerHour(fee, hours);
              return (
                <tr key={row} className="border-b border-slate-100">
                  <td className="px-3 py-1 text-slate-700">{row}</td>
                  <td className="px-3 py-1"><input type="number" value={fee || ''} onChange={e => set(`cy_fee_${row}`, Number(e.target.value) || null)} className={numCls} min={0} /></td>
                  <td className="px-3 py-1"><input type="number" value={hours || ''} onChange={e => set(`cy_hours_${row}`, Number(e.target.value) || null)} className={numCls} min={0} step="0.5" /></td>
                  <td className="px-3 py-1 text-right text-slate-500">{fph !== null ? fph.toFixed(2) : ''}</td>
                  <td className="px-3 py-1">
                    <select value={(v(`cy_comment_type_${row}`) as string) || ''} onChange={e => set(`cy_comment_type_${row}`, e.target.value)} className="border border-slate-200 rounded px-1 py-0.5 text-xs bg-white w-full">
                      <option value="">-</option>
                      {FEE_COMMENT_TYPES.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-1">
                    <select value={(v(`cy_reasonable_${row}`) as string) || ''} onChange={e => set(`cy_reasonable_${row}`, e.target.value)} className="border border-slate-200 rounded px-1 py-0.5 text-xs bg-white w-full">
                      <option value="">-</option>
                      {FEE_REASONABLE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
            <tr className="bg-slate-50 font-medium">
              <td className="px-3 py-1">Total</td>
              <td className="px-3 py-1 text-right">{cyFeeTotal > 0 ? cyFeeTotal.toLocaleString() : ''}</td>
              <td className="px-3 py-1 text-right">{cyHoursTotal > 0 ? cyHoursTotal.toFixed(1) : ''}</td>
              <td className="px-3 py-1 text-right text-slate-500">{calculateFeePerHour(cyFeeTotal, cyHoursTotal)?.toFixed(2) || ''}</td>
              <td colSpan={2}></td>
            </tr>
          </tbody>
        </table>

        <YNRow label="Is the proposed audit fee sufficient to deliver a high-quality audit?" k="fee_sufficient" v={v} set={set} cls={selectCls} />
        <YNRow label="Is the audit or any other professional work being undertaken on a contingent fee basis?" k="fee_contingent" v={v} set={set} cls={selectCls} />
      </Section>

      {/* Resourcing */}
      <Section title="Reassess Resourcing Considerations">
        <Row label="Prior year hours budget vs actual analysis">
          <textarea value={(v('resourcing_py_analysis') as string) || ''} onChange={e => set('resourcing_py_analysis', e.target.value)} className={`${inputCls} min-h-[60px]`} />
        </Row>
        <div className="px-4 py-2"><span className="text-xs font-medium text-slate-600">Forecast hours by level:</span></div>
        <div className="px-4 grid grid-cols-4 gap-2 pb-2">
          {STAFFING_LEVELS.map(level => (
            <div key={level} className="flex items-center gap-2">
              <span className="text-xs text-slate-600 w-32 truncate">{level}</span>
              <input type="number" value={Number(v(`staff_${level}`)) || ''} onChange={e => set(`staff_${level}`, Number(e.target.value) || null)} className={numCls} min={0} step="0.5" />
            </div>
          ))}
          <div className="flex items-center gap-2 font-medium">
            <span className="text-xs text-slate-800 w-32">Total</span>
            <span className="text-xs text-slate-800">{staffTotal > 0 ? staffTotal.toFixed(1) : ''}</span>
          </div>
        </div>
      </Section>

      {/* EQR */}
      <Section title="EQR Considerations">
        <YNRow label="EQR on this engagement" k="eqr_required" v={v} set={set} cls={selectCls} />
        {values.is_listed === 'PIE' && <div className="px-4 py-1 text-xs text-red-600 font-medium">THIS IS NECESSARY AS IT IS A LISTED CLIENT.</div>}
        <Row label="Any points relevant for RI consideration based on working with EQR in prior year audit?">
          <textarea value={(v('eqr_points') as string) || ''} onChange={e => set('eqr_points', e.target.value)} className={`${inputCls} min-h-[40px]`} />
        </Row>
      </Section>

      {/* AML */}
      <Section title="Review AML Considerations">
        {AML_QUESTIONS.map((q, i) => <YNRow key={i} label={q} k={`aml_${i}`} v={v} set={set} cls={selectCls} />)}
      </Section>

      <Section title="Nature of Assignment">
        {NATURE_ASSIGNMENT_QS.map((q, i) => <YNRow key={i} label={q} k={`assign_${i}`} v={v} set={set} cls={selectCls} />)}
      </Section>

      <Section title="Organisation Environment">
        {ORG_ENV_QS.map((q, i) => <YNRow key={i} label={q} k={`org_${i}`} v={v} set={set} cls={selectCls} />)}
      </Section>

      <Section title="Risk of Fraud, Theft and Error">
        {FRAUD_QS.map((q, i) => <YNRow key={i} label={q} k={`fraud_${i}`} v={v} set={set} cls={selectCls} />)}
      </Section>

      <Section title="Laws and Regulations">
        {LAWS_QS.map((q, i) => <YNRow key={i} label={q} k={`laws_${i}`} v={v} set={set} cls={selectCls} />)}
      </Section>

      {/* Discussion with MLRO */}
      <Section title="Discussion with MLRO">
        <YNRow label="Is this a higher AML risk" k="mlro_higher_risk" v={v} set={set} cls={selectCls} />
        <Row label="Summarise discussion with MLRO">
          <textarea value={(v('mlro_summary') as string) || ''} onChange={e => set('mlro_summary', e.target.value)} className={`${inputCls} min-h-[80px]`} />
        </Row>
        <YNRow label="Did MLRO consent to accepting engagement" k="mlro_consent" v={v} set={set} cls={selectCls} />
      </Section>

      {/* Discussion with Partner/RI */}
      <Section title="Discussion with Audit Partner/RI">
        <Row label="Summarise discussion with Audit Partner/RI">
          <textarea value={(v('partner_summary') as string) || ''} onChange={e => set('partner_summary', e.target.value)} className={`${inputCls} min-h-[80px]`} />
        </Row>
        <YNRow label="Did Audit Partner/RI consent to accepting engagement" k="partner_consent" v={v} set={set} cls={selectCls} />
      </Section>

      {/* Final Conclusion */}
      <Section title="FINAL CONCLUSION">
        <Row label="Final conclusion on continuance">
          <textarea value={(v('final_conclusion') as string) || ''} onChange={e => set('final_conclusion', e.target.value)} className={`${inputCls} min-h-[80px]`} />
        </Row>
      </Section>
    </div>
  );
}

// Helper components
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 border border-slate-200 rounded-lg overflow-hidden">
      <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      </div>
      <div className="divide-y divide-slate-100">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-2 flex gap-4 items-start hover:bg-slate-50/30">
      <span className="text-xs text-slate-700 flex-1 pt-1">{label}</span>
      <div className="w-1/2 flex-shrink-0">{children}</div>
    </div>
  );
}

function YNRow({ label, k, v, set, cls }: { label: string; k: string; v: (k: string) => string | number | boolean | null; set: (k: string, val: string) => void; cls: string }) {
  return (
    <Row label={label}>
      <select value={v(k) as string || ''} onChange={e => set(k, e.target.value)} className={cls}>
        <option value="">-</option><option value="Y">Y</option><option value="N">N</option>
      </select>
    </Row>
  );
}
