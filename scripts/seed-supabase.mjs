/**
 * Seed all methodology data into the Supabase production database.
 * Run with: DATABASE_URL='postgresql://...' node scripts/seed-supabase.mjs
 */

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const p = new PrismaClient();
const FIRM_ID = 'johnsons-firm-id-0000-000000000001';

function q(key, label, section, inputType = 'text', opts = {}) {
  return { id: randomUUID(), key, questionText: label, sectionKey: section, inputType, sortOrder: 0, ...opts };
}

async function seedRiskTables() {
  console.log('Seeding risk tables...');

  // Inherent Risk (Appendix F)
  await p.methodologyRiskTable.upsert({
    where: { firmId_tableType: { firmId: FIRM_ID, tableType: 'inherent_risk' } },
    create: { firmId: FIRM_ID, tableType: 'inherent_risk', data: {
      rows: ['Remote', 'Unlikely', 'Neutral', 'Likely', 'Very Likely'],
      cols: ['Remote', 'Low', 'Medium', 'High', 'Very High'],
      values: [
        ['Remote', 'Remote', 'Low', 'Low', 'Low'],
        ['Remote', 'Low', 'Low', 'Medium', 'High'],
        ['Low', 'Low', 'Medium', 'High', 'High'],
        ['Low', 'Medium', 'High', 'High', 'Very High'],
        ['Low', 'High', 'High', 'Very High', 'Very High'],
      ]
    }},
    update: { data: { rows: ['Remote','Unlikely','Neutral','Likely','Very Likely'], cols: ['Remote','Low','Medium','High','Very High'], values: [['Remote','Remote','Low','Low','Low'],['Remote','Low','Low','Medium','High'],['Low','Low','Medium','High','High'],['Low','Medium','High','High','Very High'],['Low','High','High','Very High','Very High']] }},
  });

  // Control Risk (Appendix G)
  await p.methodologyRiskTable.upsert({
    where: { firmId_tableType: { firmId: FIRM_ID, tableType: 'control_risk' } },
    create: { firmId: FIRM_ID, tableType: 'control_risk', data: {
      rows: ['Remote', 'Low', 'Medium', 'High', 'Very High'],
      cols: ['Not Tested', 'Effective', 'Not Effective', 'Partially Effective'],
      values: [
        ['Remote', 'Remote', 'Low', 'Low'],
        ['Low', 'Low', 'Low', 'Medium'],
        ['Medium', 'Low', 'Medium', 'High'],
        ['High', 'Medium', 'High', 'High'],
        ['Very High', 'High', 'High', 'Very High'],
      ]
    }},
    update: { data: { rows: ['Remote','Low','Medium','High','Very High'], cols: ['Not Tested','Effective','Not Effective','Partially Effective'], values: [['Remote','Remote','Low','Low'],['Low','Low','Low','Medium'],['Medium','Low','Medium','High'],['High','Medium','High','High'],['Very High','High','High','Very High']] }},
  });

  // Materiality Range (Appendix E F5:H11)
  await p.methodologyRiskTable.upsert({
    where: { firmId_tableType: { firmId: FIRM_ID, tableType: 'materiality_range' } },
    create: { firmId: FIRM_ID, tableType: 'materiality_range', data: [
      { benchmark: 'Profit before Tax', low: 0.05, high: 0.10 },
      { benchmark: 'Gross Profit', low: 0.01, high: 0.04 },
      { benchmark: 'Total Revenue', low: 0.005, high: 0.02 },
      { benchmark: 'Total Expenses', low: 0.005, high: 0.02 },
      { benchmark: 'Total Equity or Net Assets', low: 0.01, high: 0.05 },
      { benchmark: 'Total Assets', low: 0.005, high: 0.02 },
    ]},
    update: { data: [{ benchmark: 'Profit before Tax', low: 0.05, high: 0.10 },{ benchmark: 'Gross Profit', low: 0.01, high: 0.04 },{ benchmark: 'Total Revenue', low: 0.005, high: 0.02 },{ benchmark: 'Total Expenses', low: 0.005, high: 0.02 },{ benchmark: 'Total Equity or Net Assets', low: 0.01, high: 0.05 },{ benchmark: 'Total Assets', low: 0.005, high: 0.02 }] },
  });

  // PM Range
  await p.methodologyRiskTable.upsert({
    where: { firmId_tableType: { firmId: FIRM_ID, tableType: 'pm_range' } },
    create: { firmId: FIRM_ID, tableType: 'pm_range', data: [
      { label: 'Low (50%)', value: 0.50 },
      { label: 'Moderate (65%)', value: 0.65 },
      { label: 'High (75%)', value: 0.75 },
    ]},
    update: { data: [{ label: 'Low (50%)', value: 0.50 },{ label: 'Moderate (65%)', value: 0.65 },{ label: 'High (75%)', value: 0.75 }] },
  });

  // OM Range
  await p.methodologyRiskTable.upsert({
    where: { firmId_tableType: { firmId: FIRM_ID, tableType: 'om_range' } },
    create: { firmId: FIRM_ID, tableType: 'om_range', data: [
      { label: 'Low', value: 'low' },
      { label: 'Mid', value: 'mid' },
      { label: 'High', value: 'high' },
    ]},
    update: { data: [{ label: 'Low', value: 'low' },{ label: 'Mid', value: 'mid' },{ label: 'High', value: 'high' }] },
  });

  // Assertions (Appendix H)
  await p.methodologyRiskTable.upsert({
    where: { firmId_tableType: { firmId: FIRM_ID, tableType: 'assertions' } },
    create: { firmId: FIRM_ID, tableType: 'assertions', data: {
      assertions: ['Completeness', 'Occurrence & Accuracy', 'Cut Off', 'Classification', 'Presentation', 'Existence', 'Valuation', 'Rights & Obligations'],
      bsApplicable: [true, true, true, true, true, true, true, true],
      pnlApplicable: [true, true, true, false, true, false, false, false],
    }},
    update: { data: { assertions: ['Completeness','Occurrence & Accuracy','Cut Off','Classification','Presentation','Existence','Valuation','Rights & Obligations'], bsApplicable: [true,true,true,true,true,true,true,true], pnlApplicable: [true,true,true,false,true,false,false,false] }},
  });

  console.log('  6 risk tables seeded');
}

async function seedTestTypes() {
  console.log('Seeding test types...');
  const types = [
    { name: 'Analytical Review', code: 'analytical_review', actionType: 'human_action' },
    { name: 'Test of Details', code: 'test_of_details', actionType: 'human_action' },
    { name: 'Judgement', code: 'judgement', actionType: 'human_action' },
    { name: 'Physical Verification', code: 'physical_verification', actionType: 'human_action' },
    { name: 'Third Party Confirmation', code: 'third_party_confirmation', actionType: 'client_action' },
  ];

  for (const t of types) {
    await p.methodologyTestType.upsert({
      where: { firmId_code: { firmId: FIRM_ID, code: t.code } },
      create: { firmId: FIRM_ID, ...t, isActive: true },
      update: { name: t.name, actionType: t.actionType },
    });
  }
  console.log(`  ${types.length} test types seeded`);
}

async function seedPermanentFileTemplate() {
  console.log('Seeding Permanent File template...');
  const questions = [
    q('entity_address', 'Entity Address Block', 'Entity Details', 'textarea'),
    q('contact', 'Contact', 'Entity Details'),
    q('contact_email', 'Contact Email', 'Entity Details', 'text'),
    q('address', 'Address', 'Entity Details', 'textarea'),
    q('group_companies', 'Group Companies', 'Entity Details', 'yn'),
    q('informed_management', 'Informed Management', 'Entity Details'),
    q('ownership_governance', 'Ownership and governance', 'Understanding the Entity', 'textarea'),
    q('principal_activity', 'Principal Activity and organisation structure', 'Understanding the Entity', 'textarea'),
    q('changes_prior_period', 'Changes from prior period or significant activities', 'Understanding the Entity', 'textarea'),
    q('kpi', 'Key Performance Indicators', 'Understanding the Entity', 'textarea'),
    q('industry', 'Industry', 'Understanding the Entity'),
    q('regulatory_framework', 'Regulatory framework (registered or not)?', 'Understanding the Entity'),
    q('financing', 'Financing', 'Understanding the Entity', 'textarea'),
    q('applicable_framework', 'Applicable financial reporting framework', 'Financial Reporting Framework'),
    q('significant_policies', 'Significant accounting policies', 'Financial Reporting Framework', 'textarea'),
    q('changes_policies', 'Changes in accounting policies from prior year', 'Financial Reporting Framework', 'textarea'),
    q('reporting_currency_diff', 'Is Reporting currency different from functional currency', 'Financial Reporting Framework', 'yn'),
    q('reporting_currency', 'Reporting Currency', 'Financial Reporting Framework', 'dropdown', { dropdownOptions: ['GBP','USD','EUR','CHF','JPY','AUD','CAD','NZD','SEK','NOK','DKK','SGD','HKD','ZAR','BRL','INR','CNY'] }),
    q('legal_regulatory', 'Legal and regulatory framework applicable to the entity', 'Laws and Regulations', 'textarea'),
    q('non_compliance_indicators', 'Any indicators of non-compliance with laws and regulations?', 'Laws and Regulations', 'textarea'),
    q('ongoing_litigations', 'Any ongoing litigations and claims against the Company?', 'Laws and Regulations', 'textarea'),
    q('related_parties_list', 'List all known related parties and likely transactions', 'Related Parties', 'textarea'),
    q('related_parties_risk', 'Assess risk of material misstatement from related parties', 'Related Parties', 'textarea'),
    q('unidentified_relationships', 'Any related relationships not identified by management?', 'Related Parties', 'yn'),
    q('it_systems', 'IT systems used by client', 'IT Environment', 'textarea'),
    q('cloud_based', 'Are these cloud based systems?', 'IT Environment', 'yn'),
    q('customisation', 'Any customisation to the accounts software?', 'IT Environment', 'textarea'),
    q('system_access', 'List of members who have access to the system', 'IT Environment', 'textarea'),
    q('it_complexity', 'Final conclusion on the complexity of the IT system', 'IT Environment', 'dropdown', { dropdownOptions: ['Complex', 'Not Complex'] }),
    q('ipe_reports', 'List of reports for IPE procedures', 'IT Environment', 'textarea'),
    q('estimates_list', 'List of accounting estimates relevant to the entity', 'Accounting Estimates', 'textarea'),
    q('estimates_complexity', 'Assess complexity considering subjectivity and uncertainty', 'Accounting Estimates', 'textarea'),
    q('estimates_controls', 'Control procedures for accounting estimates', 'Accounting Estimates', 'textarea'),
    q('fraud_conclusion', 'Conclusion on the fraud risk assessment', 'Fraud Risk Analysis', 'textarea'),
    q('fraud_triangle', 'Confirm fraud triangle considered?', 'Fraud Risk Analysis', 'yn'),
    q('auditor_expert_needed', 'Need to involve audit experts/specialists?', "Auditor's Expert", 'yn'),
    q('auditor_expert_competence', 'Assessment of competence of Auditor Expert', "Auditor's Expert", 'textarea'),
    q('auditor_expert_instructions', 'Instructions to expert/specialist issued?', "Auditor's Expert", 'yn'),
    q('auditor_expert_frc', 'FRC Ethical Standard 2024 compliance confirmed?', "Auditor's Expert", 'yn'),
    q('mgmt_expert_used', 'Did management use an expert?', 'Management Expert', 'yn'),
    q('mgmt_expert_engagement', 'Copy of engagement letter obtained?', 'Management Expert', 'yn'),
    q('mgmt_expert_instructions', 'Instructions to expert/specialist issued?', 'Management Expert', 'yn'),
    q('service_org_list', 'List of service organisations and significance', 'Service Organisation', 'textarea'),
    q('service_org_engagement', 'Copy of engagement letter obtained?', 'Service Organisation', 'yn'),
    q('service_org_understanding', 'Document understanding of effect on internal control', 'Service Organisation', 'textarea'),
    q('service_org_control_framework', 'Document understanding of control framework', 'Service Organisation', 'textarea'),
  ];
  questions.forEach((q, i) => { q.sortOrder = i + 1; });

  await p.methodologyTemplate.upsert({
    where: { firmId_templateType_auditType: { firmId: FIRM_ID, templateType: 'permanent_file_questions', auditType: 'ALL' } },
    create: { firmId: FIRM_ID, templateType: 'permanent_file_questions', auditType: 'ALL', items: questions },
    update: { items: questions },
  });
  console.log(`  ${questions.length} permanent file questions seeded`);
}

async function seedEthicsTemplate() {
  console.log('Seeding Ethics template...');
  const questions = [];
  let order = 1;

  // Non Audit Services (8 services x 3 fields each)
  const services = ['Preparation of accounts','Corporation Tax','Advisory / Valuation Services','Internal Audit','Other Assurance','Payroll','VAT / Bookkeeping','Recruitment, Legal & Litigation and IT Services'];
  for (const svc of services) {
    questions.push({ id: randomUUID(), key: `nas_${svc.toLowerCase().replace(/[^a-z0-9]+/g,'_')}_comments`, questionText: `${svc}`, sectionKey: 'Non Audit Services', inputType: 'textarea', sortOrder: order++ });
    questions.push({ id: randomUUID(), key: `nas_${svc.toLowerCase().replace(/[^a-z0-9]+/g,'_')}_issue`, questionText: `${svc} - Issue?`, sectionKey: 'Non Audit Services', inputType: 'yn', sortOrder: order++ });
    questions.push({ id: randomUUID(), key: `nas_${svc.toLowerCase().replace(/[^a-z0-9]+/g,'_')}_safeguard`, questionText: `${svc} - Safeguard`, sectionKey: 'Non Audit Services', inputType: 'textarea', sortOrder: order++ });
  }

  // Threats
  const threats = ['Familiarity Threat of Audit Team','Self Interest Threat','Self-Review Threat','Advocacy Threat','Management Threat','Intimidation Threat'];
  for (const t of threats) {
    questions.push({ id: randomUUID(), key: `threat_${t.toLowerCase().replace(/[^a-z0-9]+/g,'_')}_comments`, questionText: t, sectionKey: 'Threats', inputType: 'textarea', sortOrder: order++ });
    questions.push({ id: randomUUID(), key: `threat_${t.toLowerCase().replace(/[^a-z0-9]+/g,'_')}_issue`, questionText: `${t} - Issue?`, sectionKey: 'Threats', inputType: 'yn', sortOrder: order++ });
    questions.push({ id: randomUUID(), key: `threat_${t.toLowerCase().replace(/[^a-z0-9]+/g,'_')}_safeguard`, questionText: `${t} - Safeguard`, sectionKey: 'Threats', inputType: 'textarea', sortOrder: order++ });
  }

  // Relationships
  const rels = ['Financial relationship','Business relationship','Employment relationship','Personal relationship'];
  for (const r of rels) {
    questions.push({ id: randomUUID(), key: `rel_${r.toLowerCase().replace(/[^a-z0-9]+/g,'_')}_comments`, questionText: r, sectionKey: 'Relationships', inputType: 'textarea', sortOrder: order++ });
    questions.push({ id: randomUUID(), key: `rel_${r.toLowerCase().replace(/[^a-z0-9]+/g,'_')}_issue`, questionText: `${r} - Issue?`, sectionKey: 'Relationships', inputType: 'yn', sortOrder: order++ });
    questions.push({ id: randomUUID(), key: `rel_${r.toLowerCase().replace(/[^a-z0-9]+/g,'_')}_safeguard`, questionText: `${r} - Safeguard`, sectionKey: 'Relationships', inputType: 'textarea', sortOrder: order++ });
  }

  // Fee Assessment
  questions.push({ id: randomUUID(), key: 'fee_audit', questionText: 'Audit Fee', sectionKey: 'Fee Assessment', inputType: 'currency', sortOrder: order++ });
  questions.push({ id: randomUUID(), key: 'fee_non_audit', questionText: 'Non-Audit Fee', sectionKey: 'Fee Assessment', inputType: 'currency', sortOrder: order++ });
  questions.push({ id: randomUUID(), key: 'fee_total', questionText: 'Total Fees', sectionKey: 'Fee Assessment', inputType: 'formula', sortOrder: order++, formulaExpression: '=fee_audit+fee_non_audit' });
  questions.push({ id: randomUUID(), key: 'fee_pct_non_audit', questionText: '% of Non-Audit Fee to Audit Fee', sectionKey: 'Fee Assessment', inputType: 'formula', sortOrder: order++, formulaExpression: '=IF(fee_audit>0,fee_non_audit/fee_audit*100,0)' });
  questions.push({ id: randomUUID(), key: 'fee_pct_firm', questionText: '% of Total Fees to Firm Fees', sectionKey: 'Fee Assessment', inputType: 'formula', sortOrder: order++, formulaExpression: '=IF(firm_fees>0,fee_total/firm_fees*100,0)' });
  questions.push({ id: randomUUID(), key: 'fee_overdue', questionText: 'Overdue Fees from client', sectionKey: 'Fee Assessment', inputType: 'yn', sortOrder: order++ });

  // ORITP sections
  const oriptObjective = ['Are any audit team members involved in bookkeeping or tax work?','Does the audit team rely solely on non-audit outputs?','Any personal/financial interests in the client?','Has professional skepticism been maintained?','Is audit judgment free from management influence?'];
  for (const q2 of oriptObjective) {
    questions.push({ id: randomUUID(), key: `oritp_obj_${order}`, questionText: q2, sectionKey: 'ORITP - Objective', inputType: 'yn', sortOrder: order++ });
  }
  questions.push({ id: randomUUID(), key: 'oritp_obj_conclusion', questionText: 'Conclusion', sectionKey: 'ORITP - Objective', inputType: 'dropdown', sortOrder: order++, dropdownOptions: ['Threats mitigated. Audit team remains unbiased', 'Threats not fully mitigated. Audit team could be seen to be biased'] });

  const oriptReasonable = ['Are safeguards proportionate?','Are non-audit fees reasonable relative to audit fees?','Is segregation of audit and non-audit services evidenced?','Do services comply with ethical standards?','Have the Directors been informed?'];
  for (const q2 of oriptReasonable) {
    questions.push({ id: randomUUID(), key: `oritp_reas_${order}`, questionText: q2, sectionKey: 'ORITP - Reasonable', inputType: 'yn', sortOrder: order++ });
  }
  questions.push({ id: randomUUID(), key: 'oritp_reas_conclusion', questionText: 'Conclusion', sectionKey: 'ORITP - Reasonable', inputType: 'dropdown', sortOrder: order++, dropdownOptions: ['A prudent auditor would consider safeguards adequate.', 'A prudent auditor would be sceptical that safeguards adequate.'] });

  const oriptInformed = ['Would an informed third party perceive independence as compromised?','Could stakeholders believe the firm is auditing its own work?','Would disclosure of non-audit services appear excessive?','Is there transparency in safeguards?','Could a regulator challenge the sufficiency of safeguards?'];
  for (const q2 of oriptInformed) {
    questions.push({ id: randomUUID(), key: `oritp_inf_${order}`, questionText: q2, sectionKey: 'ORITP - Informed Third Party', inputType: 'yn', sortOrder: order++ });
  }
  questions.push({ id: randomUUID(), key: 'oritp_inf_conclusion', questionText: 'Conclusion', sectionKey: 'ORITP - Informed Third Party', inputType: 'dropdown', sortOrder: order++, dropdownOptions: ['An informed outsider would conclude independence is preserved.', 'An informed outsider would conclude independence is jeopardised.'] });

  await p.methodologyTemplate.upsert({
    where: { firmId_templateType_auditType: { firmId: FIRM_ID, templateType: 'ethics_questions', auditType: 'ALL' } },
    create: { firmId: FIRM_ID, templateType: 'ethics_questions', auditType: 'ALL', items: questions },
    update: { items: questions },
  });
  console.log(`  ${questions.length} ethics questions seeded`);
}

async function seedContinuanceTemplate() {
  console.log('Seeding Continuance template...');
  const questions = [];
  let order = 1;

  questions.push({ id: randomUUID(), key: 'entity_type', questionText: 'What type of audit client', sectionKey: 'Entity Details', inputType: 'dropdown', sortOrder: order++, dropdownOptions: ['Limited Company', 'PIE', 'Charity'] });
  questions.push({ id: randomUUID(), key: 'is_listed', questionText: 'Is the client listed?', sectionKey: 'Entity Details', inputType: 'dropdown', sortOrder: order++, dropdownOptions: ['Limited Company', 'PIE', 'Charity'] });

  questions.push({ id: randomUUID(), key: 'shareholders_changed', questionText: 'Shareholders with >25% changed during year?', sectionKey: 'Ownership Information', inputType: 'yn', sortOrder: order++ });
  questions.push({ id: randomUUID(), key: 'ubo_changed', questionText: 'Any change in Ultimate Beneficial Owners?', sectionKey: 'Ownership Information', inputType: 'yn', sortOrder: order++ });
  questions.push({ id: randomUUID(), key: 'aml_updated', questionText: 'Did audit team update AML procedures?', sectionKey: 'Ownership Information', inputType: 'yn', sortOrder: order++ });

  questions.push({ id: randomUUID(), key: 'py_mgmt_letter', questionText: 'Prior Year Management Letter Points', sectionKey: 'Continuity', inputType: 'dropdown', sortOrder: order++, dropdownOptions: ['First Year of Audit', 'Our First Year of Audit', 'Existing Client from prior period'] });
  questions.push({ id: randomUUID(), key: 'control_env', questionText: 'Internal control environment', sectionKey: 'Continuity', inputType: 'dropdown', sortOrder: order++, dropdownOptions: ['Functioning as designed', 'Partially Functioning as Designed', 'Not Functioning as Designed'] });
  questions.push({ id: randomUUID(), key: 'engagement_letter_date', questionText: 'Engagement Letter Signed Date', sectionKey: 'Continuity', inputType: 'date', sortOrder: order++ });

  questions.push({ id: randomUUID(), key: 'directors_changed', questionText: 'Any changes in directors/trustees during the year?', sectionKey: 'Management Information', inputType: 'yn', sortOrder: order++ });
  questions.push({ id: randomUUID(), key: 'integrity_concerns', questionText: 'Concerns over skills and integrity of owners/directors?', sectionKey: 'Management Information', inputType: 'yn', sortOrder: order++ });
  questions.push({ id: randomUUID(), key: 'mgmt_competence', questionText: 'Assess management skills and competence for new directors', sectionKey: 'Management Information', inputType: 'dropdown', sortOrder: order++, dropdownOptions: ['Assessed as Competent', 'Assessed as Not Competent', 'Not Assessed'] });

  // Nature of business
  const bizQuestions = ['Is there any change in the principal activities?', 'Is there any change in the group structure?', 'New subsidiaries in non-co-operating countries?', 'Any change in sources of funding?', 'Results of company search'];
  for (const bq of bizQuestions) {
    questions.push({ id: randomUUID(), key: `biz_${order}`, questionText: bq, sectionKey: 'Nature of Business', inputType: 'yn', sortOrder: order++ });
  }

  questions.push({ id: randomUUID(), key: 'py_qualification', questionText: 'Is there any qualification in the prior year audit report?', sectionKey: 'Prior Year Financial Information', inputType: 'yn', sortOrder: order++ });
  questions.push({ id: randomUUID(), key: 'py_qualification_details', questionText: 'Details of the qualification', sectionKey: 'Prior Year Financial Information', inputType: 'textarea', sortOrder: order++ });

  questions.push({ id: randomUUID(), key: 'risk_change', questionText: 'Any change in identified significant risks?', sectionKey: 'Audit Risk Reassessment', inputType: 'yn', sortOrder: order++ });
  questions.push({ id: randomUUID(), key: 'risk_profile', questionText: 'Does this client fit acceptable risk profile?', sectionKey: 'Audit Risk Reassessment', inputType: 'yn', sortOrder: order++ });

  // Fee considerations - services
  const feeServices = ['Audit', 'Accounts Preparation', 'Corporation Tax', 'Advisory / Valuation Services', 'Internal Audit', 'Other Assurance', 'Payroll', 'VAT / Bookkeeping', 'Recruitment, Legal & Litigation and IT Services'];
  for (const svc of feeServices) {
    const svcKey = svc.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    // Prior year
    questions.push({ id: randomUUID(), key: `py_fee_${svcKey}`, questionText: `${svc} - Fee`, sectionKey: 'Fee Considerations - Prior Year', inputType: 'currency', sortOrder: order++ });
    questions.push({ id: randomUUID(), key: `py_hours_${svcKey}`, questionText: `${svc} - Hours`, sectionKey: 'Fee Considerations - Prior Year', inputType: 'number', sortOrder: order++ });
    questions.push({ id: randomUUID(), key: `py_rate_${svcKey}`, questionText: `${svc} - Fee/Hour`, sectionKey: 'Fee Considerations - Prior Year', inputType: 'formula', sortOrder: order++, formulaExpression: `=IF(py_hours_${svcKey}>0,ROUNDUP(py_fee_${svcKey}/py_hours_${svcKey},0),0)` });
    // Current year
    questions.push({ id: randomUUID(), key: `cy_fee_${svcKey}`, questionText: `${svc} - Fee`, sectionKey: 'Fee Considerations - Current Year', inputType: 'currency', sortOrder: order++ });
    questions.push({ id: randomUUID(), key: `cy_hours_${svcKey}`, questionText: `${svc} - Hours`, sectionKey: 'Fee Considerations - Current Year', inputType: 'number', sortOrder: order++ });
    questions.push({ id: randomUUID(), key: `cy_rate_${svcKey}`, questionText: `${svc} - Fee/Hour`, sectionKey: 'Fee Considerations - Current Year', inputType: 'formula', sortOrder: order++, formulaExpression: `=IF(cy_hours_${svcKey}>0,ROUNDUP(cy_fee_${svcKey}/cy_hours_${svcKey},0),0)` });
  }

  questions.push({ id: randomUUID(), key: 'fee_sufficient', questionText: 'Is the proposed audit fee sufficient for high-quality audit?', sectionKey: 'Fee Considerations', inputType: 'yn', sortOrder: order++ });
  questions.push({ id: randomUUID(), key: 'fee_contingent', questionText: 'Is any work on a contingent fee basis?', sectionKey: 'Fee Considerations', inputType: 'yn', sortOrder: order++ });
  questions.push({ id: randomUUID(), key: 'fee_15pct', questionText: 'Do total fees exceed 15% (listed: 10%) of Group Revenue?', sectionKey: 'Fee Considerations', inputType: 'yn', sortOrder: order++ });

  questions.push({ id: randomUUID(), key: 'eqr_required', questionText: 'EQR on this engagement', sectionKey: 'EQR Considerations', inputType: 'yn', sortOrder: order++ });
  questions.push({ id: randomUUID(), key: 'eqr_points', questionText: 'Any points from prior year EQR?', sectionKey: 'EQR Considerations', inputType: 'textarea', sortOrder: order++ });

  questions.push({ id: randomUUID(), key: 'mlro_higher_risk', questionText: 'Is this a higher AML risk?', sectionKey: 'Discussion with MLRO', inputType: 'yn', sortOrder: order++ });
  questions.push({ id: randomUUID(), key: 'mlro_summary', questionText: 'Summarise discussion with MLRO', sectionKey: 'Discussion with MLRO', inputType: 'textarea', sortOrder: order++ });
  questions.push({ id: randomUUID(), key: 'mlro_consent', questionText: 'Did MLRO consent to accepting engagement?', sectionKey: 'Discussion with MLRO', inputType: 'yn', sortOrder: order++ });

  questions.push({ id: randomUUID(), key: 'partner_summary', questionText: 'Summarise discussion with Audit Partner/RI', sectionKey: 'Discussion with Partner/RI', inputType: 'textarea', sortOrder: order++ });
  questions.push({ id: randomUUID(), key: 'partner_consent', questionText: 'Did Audit Partner/RI consent?', sectionKey: 'Discussion with Partner/RI', inputType: 'yn', sortOrder: order++ });

  questions.push({ id: randomUUID(), key: 'final_conclusion', questionText: 'FINAL CONCLUSION', sectionKey: 'Final Conclusion', inputType: 'textarea', sortOrder: order++ });

  await p.methodologyTemplate.upsert({
    where: { firmId_templateType_auditType: { firmId: FIRM_ID, templateType: 'continuance_questions', auditType: 'ALL' } },
    create: { firmId: FIRM_ID, templateType: 'continuance_questions', auditType: 'ALL', items: questions },
    update: { items: questions },
  });
  console.log(`  ${questions.length} continuance questions seeded`);
}

async function seedMaterialityTemplate() {
  console.log('Seeding Materiality template...');
  const questions = [];
  let order = 1;

  questions.push({ id: randomUUID(), key: 'benchmark', questionText: 'Materiality Benchmark', sectionKey: 'Overall Materiality', inputType: 'dropdown', sortOrder: order++, dropdownOptions: ['Profit before Tax','Gross Profit','Total Revenue','Total Expenses','Total Equity or Net Assets','Total Assets'] });
  questions.push({ id: randomUUID(), key: 'benchmark_pct', questionText: 'Benchmark %', sectionKey: 'Overall Materiality', inputType: 'number', sortOrder: order++ });
  questions.push({ id: randomUUID(), key: 'stakeholders', questionText: 'Stakeholders identified', sectionKey: 'Justification', inputType: 'textarea', sortOrder: order++ });
  questions.push({ id: randomUUID(), key: 'stakeholder_focus', questionText: 'How audit team assessed focus of stakeholders', sectionKey: 'Justification', inputType: 'textarea', sortOrder: order++ });
  questions.push({ id: randomUUID(), key: 'key_judgements', questionText: 'Key judgements in setting materiality', sectionKey: 'Justification', inputType: 'textarea', sortOrder: order++ });
  questions.push({ id: randomUUID(), key: 'basis_changed', questionText: 'Any change in basis from prior year?', sectionKey: 'Justification', inputType: 'yn', sortOrder: order++ });
  questions.push({ id: randomUUID(), key: 'basis_change_reason', questionText: 'Reasons for change in basis', sectionKey: 'Justification', inputType: 'textarea', sortOrder: order++ });

  // OM factors
  const omFactors = ['Is the company a public limited entity? Is it listed?','Exposure to borrowing facilities','Minimal number of shareholders','Nature of Business (Highly regulated/Minimally regulated)','Intention to get listed in the near future (3 years)','Changes in the nature of business'];
  for (const f of omFactors) {
    questions.push({ id: randomUUID(), key: `om_${order}`, questionText: f, sectionKey: 'Overall Materiality Assessment', inputType: 'text', sortOrder: order++ });
    questions.push({ id: randomUUID(), key: `om_range_${order}`, questionText: `${f} - Range`, sectionKey: 'Overall Materiality Assessment', inputType: 'dropdown', sortOrder: order++, dropdownOptions: ['Low','Mid','High'] });
  }

  // PM factors
  const pmFactors = ['Deficiencies in internal controls','First/second/third year audit by Firm','Report of fraud or higher risk of fraud','History of misstatements (corrected and uncorrected)','Level of turnover of senior management','Management preparedness to correct misstatements','Competency of management','Complexity of IT environment'];
  for (const f of pmFactors) {
    questions.push({ id: randomUUID(), key: `pm_${order}`, questionText: f, sectionKey: 'Performance Materiality Factors', inputType: 'text', sortOrder: order++ });
    questions.push({ id: randomUUID(), key: `pm_range_${order}`, questionText: `${f} - Range`, sectionKey: 'Performance Materiality Factors', inputType: 'dropdown', sortOrder: order++, dropdownOptions: ['Low (50%)','Moderate (65%)','High (75%)'] });
  }

  await p.methodologyTemplate.upsert({
    where: { firmId_templateType_auditType: { firmId: FIRM_ID, templateType: 'materiality_questions', auditType: 'ALL' } },
    create: { firmId: FIRM_ID, templateType: 'materiality_questions', auditType: 'ALL', items: questions },
    update: { items: questions },
  });
  console.log(`  ${questions.length} materiality questions seeded`);
}

async function seedMandatoryFsLines() {
  console.log('Checking mandatory FS lines...');
  const mandatory = [
    { name: 'Going Concern', lineType: 'fs_line_item', fsCategory: 'notes', sortOrder: 1, isMandatory: true },
    { name: 'Management Override of Controls', lineType: 'fs_line_item', fsCategory: 'notes', sortOrder: 2, isMandatory: true },
    { name: 'Notes & Disclosures', lineType: 'note_item', fsCategory: 'notes', sortOrder: 3, isMandatory: true },
  ];

  for (const m of mandatory) {
    const existing = await p.methodologyFsLine.findFirst({ where: { firmId: FIRM_ID, name: m.name } });
    if (!existing) {
      await p.methodologyFsLine.create({ data: { firmId: FIRM_ID, ...m } });
      console.log(`  Created: ${m.name}`);
    } else {
      console.log(`  Exists: ${m.name}`);
    }
  }
}

async function main() {
  console.log('=== Seeding Supabase Production Database ===');
  console.log('Firm ID:', FIRM_ID);
  console.log('');

  await seedRiskTables();
  await seedTestTypes();
  await seedPermanentFileTemplate();
  await seedEthicsTemplate();
  await seedContinuanceTemplate();
  await seedMaterialityTemplate();
  await seedMandatoryFsLines();

  console.log('');
  console.log('=== Seeding Complete ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); }).finally(() => p.$disconnect());
