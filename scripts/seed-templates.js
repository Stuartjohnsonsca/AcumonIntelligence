const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function q(sectionKey, questionText, inputType, sortOrder, opts) {
  return { id: 'seed_' + sortOrder, sectionKey, questionText, inputType, sortOrder, ...(opts || {}) };
}

const firmId = 'a1b2c3d4-0001-0001-0001-000000000001';

async function seed() {
  await prisma.methodologyTemplate.deleteMany({ where: { firmId, templateType: { endsWith: '_questions' } } });
  console.log('Cleared existing question templates');

  let i;

  // Permanent File
  i = 0;
  const pf = [
    q('Entity Details', 'Contact', 'textarea', i++),
    q('Entity Details', 'Contact Email', 'text', i++),
    q('Entity Details', 'Address', 'textarea', i++),
    q('Entity Details', 'Group Companies', 'yesno', i++),
    q('Entity Details', 'Informed Management', 'textarea', i++),
    q('Understanding the Entity', 'Ownership and governance', 'textarea', i++),
    q('Understanding the Entity', 'Principal Activity and organisation structure', 'textarea', i++),
    q('Understanding the Entity', 'Changes from prior period or significant activities', 'textarea', i++),
    q('Understanding the Entity', 'Key Performance Indicators', 'textarea', i++),
    q('Understanding the Entity', 'Industry', 'textarea', i++),
    q('Understanding the Entity', 'Regulatory framework (whether the entity is registered or not)?', 'textarea', i++),
    q('Understanding the Entity', 'Financing', 'textarea', i++),
    q('Financial Reporting Framework', 'Applicable financial reporting framework', 'textarea', i++),
    q('Financial Reporting Framework', 'Significant accounting policies', 'textarea', i++),
    q('Financial Reporting Framework', 'Changes in accounting policies from prior year', 'textarea', i++),
    q('Financial Reporting Framework', 'Is Reporting currency different from functional currency', 'yesno', i++),
    q('Financial Reporting Framework', 'Reporting Currency', 'text', i++),
    q('Laws and Regulations', 'What is the legal and regulatory framework applicable to the entity?', 'textarea', i++),
    q('Laws and Regulations', 'Are there any indicators of non-compliance with laws and regulations?', 'textarea', i++),
    q('Laws and Regulations', 'Are there any ongoing litigations and claims against the Company?', 'textarea', i++),
    q('Related Parties', 'List all known related parties, nature of relationship and likely transactions', 'textarea', i++),
    q('Related Parties', 'Assess risk of material misstatement associated with related parties', 'textarea', i++),
    q('Related Parties', 'Are there any related relationships not identified by management?', 'textarea', i++),
    q('Related Parties', 'Directors - Name & Nature / Type and purpose', 'textarea', i++),
    q('Related Parties', 'Group entities (parent & affiliates)', 'textarea', i++),
    q('Related Parties', 'Other affiliates', 'textarea', i++),
    q('IT Environment', 'IT systems used by client', 'textarea', i++),
    q('IT Environment', 'Are these cloud based systems?', 'textarea', i++),
    q('IT Environment', 'Are there any customisation to the accounts software?', 'textarea', i++),
    q('IT Environment', 'List of members who have access to the system?', 'textarea', i++),
    q('IT Environment', 'Final conclusion on the complexity of the IT system', 'dropdown', i++, { dropdownOptions: ['Complex', 'Not Complex'] }),
    q('IT Environment', 'List of reports where IPE procedures will be performed', 'textarea', i++),
    q('Accounting Estimates', 'List of accounting estimates relevant to the entity', 'textarea', i++),
    q('Accounting Estimates', 'Assess complexity of each accounting estimate', 'textarea', i++),
    q('Accounting Estimates', 'Control procedures relating to accounting estimates', 'textarea', i++),
    q('Fraud Risk Analysis', 'Conclusion on the fraud risk assessment', 'textarea', i++),
    q('Fraud Risk Analysis', 'Confirm fraud triangle considered?', 'textarea', i++),
    q("Auditor's Expert", 'Need to involve audit experts / specialists?', 'textarea', i++),
    q("Auditor's Expert", 'Assessment of competence and capabilities', 'textarea', i++),
    q("Auditor's Expert", 'Instructions to expert/specialist setting scope?', 'textarea', i++),
    q("Auditor's Expert", 'FRC Ethical Standard 2024 compliance confirmed?', 'textarea', i++),
    q('Management Expert', 'Did use management expert?', 'textarea', i++),
    q('Management Expert', 'Copy of engagement letter obtained?', 'textarea', i++),
    q('Management Expert', 'Instructions to expert/specialist setting scope?', 'textarea', i++),
    q('Service Organisation', 'List of service organisations and significance', 'textarea', i++),
    q('Service Organisation', 'Copy of engagement letter obtained?', 'textarea', i++),
    q('Service Organisation', 'Understanding of effect on internal control', 'textarea', i++),
    q('Service Organisation', 'Understanding of control framework at SO', 'textarea', i++),
  ];
  await prisma.methodologyTemplate.create({ data: { firmId, templateType: 'permanent_file_questions', auditType: 'ALL', items: pf } });
  console.log('Permanent:', pf.length, 'questions');

  // Ethics
  i = 0;
  const eth = [
    q('Non Audit Services', 'Preparation of accounts', 'textarea', i++),
    q('Non Audit Services', 'Corporation Tax', 'textarea', i++),
    q('Non Audit Services', 'Advisory / Valuation Services', 'textarea', i++),
    q('Non Audit Services', 'Internal Audit', 'textarea', i++),
    q('Non Audit Services', 'Other Assurance', 'textarea', i++),
    q('Non Audit Services', 'Payroll', 'textarea', i++),
    q('Non Audit Services', 'VAT / Bookkeeping', 'textarea', i++),
    q('Non Audit Services', 'Recruitment, Legal & Litigation and IT Services', 'textarea', i++),
    q('Threats', 'Familiarity Threat of Audit Team', 'textarea', i++),
    q('Threats', 'Self Interest Threat', 'textarea', i++),
    q('Threats', 'Self-Review Threat', 'textarea', i++),
    q('Threats', 'Advocacy Threat', 'textarea', i++),
    q('Threats', 'Management Threat', 'textarea', i++),
    q('Threats', 'Intimidation Threat', 'textarea', i++),
    q('Relationships', 'Financial relationship', 'textarea', i++),
    q('Relationships', 'Business relationship', 'textarea', i++),
    q('Relationships', 'Employment relationship', 'textarea', i++),
    q('Relationships', 'Personal relationship', 'textarea', i++),
    q('Other Considerations', 'Litigation Threat', 'textarea', i++),
    q('Other Considerations', 'Gifts & Hospitality Threat', 'textarea', i++),
    q('Other Considerations', 'Remuneration of Audit team', 'textarea', i++),
    q('Fee Assessment', 'Audit Fee', 'currency', i++),
    q('Fee Assessment', 'Non-Audit Fee', 'currency', i++),
    q('Fee Assessment', 'Total Fees', 'currency', i++),
    q('Fee Assessment', 'Firm Fees', 'currency', i++),
    q('Fee Assessment', '% of Non-Audit Fee to Audit Fee', 'formula', i++),
    q('Fee Assessment', '% of Total Fees to Firm Fees', 'formula', i++),
    q('Fee Assessment', 'Overdue Fees from client', 'textarea', i++),
    q('ORITP - Objective', 'Are any audit team members involved in bookkeeping or tax work?', 'yesno', i++),
    q('ORITP - Objective', 'Does the audit team rely solely on non-audit outputs?', 'yesno', i++),
    q('ORITP - Objective', 'Any personal/financial interests in the client?', 'yesno', i++),
    q('ORITP - Objective', 'Has professional skepticism been maintained?', 'yesno', i++),
    q('ORITP - Objective', 'Is audit judgment free from management influence?', 'yesno', i++),
    q('ORITP - Objective', 'Conclusion', 'dropdown', i++, { dropdownOptions: ['Threats mitigated. Audit team remains unbiased', 'Threats not fully mitigated. Audit team could be seen to be biased'] }),
    q('ORITP - Reasonable', 'Are safeguards proportionate?', 'yesno', i++),
    q('ORITP - Reasonable', 'Are non-audit fees reasonable relative to audit fees?', 'yesno', i++),
    q('ORITP - Reasonable', 'Is segregation of audit and non-audit services evidenced?', 'yesno', i++),
    q('ORITP - Reasonable', 'Do services comply with ethical standards?', 'yesno', i++),
    q('ORITP - Reasonable', 'Have the Directors been informed?', 'yesno', i++),
    q('ORITP - Reasonable', 'Conclusion', 'dropdown', i++, { dropdownOptions: ['A prudent auditor would consider safeguards adequate.', 'A prudent auditor would be sceptical that safeguards adequate.'] }),
    q('ORITP - Informed Third Party', 'Would an informed third party perceive independence as compromised?', 'yesno', i++),
    q('ORITP - Informed Third Party', 'Could stakeholders believe the firm is auditing its own work?', 'yesno', i++),
    q('ORITP - Informed Third Party', 'Would disclosure of non-audit services appear excessive?', 'yesno', i++),
    q('ORITP - Informed Third Party', 'Is there transparency in safeguards?', 'yesno', i++),
    q('ORITP - Informed Third Party', 'Could a regulator challenge the sufficiency of safeguards?', 'yesno', i++),
    q('ORITP - Informed Third Party', 'Conclusion', 'dropdown', i++, { dropdownOptions: ['An informed outsider would conclude independence is preserved.', 'An informed outsider would conclude independence is jeopardised.'] }),
  ];
  await prisma.methodologyTemplate.create({ data: { firmId, templateType: 'ethics_questions', auditType: 'ALL', items: eth } });
  console.log('Ethics:', eth.length, 'questions');

  // Continuance
  i = 0;
  const cont = [
    q('Entity Details', 'What type of audit client', 'dropdown', i++, { dropdownOptions: ['Limited Company', 'PIE', 'Charity'] }),
    q('Entity Details', 'Is the client listed?', 'yesno', i++),
    q('Ownership', 'Shareholders >25% changed during the year?', 'yes_only', i++),
    q('Ownership', 'Change in Ultimate Beneficial Owners (UBO)?', 'yes_only', i++),
    q('Ownership', 'AML procedures updated for changes?', 'yes_only', i++),
    q('Continuity', 'Prior Year Management Letter Points', 'dropdown', i++, { dropdownOptions: ['First Year of Audit', 'Our First Year of Audit', 'Existing Client from prior period'] }),
    q('Continuity', 'Internal control environment', 'dropdown', i++, { dropdownOptions: ['Functioning as designed', 'Partially Functioning as Designed', 'Not Functioning as Designed'] }),
    q('Continuity', 'Engagement Letter Signed Date', 'date', i++),
    q('Management Info', 'Any changes in directors/trustees during the year?', 'yes_only', i++),
    q('Management Info', 'Concerns over skills and integrity of owners/directors?', 'yes_only', i++),
    q('Management Info', "Management's skills and competence assessment", 'dropdown', i++, { dropdownOptions: ['Assessed as Competent', 'Assessed as Not Competent', 'Not Assessed'] }),
    q('Nature of Business', 'Change in principal activities?', 'yes_only', i++),
    q('Nature of Business', 'Change in group structure?', 'yes_only', i++),
    q('Nature of Business', 'New subsidiaries in non-co-operating countries?', 'yes_only', i++),
    q('Nature of Business', 'Change in sources of funding?', 'yes_only', i++),
    q('Nature of Business', 'Results of company search on Google/Companies House', 'textarea', i++),
    q('Prior Year Financial Info', 'Qualification in prior year audit report?', 'yesno', i++),
    q('Prior Year Financial Info', 'Details of qualification if yes', 'textarea', i++),
    q('Audit Risk Reassessment', 'Change in significant risks, areas of focus, KAMs?', 'yes_only', i++),
    q('Audit Risk Reassessment', "Client fits firm's acceptable risk profile?", 'yes_only', i++),
    q('Fee Considerations', 'Proposed audit fee sufficient for high-quality audit?', 'yesno', i++),
    q('Fee Considerations', 'Work on contingent fee basis?', 'yesno', i++),
    q('Fee Considerations', 'Total fees exceed 15% (listed: 10%) of Group Revenue?', 'textarea', i++),
    q('EQR', 'EQR on this engagement', 'yesno', i++),
    q('EQR', 'Points relevant from working with EQR in prior year', 'textarea', i++),
    q('Discussion with MLRO', 'Is this a higher AML risk', 'yesno', i++),
    q('Discussion with MLRO', 'Summarise discussion with MLRO', 'textarea', i++),
    q('Discussion with MLRO', 'Did MLRO consent to accepting engagement', 'yesno', i++),
    q('Discussion with Partner/RI', 'Summarise discussion with Audit Partner/RI', 'textarea', i++),
    q('Discussion with Partner/RI', 'Did Audit Partner/RI consent to accepting engagement', 'yesno', i++),
    q('Final Conclusion', 'FINAL CONCLUSION', 'textarea', i++),
  ];
  await prisma.methodologyTemplate.create({ data: { firmId, templateType: 'continuance_questions', auditType: 'ALL', items: cont } });
  console.log('Continuance:', cont.length, 'questions');

  // Materiality
  i = 0;
  const mat = [
    q('Benchmark', 'Materiality Benchmark', 'dropdown', i++, { dropdownOptions: ['Profit before Tax', 'Gross Profit', 'Total Revenue', 'Total Expenses', 'Total Equity or Net Assets', 'Total Assets'] }),
    q('Benchmark', 'Range %', 'number', i++),
    q('Benchmark', 'Current Year %', 'number', i++),
    q('Benchmark', 'Materiality Current Year £', 'currency', i++),
    q('Benchmark', 'Materiality Prior Year £', 'currency', i++),
    q('Benchmark', 'Performance Materiality Current Year £', 'currency', i++),
    q('Benchmark', 'Clearly Trivial Current Year £', 'currency', i++),
    q('Justification', 'Justification for basis of materiality', 'textarea', i++),
    q('Justification', 'Stakeholders identified', 'textarea', i++),
    q('Justification', 'Document how audit team assessed focus of stakeholders', 'textarea', i++),
    q('Justification', 'Summarise key judgements in setting materiality', 'textarea', i++),
    q('Justification', 'Is there any change in basis from prior year?', 'textarea', i++),
    q('Justification', 'Document reasons for changing basis for materiality', 'textarea', i++),
    q('Overall Materiality Assessment', 'Is the company a public limited entity? Listed?', 'dropdown', i++, { dropdownOptions: ['Low', 'Mid', 'High'] }),
    q('Overall Materiality Assessment', 'Exposure to borrowing facilities', 'dropdown', i++, { dropdownOptions: ['Low', 'Mid', 'High'] }),
    q('Overall Materiality Assessment', 'Minimal number of shareholders', 'dropdown', i++, { dropdownOptions: ['Low', 'Mid', 'High'] }),
    q('Overall Materiality Assessment', 'Nature of Business (Highly/Minimally regulated)', 'dropdown', i++, { dropdownOptions: ['Low', 'Mid', 'High'] }),
    q('Overall Materiality Assessment', 'Intention to get listed in near future (3 years)', 'dropdown', i++, { dropdownOptions: ['Low', 'Mid', 'High'] }),
    q('Overall Materiality Assessment', 'Changes in the nature of business', 'dropdown', i++, { dropdownOptions: ['Low', 'Mid', 'High'] }),
    q('Performance Materiality', 'Deficiencies in internal controls', 'dropdown', i++, { dropdownOptions: ['Low (50%)', 'Moderate (65%)', 'High (75%)'] }),
    q('Performance Materiality', 'First/second/third year audit by Firm', 'dropdown', i++, { dropdownOptions: ['Low (50%)', 'Moderate (65%)', 'High (75%)'] }),
    q('Performance Materiality', 'Report of fraud or higher risk of fraud', 'dropdown', i++, { dropdownOptions: ['Low (50%)', 'Moderate (65%)', 'High (75%)'] }),
    q('Performance Materiality', 'History of misstatements (corrected and uncorrected)', 'dropdown', i++, { dropdownOptions: ['Low (50%)', 'Moderate (65%)', 'High (75%)'] }),
    q('Performance Materiality', 'Level of turnover of senior management', 'dropdown', i++, { dropdownOptions: ['Low (50%)', 'Moderate (65%)', 'High (75%)'] }),
    q('Performance Materiality', "Management's preparedness/willingness to correct", 'dropdown', i++, { dropdownOptions: ['Low (50%)', 'Moderate (65%)', 'High (75%)'] }),
    q('Performance Materiality', 'Competency of management', 'dropdown', i++, { dropdownOptions: ['Low (50%)', 'Moderate (65%)', 'High (75%)'] }),
    q('Performance Materiality', 'Complexity of IT environment', 'dropdown', i++, { dropdownOptions: ['Low (50%)', 'Moderate (65%)', 'High (75%)'] }),
  ];
  await prisma.methodologyTemplate.create({ data: { firmId, templateType: 'materiality_questions', auditType: 'ALL', items: mat } });
  console.log('Materiality:', mat.length, 'questions');

  console.log('Done!');
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
