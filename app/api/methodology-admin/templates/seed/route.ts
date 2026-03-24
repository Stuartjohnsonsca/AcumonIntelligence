import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// Seed the methodology templates with the Excel template questions
// This runs once to populate the Methodology Admin Schedules

function q(sectionKey: string, questionText: string, inputType: string, sortOrder: number, opts?: { dropdownOptions?: string[] }) {
  return { id: `seed_${sortOrder}`, sectionKey, questionText, inputType, sortOrder, ...opts };
}

const PERMANENT_FILE_QUESTIONS = (() => {
  let i = 0;
  return [
    q('Entity Details', 'Contact', 'textarea', i++),
    q('Entity Details', 'Contact Email', 'text', i++),
    q('Entity Details', 'Address', 'textarea', i++),
    q('Entity Details', 'Group Companies', 'yesno', i++),
    q('Entity Details', 'Informed Management', 'textarea', i++),
    q('Understanding the Entity', 'Ownership and governance', 'textarea', i++),
    q('Understanding the Entity', 'Principal Activity and organisation structure', 'textarea', i++),
    q('Understanding the Entity', 'Changes from prior period or significant activities that took place during the year', 'textarea', i++),
    q('Understanding the Entity', 'Key Performance Indicators', 'textarea', i++),
    q('Understanding the Entity', 'Industry', 'textarea', i++),
    q('Understanding the Entity', 'Regulatory framework (whether the entity is registered or not)?', 'textarea', i++),
    q('Understanding the Entity', 'Financing', 'textarea', i++),
    q('Financial Reporting Framework', 'Applicable financial reporting framework', 'textarea', i++),
    q('Financial Reporting Framework', 'Significant accounting policies', 'textarea', i++),
    q('Financial Reporting Framework', 'Changes in accounting policies from prior year', 'textarea', i++),
    q('Financial Reporting Framework', 'Is Reporting currency different from functional currency', 'yesno', i++),
    q('Financial Reporting Framework', 'Reporting Currency', 'text', i++),
    q('Laws and Regulations', 'What is the legal and regulatory framework applicable to the entity and the industry or sector in which it operates?', 'textarea', i++),
    q('Laws and Regulations', 'Are there any indicators of non-compliance with laws and regulations?', 'textarea', i++),
    q('Laws and Regulations', 'Are there any ongoing litigations and claims against the Company?', 'textarea', i++),
    q('Related Parties', 'List below all known related parties, the nature of the relationship and the likely transactions.', 'textarea', i++),
    q('Related Parties', 'Assess the risk of material misstatement associated with related parties and determine whether these amount to significant risks.', 'textarea', i++),
    q('Related Parties', 'Are there any related relationships not identified by management?', 'textarea', i++),
    q('Related Parties', 'Directors - Name & Nature / Type and purpose of likely transactions', 'textarea', i++),
    q('Related Parties', 'Group entities (parent & affiliates) - Name & Nature / Type and purpose', 'textarea', i++),
    q('Related Parties', 'Other affiliates - Name & Nature / Type and purpose', 'textarea', i++),
    q('IT Environment', 'IT systems used by client', 'textarea', i++),
    q('IT Environment', 'Are these cloud based systems?', 'textarea', i++),
    q('IT Environment', 'Are these any customisation to the accounts software?', 'textarea', i++),
    q('IT Environment', 'List of members who has access to the system?', 'textarea', i++),
    q('IT Environment', 'Final conclusion on the complexity of the IT system', 'dropdown', i++, { dropdownOptions: ['Complex', 'Not Complex'] }),
    q('IT Environment', 'Provides list of reports where IPE procedures will be performed to test completeness and accuracy of the report.', 'textarea', i++),
    q('Accounting Estimates', 'List of accounting estimates relevant to the entity', 'textarea', i++),
    q('Accounting Estimates', 'Assess complexity of each accounting estimate considering the subjectivity and uncertainty involved', 'textarea', i++),
    q('Accounting Estimates', 'Explain control procedures in place relating to accounting estimates and how those charged with governance oversee the estimation process.', 'textarea', i++),
    q('Fraud Risk Analysis', 'Conclusion on the fraud risk assessment', 'textarea', i++),
    q('Fraud Risk Analysis', 'Confirm that fraud triangle covering incentive/pressures, opportunities and attitudes/rationalisation is considered as part of fraud risk assessment?', 'textarea', i++),
    q("Auditor's Expert", 'Did the audit team identify the need to involve audit experts / specialists in addressing the significant risk?', 'textarea', i++),
    q("Auditor's Expert", 'Explain in detail how audit team has assessed the competence and capabilities of Auditor Expert involved in the engagement', 'textarea', i++),
    q("Auditor's Expert", 'Has the audit team issued instructions to expert/specialist setting the scope of work?', 'textarea', i++),
    q("Auditor's Expert", 'Did audit team obtain confirmation with regard to compliance with FRC Ethical Standard 2024 of both Auditor Expert?', 'textarea', i++),
    q('Management Expert', 'With respect to the identified significant risk, did use management expert?', 'textarea', i++),
    q('Management Expert', 'Did the audit team obtain a copy of the engagement letter signed by the entity with management expert?', 'textarea', i++),
    q('Management Expert', 'Has the audit team issued instructions to expert/specialist setting the scope of work?', 'textarea', i++),
    q('Service Organisation', 'Provide list of service organisations and the nature and significance of the services provided', 'textarea', i++),
    q('Service Organisation', 'Did the audit team obtain a copy of the engagement letter signed by the entity with the service organisation?', 'textarea', i++),
    q('Service Organisation', 'Document your understanding of the effect on user entity internal control, nature and materiality of transactions processed, degree of interaction between activities of SO and entity.', 'textarea', i++),
    q('Service Organisation', 'Document your understanding of the control framework at the service organisation including those applied to the transactions processed.', 'textarea', i++),
  ];
})();

const ETHICS_QUESTIONS = (() => {
  let i = 0;
  return [
    // Non Audit Services
    q('Non Audit Services', 'Preparation of accounts', 'textarea', i++),
    q('Non Audit Services', 'Corporation Tax', 'textarea', i++),
    q('Non Audit Services', 'Advisory / Valuation Services', 'textarea', i++),
    q('Non Audit Services', 'Internal Audit', 'textarea', i++),
    q('Non Audit Services', 'Other Assurance', 'textarea', i++),
    q('Non Audit Services', 'Payroll', 'textarea', i++),
    q('Non Audit Services', 'VAT / Bookkeeping', 'textarea', i++),
    q('Non Audit Services', 'Recruitment, Legal & Litigation and IT Services', 'textarea', i++),
    // Threats
    q('Threats', 'Familiarity Threat of Audit Team', 'textarea', i++),
    q('Threats', 'Self Interest Threat', 'textarea', i++),
    q('Threats', 'Self-Review Threat', 'textarea', i++),
    q('Threats', 'Advocacy Threat', 'textarea', i++),
    q('Threats', 'Management Threat', 'textarea', i++),
    q('Threats', 'Intimidation Threat', 'textarea', i++),
    // Relationships
    q('Relationships', 'Financial relationship', 'textarea', i++),
    q('Relationships', 'Business relationship', 'textarea', i++),
    q('Relationships', 'Employment relationship', 'textarea', i++),
    q('Relationships', 'Personal relationship', 'textarea', i++),
    // Other Considerations
    q('Other Considerations', 'Litigation Threat', 'textarea', i++),
    q('Other Considerations', 'Gifts & Hospitality Threat', 'textarea', i++),
    q('Other Considerations', 'Remuneration of Audit team', 'textarea', i++),
    // Fee Assessment
    q('Fee Assessment', 'Audit Fee', 'currency', i++),
    q('Fee Assessment', 'Non-Audit Fee', 'currency', i++),
    q('Fee Assessment', 'Total Fees', 'currency', i++),
    q('Fee Assessment', 'Firm Fees', 'currency', i++),
    q('Fee Assessment', '% of Non-Audit Fee to Audit Fee', 'formula', i++),
    q('Fee Assessment', '% of Total Fees to Firm Fees', 'formula', i++),
    q('Fee Assessment', 'Overdue Fees from client', 'textarea', i++),
    // ORITP - Objective
    q('ORITP - Objective', 'Are any audit team members involved in bookkeeping or tax work?', 'yesno', i++),
    q('ORITP - Objective', 'Does the audit team rely solely on non-audit outputs?', 'yesno', i++),
    q('ORITP - Objective', 'Any personal/financial interests in the client?', 'yesno', i++),
    q('ORITP - Objective', 'Has professional skepticism been maintained?', 'yesno', i++),
    q('ORITP - Objective', 'Is audit judgment free from management influence?', 'yesno', i++),
    q('ORITP - Objective', 'Conclusion', 'dropdown', i++, { dropdownOptions: ['Threats mitigated. Audit team remains unbiased', 'Threats not fully mitigated. Audit team could be seen to be biased'] }),
    // ORITP - Reasonable
    q('ORITP - Reasonable', 'Are safeguards proportionate?', 'yesno', i++),
    q('ORITP - Reasonable', 'Are non-audit fees reasonable relative to audit fees?', 'yesno', i++),
    q('ORITP - Reasonable', 'Is segregation of audit and non-audit services evidenced?', 'yesno', i++),
    q('ORITP - Reasonable', 'Do services comply with ethical standards?', 'yesno', i++),
    q('ORITP - Reasonable', 'Have the Directors been informed?', 'yesno', i++),
    q('ORITP - Reasonable', 'Conclusion', 'dropdown', i++, { dropdownOptions: ['A prudent auditor would consider safeguards adequate.', 'A prudent auditor would be sceptical that safeguards adequate.'] }),
    // ORITP - Informed Third Party
    q('ORITP - Informed Third Party', 'Would an informed third party perceive independence as compromised?', 'yesno', i++),
    q('ORITP - Informed Third Party', 'Could stakeholders believe the firm is auditing its own work?', 'yesno', i++),
    q('ORITP - Informed Third Party', 'Would disclosure of non-audit services appear excessive?', 'yesno', i++),
    q('ORITP - Informed Third Party', 'Is there transparency in safeguards?', 'yesno', i++),
    q('ORITP - Informed Third Party', 'Could a regulator challenge the sufficiency of safeguards?', 'yesno', i++),
    q('ORITP - Informed Third Party', 'Conclusion', 'dropdown', i++, { dropdownOptions: ['An informed outsider would conclude independence is preserved.', 'An informed outsider would conclude independence is jeopardised.'] }),
  ];
})();

const CONTINUANCE_QUESTIONS = (() => {
  let i = 0;
  return [
    q('Entity Details', 'What type of audit client', 'dropdown', i++, { dropdownOptions: ['Limited Company', 'PIE', 'Charity'] }),
    q('Entity Details', 'Is the client listed?', 'dropdown', i++, { dropdownOptions: ['Limited Company', 'PIE', 'Charity'] }),
    q('Ownership', 'Discuss with management to assess if shareholders with more than 25% shareholding has changed during the year?', 'yes_only', i++),
    q('Ownership', 'Discuss with management to assess if there is any change Ultimate Beneficial Owners (UBO) during the year?', 'yes_only', i++),
    q('Ownership', 'For change in the shareholders (>25%) and UBO, did the audit team update the AML procedures?', 'yes_only', i++),
    q('Continuity', 'Prior Year Management Letter Points', 'dropdown', i++, { dropdownOptions: ['First Year of Audit', 'Our First Year of Audit', 'Existing Client from prior period'] }),
    q('Continuity', 'Internal control environment', 'dropdown', i++, { dropdownOptions: ['Functioning as designed', 'Partially Functioning as Designed', 'Not Functioning as Designed'] }),
    q('Continuity', 'Engagement Letter Signed Date', 'date', i++),
    q('Management Info', 'Discuss with management to assess if there is any changes in directors/trustees during the year?', 'yes_only', i++),
    q('Management Info', 'Are there any concerns over the skills and integrity of the owners, directors and management?', 'yes_only', i++),
    q('Management Info', "Assess management's skills and competence in relation to new directors", 'dropdown', i++, { dropdownOptions: ['Assessed as Competent', 'Assessed as Not Competent', 'Not Assessed'] }),
    q('Nature of Business', 'Is there any change in the principal activities of the entity during the year?', 'yes_only', i++),
    q('Nature of Business', 'Is there any change in the group structure of the entity?', 'yes_only', i++),
    q('Nature of Business', 'Has the entity established new subsidiaries in any of the non-co-operating countries?', 'yes_only', i++),
    q('Nature of Business', 'Is there any change in sources of funding in the year?', 'yes_only', i++),
    q('Nature of Business', 'Results of company search on Google and websites such as Companies House or Charity Commission', 'textarea', i++),
    q('Prior Year Financial Info', 'Is there any qualification included in the prior year audit report?', 'yesno', i++),
    q('Prior Year Financial Info', 'If yes, details of the qualification in the audit report including discussion with management', 'textarea', i++),
    q('Audit Risk Reassessment', 'Based on the current year activities, is there any change in the identified significant risks, areas of audit focus and key audit matters?', 'yes_only', i++),
    q('Audit Risk Reassessment', "Does this client fit with the firm's acceptable risk profile?", 'yes_only', i++),
    q('Fee Considerations', 'Is the proposed audit fee sufficient to deliver a high-quality audit?', 'yesno', i++),
    q('Fee Considerations', 'Is the audit or any other professional work being undertaken on a contingent fee basis?', 'yesno', i++),
    q('Fee Considerations', 'Do proposed total fees for the client / group of clients regularly exceed 15% (listed: 10%) of Group Revenue', 'textarea', i++),
    q('EQR', 'EQR on this engagement', 'yesno', i++),
    q('EQR', 'Any points relevant for RI consideration based on working with EQR in prior year audit?', 'textarea', i++),
    q('Discussion with MLRO', 'Is this a higher AML risk', 'yesno', i++),
    q('Discussion with MLRO', 'Summarise discussion with MLRO', 'textarea', i++),
    q('Discussion with MLRO', 'Did MLRO consent to accepting engagement', 'yesno', i++),
    q('Discussion with Partner/RI', 'Summarise discussion with Audit Partner/RI', 'textarea', i++),
    q('Discussion with Partner/RI', 'Did Audit Partner/RI consent to accepting engagement', 'yesno', i++),
    q('Final Conclusion', 'FINAL CONCLUSION', 'textarea', i++),
  ];
})();

const MATERIALITY_QUESTIONS = (() => {
  let i = 0;
  return [
    q('Benchmark', 'Materiality Benchmark', 'dropdown', i++, { dropdownOptions: ['Profit before Tax', 'Gross Profit', 'Total Revenue', 'Total Expenses', 'Total Equity or Net Assets', 'Total Assets'] }),
    q('Benchmark', 'Range %', 'number', i++),
    q('Benchmark', 'Current Year (%)', 'number', i++),
    q('Benchmark', 'Materiality (Current Year £)', 'currency', i++),
    q('Benchmark', 'Materiality (Prior Year £)', 'currency', i++),
    q('Benchmark', 'Performance Materiality (Current Year £)', 'currency', i++),
    q('Benchmark', 'Performance Materiality (Prior Year £)', 'currency', i++),
    q('Benchmark', 'Clearly Trivial (Current Year £)', 'currency', i++),
    q('Benchmark', 'Clearly Trivial (Prior Year £)', 'currency', i++),
    q('Benchmark Amounts', 'Profit before Tax (Current Year £)', 'currency', i++),
    q('Benchmark Amounts', 'Profit before Tax (Prior Year £)', 'currency', i++),
    q('Benchmark Amounts', 'Gross Profit (Current Year £)', 'currency', i++),
    q('Benchmark Amounts', 'Gross Profit (Prior Year £)', 'currency', i++),
    q('Benchmark Amounts', 'Total Revenue (Current Year £)', 'currency', i++),
    q('Benchmark Amounts', 'Total Revenue (Prior Year £)', 'currency', i++),
    q('Benchmark Amounts', 'Total Expenses (Current Year £)', 'currency', i++),
    q('Benchmark Amounts', 'Total Expenses (Prior Year £)', 'currency', i++),
    q('Benchmark Amounts', 'Total Equity or Net Assets (Current Year £)', 'currency', i++),
    q('Benchmark Amounts', 'Total Equity or Net Assets (Prior Year £)', 'currency', i++),
    q('Benchmark Amounts', 'Total Assets (Current Year £)', 'currency', i++),
    q('Benchmark Amounts', 'Total Assets (Prior Year £)', 'currency', i++),
    q('Justification', 'Justification for basis of materiality', 'textarea', i++),
    q('Justification', 'Stakeholders identified', 'textarea', i++),
    q('Justification', 'Document how audit team assessed the focus of stakeholders and justify the basis for selecting the benchmark', 'textarea', i++),
    q('Justification', 'Summarise key judgements and discussions of audit team in setting the materiality', 'textarea', i++),
    q('Justification', 'Is there any change in basis of materiality from prior year?', 'textarea', i++),
    q('Justification', 'Document the reasons that prompted the audit team to change basis for materiality in the year', 'textarea', i++),
    q('Overall Materiality Assessment', 'Is the company a public limited entity? Is it listed?', 'dropdown', i++, { dropdownOptions: ['Low', 'Mid', 'High'] }),
    q('Overall Materiality Assessment', 'Exposure to borrowing facilities', 'dropdown', i++, { dropdownOptions: ['Low', 'Mid', 'High'] }),
    q('Overall Materiality Assessment', 'Minimal number of shareholders', 'dropdown', i++, { dropdownOptions: ['Low', 'Mid', 'High'] }),
    q('Overall Materiality Assessment', 'Nature of Business (Highly regulated/Minimally regulated)', 'dropdown', i++, { dropdownOptions: ['Low', 'Mid', 'High'] }),
    q('Overall Materiality Assessment', 'Intention to get listed in the near future (3 years)', 'dropdown', i++, { dropdownOptions: ['Low', 'Mid', 'High'] }),
    q('Overall Materiality Assessment', 'Changes in the nature of business', 'dropdown', i++, { dropdownOptions: ['Low', 'Mid', 'High'] }),
    q('Performance Materiality', 'Deficiencies in internal controls (Number and severity of deficiencies in control activities)', 'dropdown', i++, { dropdownOptions: ['Low (50%)', 'Moderate (65%)', 'High (75%)'] }),
    q('Performance Materiality', 'First/second/third year audit by Firm', 'dropdown', i++, { dropdownOptions: ['Low (50%)', 'Moderate (65%)', 'High (75%)'] }),
    q('Performance Materiality', 'Report of fraud or higher risk of fraud within the entity', 'dropdown', i++, { dropdownOptions: ['Low (50%)', 'Moderate (65%)', 'High (75%)'] }),
    q('Performance Materiality', 'History of misstatements (corrected and uncorrected)', 'dropdown', i++, { dropdownOptions: ['Low (50%)', 'Moderate (65%)', 'High (75%)'] }),
    q('Performance Materiality', 'Level of turnover of senior management or key financial reporting personnel', 'dropdown', i++, { dropdownOptions: ['Low (50%)', 'Moderate (65%)', 'High (75%)'] }),
    q('Performance Materiality', "Management's preparedness/willingness to correct misstatements", 'dropdown', i++, { dropdownOptions: ['Low (50%)', 'Moderate (65%)', 'High (75%)'] }),
    q('Performance Materiality', 'Competency of management', 'dropdown', i++, { dropdownOptions: ['Low (50%)', 'Moderate (65%)', 'High (75%)'] }),
    q('Performance Materiality', 'Complexity of IT environment', 'dropdown', i++, { dropdownOptions: ['Low (50%)', 'Moderate (65%)', 'High (75%)'] }),
  ];
})();

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const firmId = session.user.firmId;
  const seeds = [
    { templateType: 'permanent_file_questions', items: PERMANENT_FILE_QUESTIONS },
    { templateType: 'ethics_questions', items: ETHICS_QUESTIONS },
    { templateType: 'continuance_questions', items: CONTINUANCE_QUESTIONS },
    { templateType: 'materiality_questions', items: MATERIALITY_QUESTIONS },
  ];

  const results = [];
  for (const seed of seeds) {
    // Only seed if no template exists for this type
    const existing = await prisma.methodologyTemplate.findFirst({
      where: { firmId, templateType: seed.templateType, auditType: 'ALL' },
    });
    if (existing) {
      results.push({ type: seed.templateType, status: 'exists', count: (existing.items as unknown[]).length });
      continue;
    }

    await prisma.methodologyTemplate.create({
      data: {
        firmId,
        templateType: seed.templateType,
        auditType: 'ALL',
        items: seed.items as unknown as any,
      },
    });
    results.push({ type: seed.templateType, status: 'created', count: seed.items.length });
  }

  return NextResponse.json({ success: true, results });
}
