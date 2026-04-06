/**
 * Seed Audit Summary Memo and Update Procedures templates.
 * These are structured completion schedule templates with multi-column table layouts.
 *
 * Usage: npx dotenv-cli -e .env.prod -- node scripts/seed-completion-templates.mjs
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

let qid = 0;
function q(sectionKey, questionText, opts = {}) {
  qid++;
  return {
    id: `asm_q${qid}`,
    sectionKey,
    questionText,
    inputType: opts.inputType || 'table_row',
    sortOrder: qid,
    isBold: opts.isBold || false,
    ...(opts.dropdownOptions && { dropdownOptions: opts.dropdownOptions }),
  };
}

// ═══ AUDIT SUMMARY MEMO ═══

const ASM_SECTION_META = {
  'Scope of Work': { key: 'Scope of Work', label: 'Scope of Work', layout: 'standard', signOff: false },
  'Materiality': { key: 'Materiality', label: 'Materiality', layout: 'table_5col', columnHeaders: ['Particulars', 'Planning Materiality (Amount)', 'Final Materiality (Amount)', 'Comment', 'WP Reference'], signOff: true },
  'Significant Risks': { key: 'Significant Risks', label: 'Significant Risks', layout: 'table_4col', columnHeaders: ['Identified Risk', 'Procedures Performed', 'Conclusion', 'WP Reference'], signOff: true },
  'Areas of Focus': { key: 'Areas of Focus', label: 'Areas of Focus', layout: 'table_4col', columnHeaders: ['Identified Area of Focus', 'Procedures Performed', 'Conclusion', 'WP Reference'], signOff: true },
  'Accounting Estimates': { key: 'Accounting Estimates', label: 'Accounting Estimates (not identified as significant risk above)', layout: 'table_4col', columnHeaders: ['Estimate', 'Procedures Performed', 'Conclusion', 'WP Reference'], signOff: true },
  'Management Bias': { key: 'Management Bias', label: 'Management Bias', layout: 'standard', signOff: false },
  'Other Areas': { key: 'Other Areas', label: 'Other Areas', layout: 'table_4col', columnHeaders: ['Issues Identified', 'How the Matter Was Resolved', 'Conclusion', 'WP Reference'], signOff: true },
  'Consultation': { key: 'Consultation', label: 'Consultation and Difference of Opinion', layout: 'table_4col', columnHeaders: ['Issues Requiring Consultation', 'How the Matter Was Resolved', 'Conclusion', 'WP Reference'], signOff: true },
  'Going Concern': { key: 'Going Concern', label: 'Going Concern', layout: 'table_3col', columnHeaders: ['Particulars', 'Audit Team Response', 'WP Reference'], signOff: true },
  'Analytical Review': { key: 'Analytical Review', label: 'Analytical Review', layout: 'table_4col', columnHeaders: ['Issues Identified', 'How the Matter Was Resolved', 'Conclusion', 'WP Reference'], signOff: true },
  'Independence and Ethics': { key: 'Independence and Ethics', label: 'Independence and Ethical Issues', layout: 'table_4col', columnHeaders: ['Issues Identified (including non-audit services)', 'How the Matter Was Resolved / Safeguards Implemented', 'Conclusion', 'WP Reference'], signOff: true },
  'Opening Balances': { key: 'Opening Balances', label: 'Opening Balances and Consistency of Accounting Policies', layout: 'table_3col', columnHeaders: ['Particulars', 'Audit Team Response', 'WP Reference'], signOff: true },
  'Communications with TCWG': { key: 'Communications with TCWG', label: 'Communications with Management and Those Charged with Governance', layout: 'table_3col', columnHeaders: ['Particulars', 'Audit Team Response', 'WP Reference'], signOff: true },
  'Subsequent Events': { key: 'Subsequent Events', label: 'Subsequent Events', layout: 'table_3col', columnHeaders: ['Particulars', 'Audit Team Response', 'WP Reference'], signOff: true },
  'Review of Other Information': { key: 'Review of Other Information', label: 'Review of Other Information', layout: 'table_3col', columnHeaders: ['Particulars', 'Audit Team Response', 'WP Reference'], signOff: true },
  'Financial Statements and Disclosures': { key: 'Financial Statements and Disclosures', label: 'Financial Statements and Disclosures', layout: 'table_3col', columnHeaders: ['Particulars', 'Audit Team Response', 'WP Reference'], signOff: true },
  'Audit Opinion': { key: 'Audit Opinion', label: 'Audit Opinion', layout: 'table_3col', columnHeaders: ['Particulars', 'Audit Team Response', 'WP Reference'], signOff: true },
};

const ASM_QUESTIONS = [
  // Scope of Work
  q('Scope of Work', 'Provide a summary of the scope of work performed, including any limitations.', { inputType: 'textarea' }),

  // Materiality
  q('Materiality', 'Overall materiality'),
  q('Materiality', 'Performance materiality'),
  q('Materiality', 'Clearly Trivial Threshold'),
  q('Materiality', 'Confirm that for the change in the materiality identified, audit team has reassessed the nature, timing and extent of the audit procedures have been reassessed to confirm that sufficient appropriate audit evidence is obtained to support the audit opinion?', { inputType: 'textarea' }),

  // Significant Risks
  q('Significant Risks', 'Revenue recognition'),
  q('Significant Risks', 'Management Override of controls'),

  // Areas of Focus
  q('Areas of Focus', 'Going concern'),
  q('Areas of Focus', 'Amount owed by group undertakings'),
  q('Areas of Focus', 'Recoverability of Loan balances'),

  // Accounting Estimates
  q('Accounting Estimates', 'Impairment of Tangible Assets'),
  q('Accounting Estimates', 'Impairment of Investment in subsidiary'),
  q('Accounting Estimates', 'Has the audit team identified any management bias in relation to all identified accounting estimates and judgements? If yes, document how the matter has been addressed.', { inputType: 'textarea' }),

  // Management Bias
  q('Management Bias', 'Has the audit team identified any management bias in relation to all identified accounting estimates and judgements? If yes, document how the matter has been addressed.', { inputType: 'textarea' }),

  // Going Concern
  q('Going Concern', 'Procedures performed'),
  q('Going Concern', "Key estimates & judgement in management's going concern assessment"),
  q('Going Concern', 'Has the audit team obtained appropriate evidence with respect to the estimates and judgements identified above?'),
  q('Going Concern', 'Conclusion reached by the audit team on the G.C and its impact on the audit opinion'),
  q('Going Concern', 'Going concern conclusion to be included in the audit report (select as appropriate)', { inputType: 'dropdown', dropdownOptions: ['No material uncertainty', 'Material uncertainty - adequate disclosure', 'Material uncertainty - inadequate disclosure', 'Going concern basis inappropriate'] }),

  // Analytical Review
  q('Analytical Review', 'Highlight key points noted from the final analytical review', { inputType: 'textarea' }),

  // Independence and Ethics
  q('Independence and Ethics', 'Summarise the ethical issues identified by the audit team and how the planned safeguards', { inputType: 'textarea' }),
  q('Independence and Ethics', 'Has the audit team obtained independence confirmation from all members of the audit team including auditors experts as relevant?'),

  // Opening Balances
  q('Opening Balances', 'Has the audit team restated the opening balances?'),
  q('Opening Balances', 'Has the audit team identified any misstatements in the opening balances that has impact on the current year audit?'),
  q('Opening Balances', 'Have there been any changes to the accounting policies compared to the prior year? If so, please record the changes along with the reasons for them'),

  // Communications with TCWG
  q('Communications with TCWG', 'Is management different from those charged with governance?'),
  q('Communications with TCWG', 'Has the audit team identified any significant deficiencies in internal controls that require to be communicated to management and those charged with governance?'),
  q('Communications with TCWG', 'Has the audit team communicated both corrected and uncorrected misstatements to both management and those charged with governance?'),
  q('Communications with TCWG', 'Has the audit team prepared "Management letter/letter of comment" for issuing to management / those charged with governance?'),

  // Subsequent Events
  q('Subsequent Events', 'Has the audit team identified any subsequent events that require adjustment to or disclosure in the financial statements?'),

  // Review of Other Information
  q('Review of Other Information', "Which sections of the financial statements are included under 'Other Information'? (e.g. Strategic Report, Director's Report)"),
  q('Review of Other Information', 'Has the audit team reviewed the other information and confirmed its consistency with the financial statements?'),

  // Financial Statements and Disclosures
  q('Financial Statements and Disclosures', 'Has the audit team verified that the financial statements agree with the lead sheet in the workpapers?'),
  q('Financial Statements and Disclosures', 'Has the audit team confirmed that the financial statement disclosures comply with the applicable financial reporting framework?'),

  // Audit Opinion
  q('Audit Opinion', "Proposed audit opinion to be issued on the entity's financial statements", { inputType: 'dropdown', dropdownOptions: ['Unmodified opinion', 'Qualified opinion - except for', 'Adverse opinion', 'Disclaimer of opinion'] }),
];

// ═══ UPDATE PROCEDURES ═══

qid = 0; // Reset counter

const UP_SECTION_META = {
  'Subsequent Events': { key: 'Subsequent Events', label: 'Subsequent Events', layout: 'table_4col', columnHeaders: ['Procedure', 'Audit Team Response', 'Audit Team Comment', 'WP Ref'], signOff: true },
  'Going Concern': { key: 'Going Concern', label: 'Going Concern', layout: 'table_4col', columnHeaders: ['Procedure', 'Audit Team Response', 'Audit Team Comment', 'WP Ref'], signOff: true },
  'Accounting Estimates': { key: 'Accounting Estimates', label: 'Accounting Estimates and Judgements', layout: 'table_4col', columnHeaders: ['Procedure', 'Audit Team Response', 'Audit Team Comment', 'WP Ref'], signOff: true },
  'Fraud Update': { key: 'Fraud Update', label: 'Fraud Update and Evaluation', layout: 'table_4col', columnHeaders: ['Procedure', 'Audit Team Response', 'Audit Team Comment', 'WP Ref'], signOff: true },
};

function uq(sectionKey, questionText, opts = {}) {
  qid++;
  return {
    id: `up_q${qid}`,
    sectionKey,
    questionText,
    inputType: opts.inputType || 'table_row',
    sortOrder: qid,
    isBold: opts.isBold || false,
  };
}

const UP_QUESTIONS = [
  // Subsequent Events
  uq('Subsequent Events', 'Confirm that the audit team has obtained the final confirmation of subsequent events from management on the date of signing the audit report.'),
  uq('Subsequent Events', 'Confirm that the audit team has performed subsequent events procedures until the date of the audit report.'),
  uq('Subsequent Events', 'Confirm that the subsequent events are appropriately reflected in the financial statements in accordance with the financial reporting framework (e.g. whether events reflect conditions that existed at the balance sheet date (adjusting events) or whether conditions arose after the balance sheet date (non-adjusting events)).'),
  uq('Subsequent Events', 'Conclusion', { isBold: true }),
  uq('Subsequent Events', 'Confirm that the audit team has obtained sufficient and appropriate evidence regarding the identified subsequent events.'),
  uq('Subsequent Events', 'Where the audit team has not obtained sufficient audit evidence, assess the impact on the audit opinion (if any)'),

  // Going Concern
  uq('Going Concern', "Confirm that the management's going concern assessment still covers at least 12 months from the date of approval of financial statements?"),
  uq('Going Concern', 'Perform inquiries with management whether any information, events or circumstances have been identified that require the re-assessment of the going concern assessment. Perform inquiries with management if any known events or conditions are identified beyond the going concern assessment period which has an impact on the going concern.'),
  uq('Going Concern', "Consider if there is a significant delay in management's approval of the financial statements and, if so, is this related to events or conditions which impact the going concern assessment."),
  uq('Going Concern', 'Confirm whether the audit team has obtained sufficient appropriate evidence (including for the additional events identified above) to support the conclusions reached on the going concern.'),
  uq('Going Concern', 'Assess whether any judgements and decisions made by management, individually or collectively, indicate potential management bias. Where such indicators exist, evaluate their implications for the audit.'),
  uq('Going Concern', 'Conclusion', { isBold: true }),
  uq('Going Concern', "Confirm whether the audit team has identified any material uncertainty in relation to the entity's going concern?"),
  uq('Going Concern', "Management's use of going concern basis of accounting in the preparation of financial statements is appropriate?"),
  uq('Going Concern', "Management's disclosures in the financial statements relating to the going concern are considered appropriate?"),
  uq('Going Concern', 'Going concern conclusion to be included in the audit report (select as appropriate)'),

  // Accounting Estimates
  uq('Accounting Estimates', 'Document the list of key accounting estimates and judgements identified by the audit team.'),
  uq('Accounting Estimates', 'Confirm that the audit team has reviewed all key accounting estimates and judgements and assessed whether they are in line with the applicable financial reporting framework.'),
  uq('Accounting Estimates', 'Document audit team assessment of management bias (if any) in relation to judgements and decisions, individually and in aggregate.'),
  uq('Accounting Estimates', 'Confirm whether sufficient appropriate audit evidence, whether corroborative or contradictory, has been obtained. Where sufficient appropriate audit evidence has not been obtained, evaluate the implications for the audit and our audit report.'),
  uq('Accounting Estimates', 'Assess whether there are any representations that need to be obtained about specific key accounting estimates, including in relation to the methods, assumptions or data used.'),
  uq('Accounting Estimates', 'Document those matters that required to be communicated to those charged with governance in connection with accounting estimates.'),
  uq('Accounting Estimates', 'Conclusion', { isBold: true }),
  uq('Accounting Estimates', 'Audit team conclusion on the accounting estimates and related disclosures in the context of applicable financial reporting framework.'),
  uq('Accounting Estimates', 'Assess the implications for the audit opinion based on the conclusions reached by the audit team in relation to key accounting estimates.'),

  // Fraud Update
  uq('Fraud Update', 'Confirm that the audit team has enquired of management and others within the entity, as appropriate, to determine whether they have knowledge of any actual, suspected or alleged fraud affecting the entity? (This includes inquiries with those who deal with allegations, if any, of fraud raised by employees or other parties).'),
  uq('Fraud Update', 'Confirm management override of controls has been appropriately tested and that other audit procedures have been performed as necessary to respond to the identified risks?'),
  uq('Fraud Update', 'Confirm that where any audit procedures have uncovered matters which may indicate fraud or error, we revised our risk assessment, extended our procedures, recorded and reported as required?'),
  uq('Fraud Update', 'Evaluation of misstatements', { isBold: true }),
  uq('Fraud Update', 'Have any misstatements been identified that are indicative of fraud?'),
  uq('Fraud Update', 'If a misstatement has been identified due to fraud or suspected fraud, are specialised skills or knowledge needed to investigate further for the purposes of the audit?'),
  uq('Fraud Update', 'Has a misstatement been identified, whether material or not, that we have a reason to believe is or may be the result of fraud and that management (in particular, senior management) is involved?'),
  uq('Fraud Update', 'Fraud checks on the evidence obtained during the audit', { isBold: true }),
  uq('Fraud Update', 'Have any conditions identified during the audit caused us to believe that a record or document may not be authentic or that terms within have been modified with no disclosure to us?'),
  uq('Fraud Update', 'Are responses to inquiries of management, those charged with governance or others within the entity inconsistent or appear implausible? (If such instances noted, these should be discussed with RI and a further investigation is required)'),
  uq('Fraud Update', 'Have we encountered exceptional circumstances, as a result of a misstatement resulting from fraud or suspected fraud, that bring into question our ability to continue performing the audit?'),
  uq('Fraud Update', 'Conclusion', { isBold: true }),
  uq('Fraud Update', 'Do the assessments of the risks of material misstatement at the assertion level remain appropriate?'),
  uq('Fraud Update', 'Has sufficient, appropriate audit evidence been obtained regarding the assessed risks of material misstatement due to fraud?'),
  uq('Fraud Update', 'Are the financial statements free from material misstatement as a result of fraud?'),
];

// ═══ AUDIT COMPLETION CHECKLIST ═══

qid = 0;

function cq(sectionKey, questionText, ref, opts = {}) {
  qid++;
  return {
    id: `cc_q${qid}`,
    sectionKey,
    questionText,
    inputType: opts.inputType || 'table_row',
    sortOrder: qid,
    isBold: opts.isBold || false,
    crossRef: ref || undefined,
  };
}

const CC_SECTION_META = {
  'Planning Review': { key: 'Planning Review', label: 'Planning Review', layout: 'table_4col', columnHeaders: ['S No', 'Procedure', 'Audit Team Response', 'WP Ref / Comments'], signOff: true },
  'Significant Risk Areas': { key: 'Significant Risk Areas', label: 'Significant Risk Areas', layout: 'table_4col', columnHeaders: ['S No', 'Procedure', 'Audit Team Response', 'WP Ref / Comments'], signOff: true },
  'Related Parties': { key: 'Related Parties', label: 'Related Parties', layout: 'table_4col', columnHeaders: ['S No', 'Procedure', 'Audit Team Response', 'WP Ref / Comments'], signOff: true },
  'Key Accounting Estimates': { key: 'Key Accounting Estimates', label: 'Key Accounting Estimates and Related Disclosures', layout: 'table_4col', columnHeaders: ['S No', 'Procedure', 'Audit Team Response', 'WP Ref / Comments'], signOff: true },
  'Evidence': { key: 'Evidence', label: 'Evidence', layout: 'table_4col', columnHeaders: ['S No', 'Procedure', 'Audit Team Response', 'WP Ref / Comments'], signOff: true },
  'External Confirmations': { key: 'External Confirmations', label: 'External Confirmations and Use of Others', layout: 'table_4col', columnHeaders: ['S No', 'Procedure', 'Audit Team Response', 'WP Ref / Comments'], signOff: true },
  'Misstatements': { key: 'Misstatements', label: 'Misstatements', layout: 'table_4col', columnHeaders: ['S No', 'Procedure', 'Audit Team Response', 'WP Ref / Comments'], signOff: true },
  'Sufficiency of Evidence': { key: 'Sufficiency of Evidence', label: 'Sufficiency of Evidence', layout: 'table_4col', columnHeaders: ['S No', 'Procedure', 'Audit Team Response', 'WP Ref / Comments'], signOff: true },
  'Compliance': { key: 'Compliance', label: 'Compliance', layout: 'table_4col', columnHeaders: ['S No', 'Procedure', 'Audit Team Response', 'WP Ref / Comments'], signOff: true },
  'Client Service': { key: 'Client Service', label: 'Client Service', layout: 'table_4col', columnHeaders: ['S No', 'Procedure', 'Audit Team Response', 'WP Ref / Comments'], signOff: true },
  'Client Communication': { key: 'Client Communication', label: 'Client Communication', layout: 'table_4col', columnHeaders: ['S No', 'Procedure', 'Audit Team Response', 'WP Ref / Comments'], signOff: true },
  'Summary for RI': { key: 'Summary for RI', label: 'Summary for Responsible Individual', layout: 'table_4col', columnHeaders: ['S No', 'Procedure', 'Audit Team Response', 'WP Ref / Comments'], signOff: true },
  'Conclusion': { key: 'Conclusion', label: 'Conclusion', layout: 'standard', signOff: true },
};

const CC_QUESTIONS = [
  // Planning Review
  cq('Planning Review', 'Has the audit team updated and changed the overall audit strategy and/or the audit plan as necessary during the course of the audit and documented the reasons for such changes?', 'ISA 300.10, 300.12'),
  cq('Planning Review', 'If there was a change to the engagement terms, was it supported by a reasonable justification and confirmed in writing?', 'ISA 210.14-16'),
  cq('Planning Review', 'Was the audit scope free from all restrictions?', 'ISA 210.17 / ISA 220.13'),
  cq('Planning Review', 'Have we updated the materiality schedule for the actual results and, where the levels set at the planning stage are no longer deemed appropriate, has this been reflected in further work performed?', 'ISA 320.12-13'),
  cq('Planning Review', 'Have we confirmed the design and implementation of relevant controls?', 'ISA 315.26'),
  cq('Planning Review', 'Where required as part of the audit approach, have we tested that key control activities have operated effectively?', 'ISA 330.8'),
  cq('Planning Review', 'Where we have tested and relied upon the operating effectiveness of controls but we detected misstatements as part of our substantive procedures that indicate the control was not operating effectively, have we revised our approach accordingly?', 'ISA 330.16'),
  cq('Planning Review', 'Where we carried out interim audit procedures (whether substantive or controls testing) have we confirmed whether there were any significant changes and obtained sufficient evidence for the remaining period?', 'ISA 330.12&22'),
  cq('Planning Review', 'Where new information is obtained which is inconsistent with the audit evidence on which we originally based the identification or assessments of the risks of material misstatement, have we revised the identification or assessment and amended our plans accordingly?', 'ISA 315.37 / ISA 330.17&23'),
  cq('Planning Review', '[For initial engagements only] Were we able to obtain sufficient appropriate audit evidence regarding the opening balances in accordance with our plans?', 'ISA 510.6'),
  cq('Planning Review', '[For initial engagements only] Were we able to obtain sufficient appropriate audit evidence regarding the comparatives?', 'ISA 510.8'),
  cq('Planning Review', 'Was the audit conducted in accordance with the plans, were all points noted at the planning stage properly considered in the audit and do the assessments of risks of material misstatement at the assertion level remain appropriate?', 'ISA 330.25'),

  // Significant Risk Areas
  cq('Significant Risk Areas', 'For areas identified as significant risks, have we either: a. Tested the operating effectiveness of key controls supplemented by substantive procedures; OR b. Performed substantive procedures only (consisting of more than just analytical procedures)?', 'ISA 330.21'),
  cq('Significant Risk Areas', 'Has the fraud update and evaluation been completed?', 'ISA 240.33, ISA 330.20'),

  // Related Parties
  cq('Related Parties', 'Where we have obtained information indicating the existence of previously unidentified related party relationships and transactions, have we: a. Shared relevant information with other team members; b. Obtained further information from management; c. Extended our substantive procedures; d. Revised our risk assessment; and e. (Where the non-disclosure by management appears intentional) revised our assessment of risk due to fraud?', 'ISA 550.17, ISA 22'),
  cq('Related Parties', 'Where we have identified significant transactions outside the entity\'s normal course of business, have we enquired about the nature of these transactions and whether related parties could be involved?', 'ISA 550.16'),

  // Key Accounting Estimates
  cq('Key Accounting Estimates', 'Have we separately assessed inherent and control risk to identify and assess the risk of material misstatement at the assertion level?', 'ISA 540.16'),
  cq('Key Accounting Estimates', 'If we have significant risks in relation to accounting estimates, have we obtained an understanding of the entity\'s controls, including control activities relevant to the significant risk?', 'ISA 540.17'),
  cq('Key Accounting Estimates', 'If we planned to rely on controls, have we designed and performed tests of controls in the current period? If we planned to perform only substantive procedures, did we include tests of details?', 'ISA 540.20'),
  cq('Key Accounting Estimates', 'If we have concluded that management had not fully understood or addressed estimation uncertainty, have we requested management to perform additional procedures and considered if an internal control deficiency exists?', 'ISA 540.27-30'),
  cq('Key Accounting Estimates', 'Have we concluded on whether disclosures in the financial statements related to accounting estimates are reasonable and free from material misstatement?', 'ISA 540.31'),
  cq('Key Accounting Estimates', 'Have we evaluated whether management\'s judgments and decisions in making accounting estimates are indicators of possible management bias?', 'ISA 540.32'),
  cq('Key Accounting Estimates', 'Have we undertaken an overall evaluation of accounting estimates based on the audit procedures performed?', null),

  // Evidence
  cq('Evidence', 'Where the answer to any of questions in planning review above was \'No\', have additional procedures been undertaken?', null),
  cq('Evidence', 'Have all important matters been documented, particularly the nature and extent of procedures, reasoning on matters of judgment and conclusions?', 'ISA 230.8-8D'),
  cq('Evidence', 'Where evidence is inconsistent or we have doubts over the reliability of information used as evidence, have we undertaken modified or additional procedures to resolve the matter?', 'ISA 230.11 / 500.11'),
  cq('Evidence', 'Has proper consultation taken place on all difficult and contentious areas and are the conclusions reached reasonable?', 'ISA 220.18'),
  cq('Evidence', 'Have final analytical procedures been undertaken and comments on significant fluctuations or unexpected relationships been recorded?', 'ISA 520.6'),
  cq('Evidence', 'Where any audit procedures have uncovered matters which may indicate non-compliance with laws and regulations, have we gathered the necessary further information?', 'ISA 250A.21'),
  cq('Evidence', 'Where sufficient information on suspected non-compliance could not be obtained, have we evaluated the effect on the auditor\'s opinion?', 'ISA 330.30'),
  cq('Evidence', 'Where risks were identified in relation to disclosures, has appropriate evidence been obtained?', 'ISA 560.6'),
  cq('Evidence', 'Has the subsequent events section been completed?', null),
  cq('Evidence', 'Have all going concern matters been discussed with management and all discussions documented?', 'ISA 570.11'),
  cq('Evidence', 'Have we obtained sufficient evidence concerning opening balances and comparative information?', 'ISA 510.6 / 710.8'),
  cq('Evidence', 'Have any significant matters related to restrictions on access to people or information been documented?', 'ISA 600.59'),
  cq('Evidence', 'Have we retained sufficient appropriate audit documentation to enable the competent authority to review our work?', 'ISA 600.59-2'),

  // External Confirmations
  cq('External Confirmations', 'Have responses from all necessary external confirmation requests been received? If not, have we performed alternative procedures?', 'ISA 505.12'),
  cq('External Confirmations', 'Where we have doubts as to the reliability of a response, have we obtained further evidence to resolve the doubt?', 'ISA 505.10-11'),
  cq('External Confirmations', 'Do the results of the external confirmation procedures provide relevant and reliable audit evidence?', 'ISA 505.16'),
  cq('External Confirmations', 'Where use has been made of the work performed by an auditor\'s expert, have we confirmed that the evidence is adequate?', 'ISA 620.12-13'),
  cq('External Confirmations', 'Where relevant activities have been outsourced has sufficient evidence been obtained from the service organisation?', 'ISA 402.15'),
  cq('External Confirmations', 'Where the entity has an internal audit function, have we fulfilled the relevant requirements?', 'ISA 610.15-37'),

  // Misstatements
  cq('Misstatements', 'Has the summary of misstatements schedule been completed recording all identified misstatements other than those that are clearly trivial?', 'ISA 450.5'),
  cq('Misstatements', 'Does this summary include all unadjusted misstatements brought forward from the previous period which do not reverse?', 'ISA 450.11b'),
  cq('Misstatements', 'Where the aggregate of misstatements approaches materiality, have we revised the audit strategy and plan as appropriate?', 'ISA 450.6'),
  cq('Misstatements', 'Where management have further examined and corrected transactions following identified misstatements, have we performed sufficient additional procedures?', 'ISA 450.7'),
  cq('Misstatements', 'Where misstatements indicate a deficiency in internal control have we considered their significance and communicated them?', 'ISA 265.8&9'),
  cq('Misstatements', 'For all unadjusted misstatements, have we obtained a written representation from management confirming immateriality?', 'ISA 450.14'),

  // Sufficiency of Evidence
  cq('Sufficiency of Evidence', 'Has sufficient appropriate audit evidence been obtained from the audit procedures performed, including from component auditors, on which to base the audit opinion?', 'ISA 600.51'),

  // Compliance
  cq('Compliance', 'Have the statutory accounts, directors\' report, and other information been drafted and referenced to the audit schedules?', null),
  cq('Compliance', 'Has a Companies Accounts disclosure checklist been completed?', null),
  cq('Compliance', 'Have we ensured that the directors\' report, strategic report and other information are materially consistent with the financial statements?', null),
  cq('Compliance', 'Have we ensured that information does not otherwise appear to be materially misstated?', 'ISA 720.14-15'),
  cq('Compliance', 'Have we ensured that the reports have been prepared in accordance with applicable legal and regulatory requirements?', 'ISA 720.14-1'),
  cq('Compliance', 'Have all ethical issues identified been summarised for the Responsible Individual?', null),
  cq('Compliance', 'Have we considered the need to complete or update customer due diligence procedures?', null),
  cq('Compliance', 'Have all staff acted in accordance with the firm\'s anti-money laundering procedures?', null),
  cq('Compliance', 'Where an objective of one or more ISAs cannot be achieved, have we highlighted this as a significant matter?', 'ISA 200.24'),
  cq('Compliance', 'Where we have determined additional audit procedures are necessary, have we obtained sufficient appropriate evidence?', 'ISA 200.21'),

  // Client Service
  cq('Client Service', 'Have we considered whether we can make any useful recommendations to the client?', null),
  cq('Client Service', 'Have we considered the impact of future legislative and financial reporting changes?', null),

  // Client Communication
  cq('Client Communication', 'Has the report to management been drafted and discussed with client\'s management and those charged with governance?', 'ISA 260.14-16'),
  cq('Client Communication', 'Have the written representations of management been drafted? Do they include all confirmations necessary?', 'ISA 580.9'),
  cq('Client Communication', 'Where we have doubts as to the reliability of written representations, have we revised our assessments?', 'ISA 580.16-18'),
  cq('Client Communication', 'Where one or more requested written representations have not been provided, have we discussed the matter with management?', 'ISA 580.19'),
  cq('Client Communication', 'Have we asked those providing management representations what steps they have taken to obtain comfort?', null),
  cq('Client Communication', 'Has the two-way communication between the auditor and those charged with governance been adequate?', 'ISA 260.22'),
  cq('Client Communication', 'Where we identify or suspect fraud and/or non-compliance, have we considered whether there is a responsibility to report to an external third party?', 'ISA 240.44/250A.29'),
  cq('Client Communication', 'Where we have not been provided with sufficient information on compliance, have we considered obtaining legal advice?', 'ISA 250A.20'),
  cq('Client Communication', 'Where a possible or actual breach of the Ethical Standard has been identified, has this been appropriately communicated?', 'ES 1.21'),

  // Summary for RI
  cq('Summary for RI', 'Have points for Responsible Individual clearance or an Audit Summary memorandum been drafted?', null),

  // Conclusion
  cq('Conclusion', 'All matters above have been properly addressed.', null, { inputType: 'yesno' }),
];

// ═══ OVERALL REVIEW OF THE FS ═══

qid = 0;

function oq(questionText, opts = {}) {
  qid++;
  return {
    id: `or_q${qid}`,
    sectionKey: 'Evaluate Whether',
    questionText,
    inputType: opts.inputType || 'table_row',
    sortOrder: qid,
    isBold: opts.isBold || false,
  };
}

const OR_SECTION_META = {
  'Evaluate Whether': { key: 'Evaluate Whether', label: 'Evaluate Whether', layout: 'table_5col', columnHeaders: ['S No', 'Procedure', 'Completed', 'WP Ref', 'Comments'], signOff: true },
  'Conclusion': { key: 'Conclusion', label: 'Conclusion', layout: 'standard', signOff: true },
};

const OR_QUESTIONS = [
  oq('Our documentation records how the financial statements agree or reconcile with the underlying accounting records.'),
  oq('The financial statements adequately reflect the information and explanations previously obtained and conclusions reached during the course of the audit.'),
  oq('The procedures reveal any new factors which may affect presentation or disclosure.'),
  oq('The results of final analytical procedures applied show that the financial statements are consistent with our knowledge of the entity\'s business.'),
  oq('Such review indicates previously unrecognised risk of material misstatement due to fraud. If applicable, refer to notes on Audit Summary Memo and Final Analytical Procedures.'),
  oq('The financial statements properly reflect matters which may have been unduly influenced by the desire of those charged with governance to present matters in a favourable or unfavourable light.'),
  oq('The aggregate of uncorrected misstatements identified during the course of the audit has an impact on the financial statements or indicates deficiencies in internal controls.'),
  oq('The information presented in the financial statements is in accordance with statutory requirements.'),
  oq('The terminology used in the financial statements, including the title of each financial statement is appropriate.'),
  oq('The accounting policies employed are in accordance with accounting standards, properly disclosed, consistently applied, appropriate, relevant to the entity and presented in an understandable manner.'),
  oq('The financial statements adequately refer to or describe the applicable financial reporting framework.'),
  oq('Comparative information has been agreed with the amounts and other disclosures presented in the preceding period.'),
  oq('Any necessary departures from applicable accounting standards for the financial statements to give a true and fair view, have been properly reflected.'),
  oq('The financial statements provide adequate disclosures to enable users to understand the effect of material transactions and events.'),
  oq('The financial statements include any additional disclosures necessary to give a true and fair view.'),
  oq('The financial statements reflect the substance of the underlying transactions and not merely their form.'),
  oq('Accounting estimates made by management appear reasonable and free from bias and from any indicators of fraud.'),
  oq('Any disclosures are misleading or whether the presentation or inclusion of irrelevant information obscures a proper understanding of matters disclosed.'),
  oq('The directors\' report, and other information in the annual report: a. are consistent with the financial statements; b. are free from material misstatement; and c. have been prepared in accordance with applicable legal and regulatory requirements.'),
  oq('The overall presentation of the financial statements is in accordance with the applicable financial reporting framework, including: classification, structure, content, qualitative aspects, and whether the financial statements achieve fair presentation.'),
  { id: 'or_conclusion', sectionKey: 'Conclusion', questionText: 'The audit objective above has been achieved and in my opinion the conclusions a reader might draw from these financial statements are justified.', inputType: 'yesno', sortOrder: 100, isBold: false },
];

async function main() {
  const firms = await prisma.firm.findMany({ select: { id: true, name: true } });

  for (const firm of firms) {
    // Audit Summary Memo
    await prisma.methodologyTemplate.upsert({
      where: { firmId_templateType_auditType: { firmId: firm.id, templateType: 'audit_summary_memo_questions', auditType: 'ALL' } },
      create: {
        firmId: firm.id,
        templateType: 'audit_summary_memo_questions',
        auditType: 'ALL',
        items: { questions: ASM_QUESTIONS, sectionMeta: ASM_SECTION_META },
      },
      update: {
        items: { questions: ASM_QUESTIONS, sectionMeta: ASM_SECTION_META },
      },
    });
    console.log(`  Seeded Audit Summary Memo for "${firm.name}"`);

    // Update Procedures
    await prisma.methodologyTemplate.upsert({
      where: { firmId_templateType_auditType: { firmId: firm.id, templateType: 'update_procedures_questions', auditType: 'ALL' } },
      create: {
        firmId: firm.id,
        templateType: 'update_procedures_questions',
        auditType: 'ALL',
        items: { questions: UP_QUESTIONS, sectionMeta: UP_SECTION_META },
      },
      update: {
        items: { questions: UP_QUESTIONS, sectionMeta: UP_SECTION_META },
      },
    });
    console.log(`  Seeded Update Procedures for "${firm.name}"`);

    // Completion Checklist
    await prisma.methodologyTemplate.upsert({
      where: { firmId_templateType_auditType: { firmId: firm.id, templateType: 'completion_checklist_questions', auditType: 'ALL' } },
      create: {
        firmId: firm.id,
        templateType: 'completion_checklist_questions',
        auditType: 'ALL',
        items: { questions: CC_QUESTIONS, sectionMeta: CC_SECTION_META },
      },
      update: {
        items: { questions: CC_QUESTIONS, sectionMeta: CC_SECTION_META },
      },
    });
    console.log(`  Seeded Completion Checklist for "${firm.name}"`);

    // Overall Review of FS (placeholder — will be customised later)
    await prisma.methodologyTemplate.upsert({
      where: { firmId_templateType_auditType: { firmId: firm.id, templateType: 'overall_review_fs_questions', auditType: 'ALL' } },
      create: {
        firmId: firm.id,
        templateType: 'overall_review_fs_questions',
        auditType: 'ALL',
        items: { questions: OR_QUESTIONS, sectionMeta: OR_SECTION_META },
      },
      update: {
        items: { questions: OR_QUESTIONS, sectionMeta: OR_SECTION_META },
      },
    });
    console.log(`  Seeded Overall Review of FS for "${firm.name}" (placeholder)`);
  }
}

main()
  .then(() => { console.log('Done'); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });
