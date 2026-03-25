const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('crypto');
const p = new PrismaClient();

function q(key, label, section, inputType, opts) {
  return { id: randomUUID(), key, questionText: label, sectionKey: section, inputType: inputType || 'text', sortOrder: 0, ...(opts || {}) };
}

async function main() {
  const firmId = 'a1b2c3d4-0001-0001-0001-000000000001';

  const questions = [
    // Client Information
    q('client_name', 'Client Name', 'Client Information'),
    q('is_pie_listed', 'Is the proposed client a PIE/Listed?', 'Client Information'),
    q('financial_year', 'Financial year', 'Client Information'),
    q('business_address', 'Business address', 'Client Information', 'textarea'),
    // Services
    q('svc_audit', 'Audit', 'Services to be Provided', 'yna'),
    q('svc_accounts_prep', 'Accounts preparation', 'Services to be Provided', 'yna'),
    q('svc_bookkeeping', 'Bookkeeping', 'Services to be Provided', 'yna'),
    q('svc_payroll', 'Payroll', 'Services to be Provided', 'yna'),
    q('svc_vat', 'Assistance with VAT returns', 'Services to be Provided', 'yna'),
    q('svc_other_reg', 'Other regulatory return(s) (specify)', 'Services to be Provided', 'yna'),
    q('svc_personal_tax', 'Personal tax', 'Services to be Provided', 'yna'),
    q('svc_corp_tax', 'Corporate tax', 'Services to be Provided', 'yna'),
    q('svc_tax_planning', 'Tax-planning', 'Services to be Provided', 'yna'),
    q('svc_investment', 'Investment business advice', 'Services to be Provided', 'yna'),
    q('svc_consultancy', 'Management consultancy', 'Services to be Provided', 'yna'),
    q('svc_other', 'Other (specify)', 'Services to be Provided', 'yna'),
    // Client Introduction
    q('source_intro', 'Has the source of introduction been established?', 'Client Introduction'),
    // Previous Auditors
    q('prev_auditor_name', 'Previous auditor (Firm name)', 'Previous Auditors'),
    q('prev_auditor_address', 'Previous auditor (Address)', 'Previous Auditors'),
    q('prev_auditor_contact', 'Previous auditor contact details', 'Previous Auditors'),
    q('reasons_change', 'Reasons for changing auditors', 'Previous Auditors', 'textarea'),
    q('reason_johnsons', "Client's reason for reaching out to Johnsons", 'Previous Auditors', 'textarea'),
    // Ownership
    q('shareholders_list', 'Did we obtain the list of shareholders from management?', 'Ownership Information'),
    q('shareholders_25pct', 'Details of shareholders with more than 25% shareholding', 'Ownership Information', 'textarea'),
    q('ubo_different', 'Are Ultimate Beneficial Owners (UBO) different from shareholders?', 'Ownership Information'),
    q('ubo_details', 'If yes, provide the details of Ultimate Beneficial Owners', 'Ownership Information', 'textarea'),
    q('control_individuals', 'Are there any individual(s) who exercise control over the management?', 'Ownership Information', 'textarea'),
    // Management
    q('directors_list', 'List the name of directors / Trustees for the entity', 'Management Information', 'textarea'),
    q('mgmt_diff_directors', 'Is management different from directors?', 'Management Information'),
    q('director_shareholders', 'Are there any director who are also shareholders?', 'Management Information'),
    q('integrity_concerns', 'Are there any concerns over the integrity of the owners, directors and management?', 'Management Information', 'textarea'),
    q('mgmt_competence', "Audit team's assessment of management's skills and competence", 'Management Information', 'textarea'),
    q('finance_function', 'Details of the finance function and their location', 'Management Information', 'textarea'),
    // Nature of Business
    q('principal_activities', 'Details of principal activities of the entity', 'Nature of Business', 'textarea'),
    q('standalone_or_group', 'Is the proposed client a standalone entity or part of the group?', 'Nature of Business'),
    q('subsidiaries', 'If part of the group, details of subsidiaries and their country of incorporation', 'Nature of Business', 'textarea'),
    q('funding_sources', 'What are the sources of funding of the entity?', 'Nature of Business', 'textarea'),
    q('regulated_industry', 'Is the proposed client involved in a regulated industry?', 'Nature of Business'),
    q('regulatory_relationship', 'If regulated, have we enquired about its relationship with the regulatory authorities?', 'Nature of Business'),
    q('ml_regulation', 'Is the entity subject to money laundering regulation in its own right?', 'Nature of Business'),
    q('non_cooperating_countries', 'Does the proposed client have any links with non-co-operating countries?', 'Nature of Business'),
    q('company_search_results', 'Results of company search on Google and Companies House/Charity Commission', 'Nature of Business', 'textarea'),
    // Latest Financial Information
    q('latest_fi_obtained', 'Did we obtain the latest financial information from management?', 'Latest Financial Information'),
    q('fi_source', 'Source of financial information', 'Latest Financial Information'),
    q('fi_revenue', 'Revenue', 'Latest Financial Information', 'currency'),
    q('fi_pbt', 'Profit before tax', 'Latest Financial Information', 'currency'),
    q('fi_net_assets', 'Net assets', 'Latest Financial Information', 'currency'),
    q('fi_total_assets', 'Total assets', 'Latest Financial Information', 'currency'),
    q('fi_py_audited', 'Financial statements of previous year audited?', 'Latest Financial Information'),
    q('fi_py_qualification', 'Is there any qualification included in the prior year audit report?', 'Latest Financial Information'),
    q('fi_py_qual_details', 'If yes, details of the qualification', 'Latest Financial Information', 'textarea'),
    // Ethical & Independence
    q('conflicts_of_interest', 'Are we aware of any potential conflicts of interest with existing clients?', 'Ethical & Independence'),
    q('relationships_impact', 'Does the firm, RI and proposed audit team have relationships with management?', 'Ethical & Independence', 'textarea'),
    q('financial_relationships', 'Financial relationships (including beneficial interest)', 'Ethical & Independence'),
    q('business_relationships', 'Business relationships', 'Ethical & Independence'),
    q('employment_relationships', 'Employment relationships', 'Ethical & Independence'),
    q('personal_relationships', 'Personal and other relationships', 'Ethical & Independence'),
    q('litigation_claims', 'Any ongoing or potential litigations or claims', 'Ethical & Independence'),
    q('partner_exclusive', 'Is there an audit partner employed exclusively on this audit?', 'Ethical & Independence'),
    q('partner_remuneration', 'Is there an audit partner remunerated based on fees from this client?', 'Ethical & Independence'),
    q('gifts_hospitality', 'Has any individual received gifts or hospitality from the client?', 'Ethical & Independence'),
    q('non_audit_services', 'Details of non-audit services proposed', 'Ethical & Independence', 'textarea'),
    q('non_audit_safeguards', 'Proposed safeguards in relation to non-audit services', 'Ethical & Independence', 'textarea'),
    q('non_audit_fees_higher', 'Are non-audit fees expected to be higher than audit fees?', 'Ethical & Independence'),
    q('ethics_partner_discussion', 'Results of discussion with Ethics partner', 'Ethical & Independence', 'textarea'),
    q('informed_management', 'Does the entity have informed management?', 'Ethical & Independence'),
    q('threat_self_interest', 'Self-interest threat', 'Ethical & Independence'),
    q('threat_self_review', 'Self-review threat', 'Ethical & Independence'),
    q('threat_advocacy', 'Advocacy threat', 'Ethical & Independence'),
    q('threat_familiarity', 'Familiarity threat', 'Ethical & Independence'),
    q('threat_intimidation', 'Intimidation threat', 'Ethical & Independence'),
    // Audit Risk
    q('significant_risks', 'Significant risks identified', 'Audit Risk Assessment', 'textarea'),
    q('areas_audit_focus', 'Areas of audit focus', 'Audit Risk Assessment', 'textarea'),
    q('key_audit_matters', 'Key audit matters (PIE only)', 'Audit Risk Assessment', 'textarea'),
    // Fee Considerations
    q('proposed_fees', 'Proposed fees for the services (breakdown by type)', 'Fee Considerations', 'textarea'),
    q('chargeable_rate', 'Proposed chargeable revenue/hr', 'Fee Considerations', 'currency'),
    q('fee_sufficient', 'Is the proposed audit fee sufficient for a high-quality audit?', 'Fee Considerations'),
    q('contingent_fee', 'Is any work undertaken on a contingent fee basis?', 'Fee Considerations'),
    q('fees_exceed_15pct', 'Do total fees exceed 15% (listed: 10%) of firm revenue?', 'Fee Considerations'),
    q('fees_exceed_10pct', 'Do total fees exceed 10% (listed: 5%) of firm revenue?', 'Fee Considerations'),
    // Resourcing
    q('forecast_hours', 'Forecast total hours by level', 'Resourcing Considerations', 'textarea'),
    q('proposed_team', 'Proposed team for the job (include names)', 'Resourcing Considerations', 'textarea'),
    q('team_skills', 'Does the team have necessary skills and experience?', 'Resourcing Considerations', 'textarea'),
    q('experts_involved', 'Are experts or specialists involved?', 'Resourcing Considerations'),
    q('experts_details', 'Details of proposed experts or specialists', 'Resourcing Considerations', 'textarea'),
    q('no_experts_reason', 'If no experts used in area requiring specialist knowledge, provide reasons', 'Resourcing Considerations', 'textarea'),
    q('proposed_timetable', 'Proposed timetable (Planning, Walkthroughs, Fieldwork, Completion, Sign off)', 'Resourcing Considerations', 'textarea'),
    q('sufficient_resources', 'Does the firm have sufficient resources?', 'Resourcing Considerations'),
    q('short_timetable', 'If short timetable, detail how quality will be maintained', 'Resourcing Considerations', 'textarea'),
    q('site_visits', 'Did the audit team propose site visits?', 'Resourcing Considerations'),
    // EQR
    q('eqr_required', 'Is EQR required for this engagement?', 'EQR Considerations'),
    q('eqr_details', 'Provide details of proposed EQR', 'EQR Considerations', 'textarea'),
    q('eqr_competence', 'How RI is satisfied EQR has necessary competence', 'EQR Considerations', 'textarea'),
    // AML - Nature of Client
    q('aml_outside_normal', 'Is the proposed client outside our normal type of client?', 'AML - Nature of Client'),
    q('aml_unusual_location', 'Is there anything unusual regarding geographic location?', 'AML - Nature of Client'),
    q('aml_changed_advisers', 'Has the client changed professional advisers frequently?', 'AML - Nature of Client'),
    q('aml_overpaying', 'Is the client willing to pay over the odds in fees?', 'AML - Nature of Client'),
    q('aml_high_risk_area', 'Is the client resident in a high-risk geographical area?', 'AML - Nature of Client'),
    q('aml_complex_transactions', 'Are there complex/unusually large transactions with no apparent purpose?', 'AML - Nature of Client'),
    q('aml_nominee_shares', 'Is the client a company with nominee shareholders or bearer shares?', 'AML - Nature of Client'),
    q('aml_multiple_accounts', 'Does the client have multiple or foreign bank accounts without reason?', 'AML - Nature of Client'),
    q('aml_complex_structure', 'Is the corporate structure unusual or excessively complex?', 'AML - Nature of Client'),
    q('aml_secretive', 'Is the proposed client unduly secretive or uncooperative?', 'AML - Nature of Client'),
    q('aml_background_consistent', 'Is background consistent with known business activity and source of funds?', 'AML - Nature of Client'),
    q('aml_adverse_media', 'Have there been any adverse media reports?', 'AML - Nature of Client'),
    q('aml_asset_freeze', 'Is the client subject to any asset freeze or on any terrorist list?', 'AML - Nature of Client'),
    q('aml_illegal_activities', 'Is the client known to be potentially involved in illegal activities?', 'AML - Nature of Client'),
    q('aml_face_to_face', 'Any concerns about not seeing client face to face?', 'AML - Nature of Client'),
    q('aml_third_party_payments', 'Will payments be received from unknown or unassociated third parties?', 'AML - Nature of Client'),
    q('aml_false_documents', 'Have any documents been found to be false or stolen?', 'AML - Nature of Client'),
    q('aml_pep', 'Is the client or beneficial owner a PEP?', 'AML - Nature of Client'),
    q('aml_obstructive', 'Has the client been obstructive or evasive when asked for information?', 'AML - Nature of Client'),
    q('aml_other_factors', 'Any other factors presenting higher risk of ML/TF?', 'AML - Nature of Client', 'textarea'),
    // AML - Nature of Assignment
    q('aml_unusual_services', 'Is there anything unusual regarding the services requested?', 'AML - Nature of Assignment'),
    q('aml_one_off', 'Is the client carrying out a one-off transaction?', 'AML - Nature of Assignment'),
    q('aml_nominee_directors', 'Do services involve nominee directors/shareholders?', 'AML - Nature of Assignment'),
    q('aml_ml_risk_services', 'Is there reason to believe services lend themselves to ML/TF?', 'AML - Nature of Assignment'),
    q('aml_client_money', 'Will we handle client money?', 'AML - Nature of Assignment'),
    q('aml_trust_company', 'Are we providing investment/trust/company services?', 'AML - Nature of Assignment'),
    // AML - Organisation Environment
    q('aml_drug_countries', 'Do activities involve countries with drug/terrorism prevalence?', 'AML - Organisation Environment'),
    q('aml_high_risk_country', 'Is the client established in a high risk third country?', 'AML - Organisation Environment'),
    q('aml_sanctions', 'Is the organisation subject to sanctions?', 'AML - Organisation Environment'),
    q('aml_money_moved', 'Is money moved between accounts/jurisdictions without reason?', 'AML - Organisation Environment'),
    q('aml_phoenix', 'Does the organisation have a rapid rate of start-up and shut down?', 'AML - Organisation Environment'),
    q('aml_outside_services', 'Does it take on work outside normal goods and services?', 'AML - Organisation Environment'),
    q('aml_bitcoin', 'Does the organisation use bitcoin or similar digital currencies?', 'AML - Organisation Environment'),
    q('aml_loss_making', 'History of loss-making transactions without logical explanation?', 'AML - Organisation Environment'),
    q('aml_funding_illogical', 'Is there funding that lacks logical explanation?', 'AML - Organisation Environment'),
    q('aml_complex_structure_env', 'Is the structure unduly complex without legal/economic reasons?', 'AML - Organisation Environment'),
    q('aml_cash_intensive', 'Is this a cash intensive organisation?', 'AML - Organisation Environment'),
    q('aml_uk_nra_business', 'Is this a business type identified by UK NRA as used for laundering?', 'AML - Organisation Environment'),
    // AML - Fraud Risk
    q('aml_honesty_concerns', 'Reasons to question honesty/integrity of management?', 'AML - Fraud, Theft & Error'),
    q('aml_adverse_relationships', 'Any adverse relationships between org and employees with asset access?', 'AML - Fraud, Theft & Error'),
    q('aml_fraud_history', 'History of fraud, theft or error?', 'AML - Fraud, Theft & Error'),
    q('aml_susceptibility', 'Adverse characteristics increasing susceptibility to misappropriation?', 'AML - Fraud, Theft & Error'),
    q('aml_supervisory_lacking', 'Are supervisory controls lacking?', 'AML - Fraud, Theft & Error'),
    q('aml_inadequate_controls', 'Inadequate internal controls over assets?', 'AML - Fraud, Theft & Error'),
    q('aml_disregard_controls', 'Disregard for need for internal control?', 'AML - Fraud, Theft & Error'),
    q('aml_non_routine_transactions', 'Significant non-routine or non-systematic transactions at period end?', 'AML - Fraud, Theft & Error'),
    // AML - Laws
    q('aml_laws_central', 'Laws and regulations central to the client conducting operations?', 'AML - Laws & Regulations'),
    q('aml_external_investigation', 'Is the client undergoing or anticipating external investigation?', 'AML - Laws & Regulations'),
    q('aml_violations_history', 'Known history of violations of laws/regulations or fraud allegations?', 'AML - Laws & Regulations'),
    // MLRO
    q('mlro_summary', 'Summary of discussion / conclusion with MLRO', 'Discussion with MLRO', 'textarea'),
    // Proposed Conclusion
    q('proposed_conclusion', 'Proposed conclusion [Accept/Reject]', 'Proposed Conclusion', 'dropdown', { dropdownOptions: ['Accept', 'Reject'] }),
    // Management Board
    q('mgmt_board_summary', 'Summary of discussion / conclusion with Management Board', 'Discussion with Management Board', 'textarea'),
    // Next Steps
    q('authority_contact_prev', 'Has the client given authority to contact the previous accountant?', 'Next Steps'),
    q('enquiry_letter_sent', 'Send professional enquiry letter to previous auditor?', 'Next Steps'),
    q('satisfactory_response', 'Has a satisfactory response been received?', 'Next Steps'),
    q('matters_raised', 'Were any matters raised in the reply?', 'Next Steps', 'textarea'),
    // Final Conclusion
    q('final_conclusion', 'Final conclusion [Accept/Reject]', 'Final Conclusion', 'dropdown', { dropdownOptions: ['Accept', 'Reject'] }),
  ];

  questions.forEach((q, i) => { q.sortOrder = i + 1; });

  await p.methodologyTemplate.upsert({
    where: { firmId_templateType_auditType: { firmId, templateType: 'new_client_takeon_questions', auditType: 'ALL' } },
    create: { firmId, templateType: 'new_client_takeon_questions', auditType: 'ALL', items: questions },
    update: { items: questions },
  });
  console.log('Seeded new_client_takeon_questions with', questions.length, 'questions');
}

main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
