/**
 * Bulk seeder for the 534-test draft test pack.
 *
 * Reads lib/test-data/draft-test-bank.csv (32 FS lines × many tests per line,
 * FRS102, marked Significant Risk in the source) and upserts one
 * MethodologyTest per CSV row for the target firm, with:
 *   - executionMode = 'action_pipeline'
 *   - isDraft = true (hidden from engagement plans until reviewed)
 *   - category = 'Significant Risk' (source CSV column)
 *   - framework = 'FRS102'
 *   - full step chain derived from the pattern classifier below, built from
 *     existing SYSTEM_ACTIONS plus the 18 new Actions seeded in action-seed.ts
 *
 * The classifier is a TS port of scripts/docs/test-specs/_gen.py — keep them
 * in sync if you tweak patterns.
 *
 * Usage from the Methodology Admin seed endpoint:
 *   import { seedBulkDraftTests } from '@/lib/bulk-draft-test-seed';
 *   await seedBulkDraftTests(firmId);
 */

import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/db';

// ─── CSV parsing ───────────────────────────────────────────────────────────

interface CsvRow {
  fsLine: string;
  description: string;
  type: string;
  assertion: string;
  significantRisk: string;
  framework: string;
}

function parseCsv(text: string): CsvRow[] {
  // Simple CSV with potential quoted fields containing commas/newlines.
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { cur.push(field); field = ''; }
      else if (ch === '\r') { /* skip */ }
      else if (ch === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
      else { field += ch; }
    }
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
  if (rows.length === 0) return [];
  const header = rows[0].map(h => h.trim());
  const idx = (name: string) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const i = {
    fs: idx('FS Line Item'),
    desc: idx('Test Description'),
    type: idx('Type'),
    assert: idx('Assertion'),
    sr: idx('Significant Risk'),
    fw: idx('Framework'),
  };
  return rows.slice(1)
    .filter(r => r.length && r.some(c => (c || '').trim().length))
    .map(r => ({
      fsLine: (r[i.fs] || '').trim(),
      description: (r[i.desc] || '').trim(),
      type: (r[i.type] || '').trim(),
      assertion: (r[i.assert] || '').trim(),
      significantRisk: (r[i.sr] || '').trim(),
      framework: (r[i.fw] || '').trim(),
    }));
}

// ─── Step chain builders (mirrors _gen.py) ─────────────────────────────────

interface StepSpec { actionCode: string; inputBindings: Record<string, any>; }

const stepsAnalyticalReview = (): StepSpec[] => [
  { actionCode: 'accounting_extract',           inputBindings: { data_type: 'journals' } },
  { actionCode: 'analytical_review_variance',   inputBindings: { fs_line: '$ctx.test.fsLine' } },
  { actionCode: 'request_gm_explanations',      inputBindings: { variances: '$prev.variances' } },
  { actionCode: 'assess_gm_explanations',       inputBindings: { variances: '$step.2.variances', explanations: '$prev.explanations' } },
  { actionCode: 'team_review',                  inputBindings: { instructions: 'Review variance investigation and conclude.' } },
];

const stepsListingRecon = (listingType: string): StepSpec[] => [
  { actionCode: 'request_listing', inputBindings: { listing_type: listingType, message_to_client: `Please provide the ${listingType.replace(/_/g, ' ')} as at period end, reconciled to the trial balance.` } },
  { actionCode: 'reconcile_to_tb', inputBindings: { data_table: '$prev.data_table' } },
  { actionCode: 'team_review',     inputBindings: { instructions: 'Review reconciliation and any unreconciled items.' } },
];

const stepsSampleInspect = (docType: string, assertion: string): StepSpec[] => [
  { actionCode: 'accounting_extract', inputBindings: { data_type: 'journals' } },
  { actionCode: 'select_sample',      inputBindings: { population: '$prev.data_table', sample_type: 'standard' } },
  { actionCode: 'request_documents',  inputBindings: { transactions: '$prev.sample_items', document_type: docType, message_to_client: `Please provide the supporting ${docType.replace(/_/g, ' ')}s for the sampled transactions.`, area_of_work: '$ctx.test.fsLine' } },
  { actionCode: 'verify_evidence',    inputBindings: { evidence_documents: '$prev.documents', sample_items: '$step.2.sample_items', assertions: [assertion] } },
  { actionCode: 'team_review',        inputBindings: { instructions: 'Conclude on assertion testing.' } },
];

const stepsCutoff = (): StepSpec[] => [
  { actionCode: 'accounting_extract', inputBindings: { data_type: 'journals' } },
  { actionCode: 'analyse_cut_off',    inputBindings: { data_table: '$prev.data_table', cut_off_days: 7 } },
  { actionCode: 'team_review',        inputBindings: { instructions: 'Review any cut-off exceptions.' } },
];

const stepsConfirmations = (confType: string): StepSpec[] => [
  { actionCode: 'accounting_extract',    inputBindings: { data_type: confType === 'bank' ? 'bank_transactions' : 'contacts' } },
  { actionCode: 'select_sample',         inputBindings: { population: '$prev.data_table', sample_type: 'standard' } },
  { actionCode: 'request_confirmations', inputBindings: { confirmation_type: confType, sample_items: '$prev.sample_items' } },
  { actionCode: 'verify_evidence',       inputBindings: { evidence_documents: '$prev.confirmations', assertions: ['existence', 'valuation'] } },
  { actionCode: 'team_review',           inputBindings: { instructions: 'Review confirmation exceptions / non-responses and alternative procedures.' } },
];

const stepsPhysical = (itemType: string): StepSpec[] => [
  { actionCode: 'request_listing',        inputBindings: { listing_type: itemType === 'ppe' ? 'far' : 'inventory', message_to_client: `Please provide the ${itemType === 'ppe' ? 'Fixed Asset Register' : 'inventory listing'} as at period end.` } },
  { actionCode: 'select_sample',          inputBindings: { population: '$prev.data_table', sample_type: 'standard' } },
  { actionCode: 'physical_verification',  inputBindings: { item_type: itemType, sample_items: '$prev.sample_items', count_date: '$ctx.engagement.periodEnd' } },
  { actionCode: 'team_review',            inputBindings: { instructions: 'Review physical-verification exceptions.' } },
];

const stepsDisclosureReview = (): StepSpec[] => [
  { actionCode: 'review_disclosures', inputBindings: { fs_line: '$ctx.test.fsLine', framework: '$ctx.engagement.framework' } },
  { actionCode: 'team_review',        inputBindings: { instructions: 'Review disclosure-checklist exceptions.' } },
];

const stepsRecalc = (policyType: string): StepSpec[] => [
  { actionCode: 'request_listing',      inputBindings: { listing_type: policyType.includes('depreciation') ? 'far' : 'other', message_to_client: 'Please provide the supporting schedule for the recalculation.' } },
  { actionCode: 'recalculate_balance',  inputBindings: { policy_type: policyType, inputs: '$prev.data_table' } },
  { actionCode: 'team_review',          inputBindings: { instructions: 'Review recalculation variances.' } },
];

const stepsSubsequent = (txType: string): StepSpec[] => [
  { actionCode: 'review_subsequent_activity', inputBindings: { transaction_type: txType, fs_line: '$ctx.test.fsLine', x_days_post_ye: 60 } },
  { actionCode: 'team_review',                inputBindings: { instructions: 'Review post-YE items affecting period-end balance.' } },
];

const stepsAiOnly = (prompt: string): StepSpec[] => [
  { actionCode: 'ai_analysis', inputBindings: { prompt_template: prompt, output_format: 'pass_fail' } },
  { actionCode: 'team_review', inputBindings: { instructions: 'Review AI assessment and conclude.' } },
];

const stepsPolicy = (): StepSpec[] => [
  { actionCode: 'analyse_accounting_policy', inputBindings: { framework: '$ctx.engagement.framework', fs_line: '$ctx.test.fsLine' } },
  { actionCode: 'team_review',               inputBindings: { instructions: 'Review policy-compliance findings.' } },
];

const stepsEstimates = (estimateType: string): StepSpec[] => [
  { actionCode: 'request_documents',  inputBindings: { document_type: 'other', message_to_client: 'Please provide the supporting schedule for the estimate.', area_of_work: '$ctx.test.fsLine' } },
  { actionCode: 'assess_estimates',   inputBindings: { estimate_type: estimateType, supporting_schedule: '$prev.documents' } },
  { actionCode: 'team_review',        inputBindings: { instructions: 'Review estimate assessment and challenge.' } },
];

const stepsContracts = (): StepSpec[] => [
  { actionCode: 'select_sample',      inputBindings: { sample_type: 'standard' } },
  { actionCode: 'request_documents',  inputBindings: { document_type: 'contract', message_to_client: 'Please provide the contracts / agreements for the selected items.', transactions: '$prev.sample_items' } },
  { actionCode: 'review_contracts',   inputBindings: { contract_sample: '$prev.documents' } },
  { actionCode: 'team_review',        inputBindings: { instructions: 'Review contract-terms alignment to recording.' } },
];

const stepsUrla = (): StepSpec[] => [
  { actionCode: 'request_documents',                     inputBindings: { document_type: 'bank_statement', message_to_client: 'Please provide bank statements covering the post-year-end window.', area_of_work: '$ctx.test.fsLine' } },
  { actionCode: 'extract_post_ye_bank_payments',         inputBindings: { source_documents: '$prev.documents' } },
  { actionCode: 'select_unrecorded_liabilities_sample',  inputBindings: { population: '$prev.data_table' } },
  { actionCode: 'request_documents',                     inputBindings: { document_type: 'invoice', message_to_client: 'Please provide the supporting invoices for the sampled payments.', transactions: '$prev.sample_items' } },
  { actionCode: 'extract_accruals_evidence',             inputBindings: { source_documents: '$prev.documents', sample_items: '$step.3.sample_items' } },
  { actionCode: 'verify_unrecorded_liabilities_sample',  inputBindings: { sample_items: '$step.3.sample_items', extracted_evidence: '$prev.extracted_evidence' } },
  { actionCode: 'team_review',                           inputBindings: { instructions: 'Review URLA markers; reds need adjustment or disclosure.' } },
];

const stepsBoardMinutes = (): StepSpec[] => [
  { actionCode: 'ai_analysis', inputBindings: { prompt_template: 'Scan board minutes and contracts for indications of unrecorded assets/liabilities for {{fs_line}}.', output_format: 'pass_fail' } },
  { actionCode: 'team_review', inputBindings: { instructions: 'Review AI findings from minutes.' } },
];

const stepsBankRecon = (): StepSpec[] => [
  { actionCode: 'request_documents',            inputBindings: { document_type: 'bank_statement', message_to_client: 'Please provide the bank statements and bank reconciliation at period end.', area_of_work: 'Cash and Cash equivalents' } },
  { actionCode: 'extract_bank_statements',      inputBindings: { source_files: '$prev.documents' } },
  { actionCode: 'bank_reconciliation_review',   inputBindings: { bank_statement: '$step.1.documents' } },
  { actionCode: 'team_review',                  inputBindings: { instructions: 'Review bank rec exceptions.' } },
];

// ─── Classifier — returns (patternId, steps, summary) ──────────────────────

const LISTING_MAP: Record<string, string> = {
  'Accruals': 'accruals',
  'Amount owed by group undertakings': 'debtors_ageing',
  'Amounts owed to group undertakings': 'creditors_ageing',
  'Trade debtors': 'debtors_ageing',
  'Trade creditors': 'creditors_ageing',
  'Other debtors': 'debtors_ageing',
  'Other creditors': 'creditors_ageing',
  'Property plant and equipment': 'far',
  'Intangible assets': 'intangibles',
  'Inventory': 'inventory',
  'Loans and borrowings': 'loan_schedule',
  'Share capital': 'share_register',
  'Investments (financial assets)': 'investments',
  'Investments in subsidaries': 'investments',
  'Prepayments and accrued income': 'prepayments',
  'Deferred revenue': 'other',
  'Deferred tax': 'deferred_tax',
  'Cash and Cash equivalents': 'other',
  'Wages & Salaries': 'payroll',
  'Corporation tax payable': 'other',
  'Other taxation and social security payable': 'other',
  'Tax expense': 'deferred_tax',
  'Reserves': 'share_register',
  'Revenue': 'other',
  'Cost of Sales': 'other',
  'Operating Expenses': 'other',
  'Other Operating Income': 'other',
  'Interest payable and similar income': 'other',
  'Other interest receivable and similar income': 'other',
};

interface Classification {
  patternId: string;
  steps: StepSpec[];
  summary: string;
}

export function classify(desc: string, fsLine: string, assertion: string, type: string): Classification {
  const d = desc.toLowerCase();

  // Special-case FS lines
  if (fsLine === 'Management Override') {
    return {
      patternId: 'mgmt_override',
      summary: 'Management-override journal entry test (ISA 240).',
      steps: [
        { actionCode: 'test_journals',       inputBindings: { criteria: ['round_numbers','period_end_weekends','unusual_users','manual_to_sensitive'] } },
        { actionCode: 'request_documents',   inputBindings: { document_type: 'other', message_to_client: 'Please provide the supporting evidence for the selected journals.', transactions: '$prev.sample_items' } },
        { actionCode: 'verify_evidence',     inputBindings: { evidence_documents: '$prev.documents', assertions: ['occurrence','accuracy'] } },
        { actionCode: 'team_review',         inputBindings: { instructions: 'Conclude on management override.' } },
      ],
    };
  }
  if (fsLine === 'Going Concern') {
    return {
      patternId: 'going_concern',
      summary: "Going-concern review: evaluate management's cash-flow forecast and conclude on opinion.",
      steps: [
        { actionCode: 'request_documents',         inputBindings: { document_type: 'other', message_to_client: 'Please provide the going-concern cash-flow forecast, assumptions, and any sensitivity analyses.', area_of_work: 'Going Concern' } },
        { actionCode: 'review_cashflow_forecast',  inputBindings: { forecast_documents: '$prev.documents' } },
        { actionCode: 'team_review',               inputBindings: { instructions: 'Conclude on going-concern opinion wording.' } },
      ],
    };
  }
  if (fsLine === 'Notes and Disclosures') {
    return {
      patternId: 'fs_checker',
      summary: 'Run the FS Checker across draft financial statements.',
      steps: [
        { actionCode: 'request_documents',  inputBindings: { document_type: 'other', message_to_client: 'Please provide the draft financial statements for FS Checker review.', area_of_work: 'Notes and Disclosures' } },
        { actionCode: 'run_fs_checker',     inputBindings: { fs_document: '$prev.documents' } },
        { actionCode: 'team_review',        inputBindings: { instructions: 'Review checker exceptions.' } },
      ],
    };
  }

  // Analytical Review — PY variance
  if (d.includes('review changes from py') || (type.toLowerCase().startsWith('analytical') && d.includes('py'))) {
    return { patternId: 'ar_variance', summary: 'Analytical review of movement vs PY, investigate where delta breaches threshold.', steps: stepsAnalyticalReview() };
  }
  // Sampling calculator / sample-size step
  if (d.includes('sampling calculator') || d.includes('determine the number of samples')) {
    return {
      patternId: 'sample_size',
      summary: 'Determine sample size via the Sample Calculator.',
      steps: [
        { actionCode: 'select_sample', inputBindings: { sample_type: 'standard' } },
        { actionCode: 'team_review',   inputBindings: { instructions: 'Confirm sample size decision.' } },
      ],
    };
  }
  // Cut-off
  if (d.includes('cut-off') || d.includes('cut off') || d.includes('cutoff') || assertion === 'Cut Off') {
    return { patternId: 'cutoff', summary: 'Cut-off test either side of period end.', steps: stepsCutoff() };
  }
  // FS Checker
  if (d.includes('run fs checker')) {
    return {
      patternId: 'fs_checker_one',
      summary: 'Run FS Checker.',
      steps: [
        { actionCode: 'run_fs_checker', inputBindings: { framework: '$ctx.engagement.framework' } },
        { actionCode: 'team_review',    inputBindings: { instructions: 'Review checker exceptions.' } },
      ],
    };
  }
  // Reconciliation of listing to TB
  if ((d.includes('reconcile') && (d.includes('general ledger') || d.includes('trial balance') || d.includes(' tb') || d.includes('far'))) ||
      (d.includes('obtain') && (d.includes('listing') || d.includes('schedule')))) {
    const lt = LISTING_MAP[fsLine] || 'other';
    return { patternId: 'listing_recon', summary: `Obtain ${lt.replace(/_/g, ' ')} listing and reconcile to TB.`, steps: stepsListingRecon(lt) };
  }
  // Confirmations
  if (d.includes('confirmation') || d.includes('confirm balances') || d.includes('send confirmations')) {
    const conf = fsLine.startsWith('Cash') ? 'bank'
               : fsLine.toLowerCase().includes('debtor') ? 'debtor'
               : (fsLine.toLowerCase().includes('creditor') || fsLine === 'Loans and borrowings') ? 'creditor'
               : 'other';
    return { patternId: 'confirmations', summary: `Send third-party confirmations (${conf}).`, steps: stepsConfirmations(conf) };
  }
  // Physical verification / count
  if (d.includes('physical verification') || d.includes('observe cash') || d.includes('asset tag') || d.includes('serial number') || (d.includes('observe') && d.includes('count')) || d.includes('stocktake') || d.includes('inventory count')) {
    const item = fsLine === 'Inventory' ? 'inventory' : (fsLine.startsWith('Cash') ? 'cash' : 'ppe');
    return { patternId: 'physical', summary: `Physical verification of ${item}.`, steps: stepsPhysical(item) };
  }
  // Subsequent receipts
  if (d.includes('subsequent receipt') || d.includes('unrecorded receivable')) {
    return { patternId: 'subs_receipts', summary: 'Inspect subsequent receipts post-YE.', steps: stepsSubsequent('receipts') };
  }
  // Subsequent payments / unrecorded items
  if (d.includes('subsequent payment') || d.includes('subsequent bank statement') || d.includes('unrecorded accrual') || d.includes('unrecorded transaction')) {
    return { patternId: 'subs_payments', summary: 'Inspect subsequent payments / statements post-YE.', steps: stepsSubsequent('payments') };
  }
  // URLA
  if (d.includes('unrecorded') && d.includes('liabilit')) {
    return { patternId: 'urla', summary: 'Unrecorded-liabilities test: post-YE payments pipeline.', steps: stepsUrla() };
  }
  // Credit notes / returns
  if (d.includes('credit note') || (d.includes('returns') && d.includes('reverse'))) {
    return { patternId: 'subs_creditnotes', summary: 'Review post-YE credit notes / returns for period impact.', steps: stepsSubsequent('credit_notes') };
  }
  // Recalculations
  if (d.includes('recalculate depreciation') || (d.includes('depreciation expense') && d.includes('recalculate'))) {
    return { patternId: 'recalc_dep', summary: 'Recalculate depreciation.', steps: stepsRecalc('straight_line_depreciation') };
  }
  if ((d.includes('recalculate') && d.includes('interest')) || (d.includes('interest') && d.includes('accrual'))) {
    return { patternId: 'recalc_int', summary: 'Recalculate interest.', steps: stepsRecalc('interest') };
  }
  if ((d.includes('tax') && (d.includes('calculation') || d.includes('recalc') || d.includes('rate'))) || d.includes('tax computation')) {
    return { patternId: 'recalc_tax', summary: 'Recalculate tax provision.', steps: stepsRecalc('tax') };
  }
  // Estimates
  if (d.includes('expected credit loss') || d.includes('ecl') || d.includes('allowance for') || d.includes('write-off') || (d.includes('provision') && d.includes('bad debt'))) {
    return { patternId: 'ecl', summary: 'Assess ECL / bad-debt provision.', steps: stepsEstimates('ecl') };
  }
  if (d.includes('impairment')) {
    return { patternId: 'impairment', summary: 'Assess impairment indicators and review.', steps: stepsEstimates('impairment') };
  }
  if (d.includes('revaluation') || d.includes('fair value') || d.includes('valuer')) {
    return { patternId: 'fv', summary: 'Assess valuation / revaluation.', steps: stepsEstimates('fair_value') };
  }
  // Policy
  if (d.includes('accounting policy') || (d.includes('ifrs') && d.includes('applied')) || (d.includes('policy') && d.includes('consist'))) {
    return { patternId: 'policy', summary: 'Review accounting-policy compliance.', steps: stepsPolicy() };
  }
  // Classification
  if (assertion === 'Classification' || d.includes('classified') || d.includes('classification') || d.includes('misclass')) {
    return {
      patternId: 'classification',
      summary: 'Check classification within FS line.',
      steps: stepsAiOnly(`Check classification of ${fsLine} transactions for correct sub-categorisation against policy.`),
    };
  }
  // Related party
  if (d.includes('related part') || d.includes('ias 24')) {
    return {
      patternId: 'related_party',
      summary: 'Identify and reconcile related-party transactions.',
      steps: [
        { actionCode: 'analyse_related_party', inputBindings: { period_start: '$ctx.engagement.periodStart', period_end: '$ctx.engagement.periodEnd' } },
        { actionCode: 'team_review',           inputBindings: { instructions: 'Confirm RP disclosure agrees to findings.' } },
      ],
    };
  }
  // Disclosures / Presentation
  if (assertion === 'Presentation' || d.includes('disclosure') || d.includes('presented') || d.includes('ias 24')) {
    return { patternId: 'disclosure', summary: 'Review disclosures for compliance with framework.', steps: stepsDisclosureReview() };
  }
  // Ownership / rights
  if (assertion === 'Rights & obligations' || d.includes('title deed') || d.includes('ownership') || d.includes('pledged') || d.includes('encumbr')) {
    return { patternId: 'ownership', summary: 'Inspect ownership evidence (contracts, deeds, agreements).', steps: stepsContracts() };
  }
  // Sample + inspect supporting docs
  if (d.includes('supporting document') || (d.includes('trace') && d.includes('invoice')) || (d.includes('inspect') && (d.includes('invoice') || d.includes('contract'))) || (d.includes('sample') && (d.includes('invoice') || d.includes('purchase invoice') || d.includes('contract')))) {
    let doc = 'invoice';
    if (d.includes('contract')) doc = 'contract';
    if (d.includes('bank statement')) doc = 'bank_statement';
    const a = (assertion || 'existence').toLowerCase().split(' ')[0];
    return { patternId: 'sample_inspect', summary: `Sample and inspect supporting ${doc.replace('_', ' ')}s.`, steps: stepsSampleInspect(doc, a) };
  }
  // Board minutes
  if (d.includes('board minute') || (d.includes('budget') && d.includes('unrecorded'))) {
    return { patternId: 'board_minutes', summary: 'AI scan of board minutes / budgets for unrecorded items.', steps: stepsBoardMinutes() };
  }
  // Bank rec
  if (d.includes('bank reconciliation') || d.includes('reconcile bank')) {
    return { patternId: 'bank_recon', summary: 'Review bank reconciliation at period end.', steps: stepsBankRecon() };
  }
  // Fraud risk
  if (d.includes('fictitious') || d.includes('fraud risk') || d.includes('unusual terms')) {
    return {
      patternId: 'fraud',
      summary: 'Scan for fraud-risk indicators.',
      steps: [
        { actionCode: 'review_fraud_risk', inputBindings: { fs_line: '$ctx.test.fsLine' } },
        { actionCode: 'team_review',       inputBindings: { instructions: 'Review fraud-risk scan results.' } },
      ],
    };
  }
  // Walkthrough / management discussion
  if (d.includes('discuss with management') || (d.includes('understand') && d.includes('process')) || d.includes('walkthrough') || d.includes('design effectiveness')) {
    return {
      patternId: 'walkthrough',
      summary: 'Walkthrough / management discussion.',
      steps: stepsAiOnly(`Record walkthrough of the ${fsLine} process; document controls and design effectiveness.`),
    };
  }
  // Performance obligation
  if (d.includes('performance obligation')) {
    return {
      patternId: 'perf_oblig',
      summary: 'Assess performance-obligation satisfaction per IFRS 15.',
      steps: stepsAiOnly(`For ${fsLine}, assess how the performance obligation is satisfied per the contract terms.`),
    };
  }
  // FX
  if (d.includes('foreign currenc') || d.includes('exchange rate') || d.includes(' fx')) {
    return { patternId: 'fx', summary: 'Test FX translation on foreign-currency balances.', steps: stepsRecalc('fx') };
  }
  // Generic estimates
  if (d.includes('estimate') || d.includes('judgement') || d.includes('reasonableness')) {
    return { patternId: 'estimates', summary: 'Assess management estimate / judgement.', steps: stepsEstimates('other') };
  }
  // Ageing
  if (d.includes('aging') || d.includes('ageing')) {
    const lt = fsLine.toLowerCase().includes('debtor') ? 'debtors_ageing' : 'creditors_ageing';
    return {
      patternId: 'ageing',
      summary: 'Review debtor/creditor ageing.',
      steps: [
        { actionCode: 'request_listing', inputBindings: { listing_type: lt, message_to_client: `Please provide the ${lt.replace('_', ' ')} listing as at period end.` } },
        { actionCode: 'ai_analysis',     inputBindings: { prompt_template: 'Review ageing buckets for overdue items that may indicate ECL / disputed balances.', input_data: '$prev.data_table', output_format: 'pass_fail' } },
        { actionCode: 'team_review',     inputBindings: { instructions: 'Review ageing findings.' } },
      ],
    };
  }

  // Fallback — generic AI analysis mirroring the test description
  return {
    patternId: 'generic_ai',
    summary: 'Generic AI-analysis step with prompt mirroring the test description.',
    steps: stepsAiOnly(desc),
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function outputFormatFor(type: string): string {
  if (type === 'Analytical Review' || type === 'Judgement') return 'three_section_no_sampling';
  return 'three_section_sampling';
}

/** Clip a long description down to a usable test-bank name; keep full text in description. */
function testNameFor(fsLine: string, desc: string, rowIndex: number): string {
  // Strip newlines and collapse whitespace for the name
  const clean = desc.replace(/\s+/g, ' ').trim();
  const short = clean.length > 90 ? clean.slice(0, 87) + '...' : clean;
  // Prefix with FS Line so duplicates across lines (e.g. the common AR wording)
  // don't collide on the (firmId, name) unique key. Suffix row index as a final
  // tie-break for any within-line duplicates.
  return `[${fsLine}] ${short} #${rowIndex}`;
}

async function resolveActionIdsByCode(codes: string[]): Promise<Record<string, string>> {
  const defs = await prisma.actionDefinition.findMany({
    where: { firmId: null, isActive: true, code: { in: codes } },
    select: { id: true, code: true, version: true },
  });
  const byCode: Record<string, { id: string; version: number }> = {};
  for (const d of defs) {
    const existing = byCode[d.code];
    if (!existing || ((d.version ?? 1) > existing.version)) {
      byCode[d.code] = { id: d.id, version: d.version ?? 1 };
    }
  }
  const out: Record<string, string> = {};
  for (const [code, v] of Object.entries(byCode)) out[code] = v.id;
  return out;
}

async function pickTestTypeCode(firmId: string): Promise<string> {
  const row = await prisma.methodologyTestType.findFirst({
    where: { firmId, isActive: true },
    orderBy: { code: 'asc' },
    select: { code: true },
  });
  return row?.code || 'substantive';
}

// ─── Main entry point ──────────────────────────────────────────────────────

export interface BulkSeedResult {
  firmId: string;
  totalRows: number;
  created: number;
  updated: number;
  allocated: number;
  skipped: number;
  errors: { row: number; fsLine: string; description: string; error: string }[];
  missingFsLines: string[];
  missingActionCodes: string[];
}

export async function seedBulkDraftTests(firmId: string): Promise<BulkSeedResult> {
  const csvPath = path.join(process.cwd(), 'lib', 'test-data', 'draft-test-bank.csv');
  const csv = fs.readFileSync(csvPath, 'utf-8');
  const rows = parseCsv(csv);

  // Collect all action codes referenced across all classifications so we can
  // resolve the DB ids once. Missing codes are reported in the result — they
  // should be satisfied by ensureSystemActionsUpserted() running first.
  const allCodes = new Set<string>();
  const classified = rows.map((r, i) => {
    const c = classify(r.description, r.fsLine, r.assertion, r.type);
    for (const s of c.steps) allCodes.add(s.actionCode);
    return { row: r, c, rowIndex: i + 1 };
  });
  const actionIds = await resolveActionIdsByCode([...allCodes]);
  const missingActionCodes = [...allCodes].filter(c => !actionIds[c]);

  // Resolve FS line ids once per firm. Tolerate name drift (e.g. "Subsidiaries"
  // vs "Subsidaries" spelling in source CSV) by lowercasing + stripping
  // punctuation for matching.
  const fsLines = await prisma.methodologyFsLine.findMany({
    where: { firmId },
    select: { id: true, name: true },
  });
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const fsByNorm: Record<string, string> = {};
  for (const f of fsLines) fsByNorm[norm(f.name)] = f.id;
  // Manual aliases for known spelling differences.
  const ALIASES: Record<string, string> = {
    'investmentsinsubsidaries': 'investmentsinsubsidiaries',
    'amountsowedtogroupundertakings': 'amountsowedtogroupundertakings',
    'amountowedbygroupundertakings': 'amountsowedbygroupundertakings',
    'wagessalaries': 'wagesandsalaries',
  };

  const industry = await prisma.methodologyIndustry.findFirst({
    where: { firmId, isDefault: true },
    select: { id: true },
  }) || await prisma.methodologyIndustry.findFirst({
    where: { firmId },
    orderBy: { name: 'asc' },
    select: { id: true },
  });

  const testTypeCode = await pickTestTypeCode(firmId);

  const result: BulkSeedResult = {
    firmId,
    totalRows: rows.length,
    created: 0,
    updated: 0,
    allocated: 0,
    skipped: 0,
    errors: [],
    missingFsLines: [],
    missingActionCodes,
  };

  for (const { row, c, rowIndex } of classified) {
    try {
      // Skip rows whose classification uses actions we couldn't resolve.
      const needed = c.steps.map(s => s.actionCode);
      const missing = needed.filter(code => !actionIds[code]);
      if (missing.length > 0) {
        result.skipped++;
        result.errors.push({ row: rowIndex, fsLine: row.fsLine, description: row.description.slice(0, 120), error: `Missing action codes: ${missing.join(', ')}` });
        continue;
      }

      const name = testNameFor(row.fsLine, row.description, rowIndex);
      const existing = await prisma.methodologyTest.findUnique({
        where: { firmId_name: { firmId, name } },
      });

      let testId: string;
      if (existing) {
        testId = existing.id;
        await prisma.methodologyTest.update({
          where: { id: testId },
          data: {
            description: row.description,
            framework: row.framework || 'FRS102',
            category: 'Significant Risk',
            outputFormat: outputFormatFor(row.type),
            executionMode: 'action_pipeline',
            assertions: row.assertion ? [row.assertion] : undefined,
            isDraft: true,
            isActive: true,
          },
        });
        result.updated++;
      } else {
        const created = await prisma.methodologyTest.create({
          data: {
            firmId,
            name,
            description: row.description,
            testTypeCode,
            framework: row.framework || 'FRS102',
            category: 'Significant Risk',
            outputFormat: outputFormatFor(row.type),
            executionMode: 'action_pipeline',
            assertions: row.assertion ? [row.assertion] : undefined,
            isDraft: true,
            isActive: true,
          },
        });
        testId = created.id;
        result.created++;
      }

      // Rebuild the step chain from scratch — matches accruals-test-seed.ts.
      await prisma.testActionStep.deleteMany({ where: { testId } });
      for (let i = 0; i < c.steps.length; i++) {
        const s = c.steps[i];
        await prisma.testActionStep.create({
          data: {
            testId,
            actionDefinitionId: actionIds[s.actionCode],
            stepOrder: i,
            inputBindings: s.inputBindings as any,
            isActive: true,
          },
        });
      }

      // Allocate to FS line × default industry (best effort — drop silently on
      // missing FS line, report in result).
      const fsKey = ALIASES[norm(row.fsLine)] || norm(row.fsLine);
      const fsLineId = fsByNorm[fsKey] || fsByNorm[norm(row.fsLine)];
      if (fsLineId && industry) {
        try {
          await prisma.methodologyTestAllocation.create({
            data: { testId, fsLineId, industryId: industry.id },
          });
          result.allocated++;
        } catch {
          // Duplicate allocation — idempotent, fine.
        }
      } else if (!fsLineId) {
        if (!result.missingFsLines.includes(row.fsLine)) result.missingFsLines.push(row.fsLine);
      }
    } catch (err: any) {
      result.errors.push({ row: rowIndex, fsLine: row.fsLine, description: row.description.slice(0, 120), error: err?.message || String(err) });
    }
  }

  return result;
}
