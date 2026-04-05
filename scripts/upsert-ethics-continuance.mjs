import { PrismaClient } from '@prisma/client';

const DATABASE_URL = "postgresql://acumon_admin:AcuM0nPg2026Secure@psql-acumon-uksouth.postgres.database.azure.com:5432/acumon_web?sslmode=require";
const FIRM_ID = 'a1b2c3d4-0001-0001-0001-000000000001';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL } },
});

function q(id, sectionKey, questionText, inputType, sortOrder, opts = {}) {
  return { id, sectionKey, questionText, inputType, sortOrder, ...opts };
}

// ──────────────────────────────────────────────────
// ETHICS QUESTIONS (Appendix B)
// ──────────────────────────────────────────────────

function buildEthicsQuestions() {
  let i = 0;
  const questions = [];

  function addTripleRow(section, label, keyBase) {
    questions.push(q(`${keyBase}_comment`, section, `${label} - Detailed Comments`, 'textarea', i++));
    questions.push(q(`${keyBase}_issue`, section, `${label} - Issue?`, 'yesno', i++));
    questions.push(q(`${keyBase}_safeguard`, section, `${label} - Safeguard Implemented`, 'textarea', i++));
  }

  // Section 1: Non Audit Services
  addTripleRow('Non Audit Services', 'Preparation of accounts', 'nas_prep_accounts');
  addTripleRow('Non Audit Services', 'Corporation Tax', 'nas_corp_tax');
  addTripleRow('Non Audit Services', 'Advisory / Valuation Services', 'nas_advisory');
  addTripleRow('Non Audit Services', 'Internal Audit', 'nas_internal_audit');
  addTripleRow('Non Audit Services', 'Other Assurance', 'nas_other_assurance');
  addTripleRow('Non Audit Services', 'Payroll', 'nas_payroll');
  addTripleRow('Non Audit Services', 'VAT / Bookkeeping', 'nas_vat_bookkeeping');
  addTripleRow('Non Audit Services', 'Recruitment, Legal & Litigation and IT Services', 'nas_recruitment_legal_it');

  // Section 2: Threats
  addTripleRow('Threats', 'Familiarity Threat of Audit Team', 'threat_familiarity');
  addTripleRow('Threats', 'Self Interest Threat', 'threat_self_interest');
  addTripleRow('Threats', 'Self-Review Threat', 'threat_self_review');
  addTripleRow('Threats', 'Advocacy Threat', 'threat_advocacy');
  addTripleRow('Threats', 'Management Threat', 'threat_management');
  addTripleRow('Threats', 'Intimidation Threat', 'threat_intimidation');

  // Section 3: Relationships
  addTripleRow('Relationships', 'Financial relationship', 'rel_financial');
  addTripleRow('Relationships', 'Business relationship', 'rel_business');
  addTripleRow('Relationships', 'Employment relationship', 'rel_employment');
  addTripleRow('Relationships', 'Personal relationship', 'rel_personal');

  // Section 4: Other Considerations
  addTripleRow('Other Considerations', 'Litigation Threat', 'other_litigation');
  addTripleRow('Other Considerations', 'Gifts & Hospitality Threat', 'other_gifts_hospitality');
  addTripleRow('Other Considerations', 'Remuneration of Audit team', 'other_remuneration');

  // Section 5: Fee Assessment
  questions.push(q('audit_fee', 'Fee Assessment', 'Audit Fee', 'currency', i++));
  questions.push(q('non_audit_fee', 'Fee Assessment', 'Non-Audit Fee', 'currency', i++));
  questions.push(q('total_fees', 'Fee Assessment', 'Total Fees', 'formula', i++, { formulaExpression: 'audit_fee + non_audit_fee' }));
  questions.push(q('pct_non_audit_to_audit', 'Fee Assessment', '% of Non-Audit Fee to Audit Fee', 'formula', i++, { formulaExpression: 'non_audit_fee / audit_fee * 100' }));
  questions.push(q('pct_total_to_firm', 'Fee Assessment', '% of Total Fees to Firm Fees', 'formula', i++, { formulaExpression: 'total_fees / firm_fees * 100' }));
  questions.push(q('overdue_fees_yn', 'Fee Assessment', 'Overdue Fees from client', 'yesno', i++));
  questions.push(q('overdue_fees_detail', 'Fee Assessment', 'Overdue Fees from client - Details', 'textarea', i++, { conditionalOn: { questionId: 'overdue_fees_yn', value: 'Yes' } }));

  // Section 6: ORITP - Objective
  questions.push(q('oritp_obj_bookkeeping', 'ORITP - Objective', 'Are any audit team members involved in bookkeeping or tax work?', 'yesno', i++));
  questions.push(q('oritp_obj_non_audit_outputs', 'ORITP - Objective', 'Does the audit team rely solely on non-audit outputs?', 'yesno', i++));
  questions.push(q('oritp_obj_personal_interest', 'ORITP - Objective', 'Any personal/financial interests in the client?', 'yesno', i++));
  questions.push(q('oritp_obj_skepticism', 'ORITP - Objective', 'Has professional skepticism been maintained?', 'yesno', i++));
  questions.push(q('oritp_obj_mgmt_influence', 'ORITP - Objective', 'Is audit judgment free from management influence?', 'yesno', i++));
  questions.push(q('oritp_obj_conclusion', 'ORITP - Objective', 'Conclusion', 'dropdown', i++, {
    dropdownOptions: [
      'Threats mitigated. Audit team remains unbiased',
      'Threats not fully mitigated. Audit team could be seen to be biased'
    ]
  }));

  // Section 7: ORITP - Reasonable
  questions.push(q('oritp_reas_proportionate', 'ORITP - Reasonable', 'Are safeguards proportionate?', 'yesno', i++));
  questions.push(q('oritp_reas_fees_reasonable', 'ORITP - Reasonable', 'Are non-audit fees reasonable relative to audit fees?', 'yesno', i++));
  questions.push(q('oritp_reas_segregation', 'ORITP - Reasonable', 'Is segregation of audit and non-audit services evidenced?', 'yesno', i++));
  questions.push(q('oritp_reas_comply', 'ORITP - Reasonable', 'Do services comply with ethical standards?', 'yesno', i++));
  questions.push(q('oritp_reas_directors_informed', 'ORITP - Reasonable', 'Have the Directors been informed?', 'yesno', i++));
  questions.push(q('oritp_reas_conclusion', 'ORITP - Reasonable', 'Conclusion', 'dropdown', i++, {
    dropdownOptions: [
      'A prudent auditor would consider safeguards adequate.',
      'A prudent auditor would be sceptical that safeguards adequate.'
    ]
  }));

  // Section 8: ORITP - Informed Third Party
  questions.push(q('oritp_itp_independence', 'ORITP - Informed Third Party', 'Would an informed third party perceive independence as compromised?', 'yesno', i++));
  questions.push(q('oritp_itp_own_work', 'ORITP - Informed Third Party', 'Could stakeholders believe the firm is auditing its own work?', 'yesno', i++));
  questions.push(q('oritp_itp_excessive', 'ORITP - Informed Third Party', 'Would disclosure of non-audit services appear excessive?', 'yesno', i++));
  questions.push(q('oritp_itp_transparency', 'ORITP - Informed Third Party', 'Is there transparency in safeguards?', 'yesno', i++));
  questions.push(q('oritp_itp_regulator', 'ORITP - Informed Third Party', 'Could a regulator challenge the sufficiency of safeguards?', 'yesno', i++));
  questions.push(q('oritp_itp_conclusion', 'ORITP - Informed Third Party', 'Conclusion', 'dropdown', i++, {
    dropdownOptions: [
      'An informed outsider would conclude independence is preserved.',
      'An informed outsider would conclude independence is jeopardised.'
    ]
  }));

  return questions;
}

// ──────────────────────────────────────────────────
// CONTINUANCE QUESTIONS (Appendix C)
// ──────────────────────────────────────────────────

function buildContinuanceQuestions() {
  let i = 0;
  const questions = [];

  // 1. Entity Details
  questions.push(q('entity_type', 'Entity Details', 'What type of audit client', 'dropdown', i++, {
    dropdownOptions: ['Limited Company', 'PIE', 'Charity']
  }));
  questions.push(q('client_listed', 'Entity Details', 'Is the client listed?', 'dropdown', i++, {
    dropdownOptions: ['Limited Company', 'PIE', 'Charity']
  }));

  // 2. Ownership information
  questions.push(q('ownership_shareholders_changed', 'Ownership information', 'Discuss with management to assess if shareholders with more than 25% shareholding has changed during the year?', 'yes_only', i++));
  questions.push(q('ownership_ubo_changed', 'Ownership information', 'Discuss with management to assess if there is any change Ultimate Beneficial Owners (UBO) during the year?', 'yes_only', i++));
  questions.push(q('ownership_aml_updated', 'Ownership information', 'For change in the shareholders (>25%) and UBO, did the audit team update the AML procedures?', 'yes_only', i++));

  // 3. Continuity
  questions.push(q('continuity_mgmt_letter', 'Continuity', 'Prior Year Management Letter Points', 'dropdown', i++, {
    dropdownOptions: ['First Year of Audit', 'Our First Year of Audit', 'Existing Client from prior period']
  }));
  questions.push(q('continuity_internal_control', 'Continuity', 'Internal control environment', 'dropdown', i++, {
    dropdownOptions: ['Functioning as designed', 'Partially Functioning as Designed', 'Not Functioning as Designed']
  }));
  questions.push(q('continuity_engagement_letter_date', 'Continuity', 'Engagement Letter Signed Date', 'date', i++));

  // 4. Management information
  questions.push(q('mgmt_directors_changed', 'Management information', 'Discuss with management to assess if there is any changes in directors/trustees during the year?', 'yes_only', i++));
  questions.push(q('mgmt_integrity_concerns', 'Management information', 'Are there any concerns over the skills and integrity of the owners, directors and management?', 'yes_only', i++));
  questions.push(q('mgmt_competence', 'Management information', "Assess management's skills and competence in relation to new directors", 'dropdown', i++, {
    dropdownOptions: ['Assessed as Competent', 'Assessed as Not Competent', 'Not Assessed']
  }));

  // 5. Nature of business
  questions.push(q('nature_principal_activities', 'Nature of business', 'Is there any change in the principal activities of the entity during the year?', 'yes_only', i++));
  questions.push(q('nature_group_structure', 'Nature of business', 'Is there any change in the group structure of the entity?', 'yes_only', i++));
  questions.push(q('nature_non_coop_countries', 'Nature of business', 'Has the entity established new subsidiaries in any of the non-co-operating countries?', 'yes_only', i++));
  questions.push(q('nature_funding_sources', 'Nature of business', 'Is there any change in sources of funding in the year?', 'yes_only', i++));
  questions.push(q('nature_company_search', 'Nature of business', 'Results of company search on Google and websites such as Companies House or Charity Commission', 'yes_only', i++));

  // 6. Prior year financial information
  questions.push(q('prior_yr_qualification', 'Prior year financial information', 'Is there any qualification included in the prior year audit report?', 'yesno', i++));
  questions.push(q('prior_yr_qualification_detail', 'Prior year financial information', 'If yes, details of the qualification in the audit report including discussion with management', 'textarea', i++, {
    conditionalOn: { questionId: 'prior_yr_qualification', value: 'Yes' }
  }));

  // 7. Audit Risk reassessment
  questions.push(q('risk_significant_changes', 'Audit Risk reassessment', 'Based on the current year activities, is there any change in the identified significant risks, areas of audit focus and key audit matters?', 'yes_only', i++));
  questions.push(q('risk_acceptable_profile', 'Audit Risk reassessment', "Does this client fit with the firm's acceptable risk profile?", 'yes_only', i++));

  // 8. Fee considerations - Prior Year
  const feeServices = [
    { key: 'audit', label: 'Audit' },
    { key: 'accounts_prep', label: 'Accounts Preparation' },
    { key: 'corp_tax', label: 'Corporation Tax' },
    { key: 'advisory', label: 'Advisory / Valuation Services' },
    { key: 'internal_audit', label: 'Internal Audit' },
    { key: 'other_assurance', label: 'Other Assurance' },
    { key: 'payroll', label: 'Payroll' },
    { key: 'vat_bookkeeping', label: 'VAT / Bookkeeping' },
    { key: 'recruitment_legal_it', label: 'Recruitment, Legal & Litigation and IT Services' },
  ];

  for (const svc of feeServices) {
    questions.push(q(`fee_py_${svc.key}_fee`, 'Fee considerations - Prior Year', `${svc.label} - Fee`, 'number', i++));
    questions.push(q(`fee_py_${svc.key}_hours`, 'Fee considerations - Prior Year', `${svc.label} - Hours`, 'number', i++));
    questions.push(q(`fee_py_${svc.key}_fee_per_hour`, 'Fee considerations - Prior Year', `${svc.label} - Fee per hour`, 'formula', i++, {
      formulaExpression: `fee_py_${svc.key}_fee / fee_py_${svc.key}_hours`
    }));
  }

  // 9. Fee considerations - Current Year
  for (const svc of feeServices) {
    questions.push(q(`fee_cy_${svc.key}_fee`, 'Fee considerations - Current Year', `${svc.label} - Fee`, 'number', i++));
    questions.push(q(`fee_cy_${svc.key}_hours`, 'Fee considerations - Current Year', `${svc.label} - Hours`, 'number', i++));
    questions.push(q(`fee_cy_${svc.key}_fee_per_hour`, 'Fee considerations - Current Year', `${svc.label} - Fee per hour`, 'formula', i++, {
      formulaExpression: `fee_cy_${svc.key}_fee / fee_cy_${svc.key}_hours`
    }));
    questions.push(q(`fee_cy_${svc.key}_comments`, 'Fee considerations - Current Year', `${svc.label} - Comments`, 'textarea', i++));
    questions.push(q(`fee_cy_${svc.key}_fee_type`, 'Fee considerations - Current Year', `${svc.label} - Fee Type`, 'dropdown', i++, {
      dropdownOptions: ['Fixed Fee', 'Time Based', 'Contingent', 'Other']
    }));
  }

  // 10. Fee general questions
  questions.push(q('fee_sufficient', 'Fee considerations', 'Is the proposed audit fee sufficient to deliver a high-quality audit?', 'yesno', i++));
  questions.push(q('fee_contingent', 'Fee considerations', 'Is the audit or any other professional work being undertaken on a contingent fee basis?', 'yesno', i++));
  questions.push(q('fee_exceed_15pct', 'Fee considerations', 'Do proposed total fees for the client / group of clients regularly exceed 15% (listed: 10%) of Group Revenue', 'textarea', i++));

  // 11. Resourcing
  questions.push(q('resourcing_ri', 'Resourcing', 'Responsible Individual (RI)', 'textarea', i++));
  questions.push(q('resourcing_manager', 'Resourcing', 'Manager/Senior', 'textarea', i++));
  questions.push(q('resourcing_team', 'Resourcing', 'Audit Team Members', 'textarea', i++));
  questions.push(q('resourcing_specialist', 'Resourcing', 'Specialist/Expert Required?', 'yesno', i++));
  questions.push(q('resourcing_specialist_detail', 'Resourcing', 'Details of specialist/expert', 'textarea', i++, {
    conditionalOn: { questionId: 'resourcing_specialist', value: 'Yes' }
  }));

  // 12. Timetable
  questions.push(q('timetable_planning_date', 'Timetable', 'Planning Date', 'date', i++));
  questions.push(q('timetable_fieldwork_start', 'Timetable', 'Fieldwork Start Date', 'date', i++));
  questions.push(q('timetable_fieldwork_end', 'Timetable', 'Fieldwork End Date', 'date', i++));
  questions.push(q('timetable_completion_date', 'Timetable', 'Completion Date', 'date', i++));
  questions.push(q('timetable_statutory_deadline', 'Timetable', 'Statutory Deadline', 'date', i++));

  // 13. EQR
  questions.push(q('eqr_required', 'EQR', 'EQR on this engagement', 'yesno', i++));
  questions.push(q('eqr_prior_year_points', 'EQR', 'Any points relevant for RI consideration based on working with EQR in prior year audit?', 'textarea', i++));

  // 14. Discussion with MLRO
  questions.push(q('mlro_higher_risk', 'Discussion with MLRO', 'Is this a higher AML risk', 'yesno', i++));
  questions.push(q('mlro_discussion_summary', 'Discussion with MLRO', 'Summarise discussion with MLRO', 'textarea', i++));
  questions.push(q('mlro_consent', 'Discussion with MLRO', 'Did MLRO consent to accepting engagement', 'yesno', i++));

  // 15. Discussion with Partner/RI
  questions.push(q('partner_discussion_summary', 'Discussion with Partner/RI', 'Summarise discussion with Audit Partner/RI', 'textarea', i++));
  questions.push(q('partner_consent', 'Discussion with Partner/RI', 'Did Audit Partner/RI consent to accepting engagement', 'yesno', i++));

  // 16. Final Conclusion
  questions.push(q('final_conclusion', 'Final Conclusion', 'FINAL CONCLUSION', 'textarea', i++));

  return questions;
}

// ──────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────

async function main() {
  try {
    const ethicsQuestions = buildEthicsQuestions();
    const continuanceQuestions = buildContinuanceQuestions();

    console.log(`Ethics questions: ${ethicsQuestions.length}`);
    console.log(`Continuance questions: ${continuanceQuestions.length}`);

    // Upsert Ethics
    const ethicsResult = await prisma.methodologyTemplate.upsert({
      where: {
        firmId_templateType_auditType: {
          firmId: FIRM_ID,
          templateType: 'ethics_questions',
          auditType: 'ALL',
        },
      },
      update: {
        items: ethicsQuestions,
        updatedAt: new Date(),
      },
      create: {
        firmId: FIRM_ID,
        templateType: 'ethics_questions',
        auditType: 'ALL',
        items: ethicsQuestions,
      },
    });
    console.log(`Ethics template upserted: ${ethicsResult.id} (${ethicsQuestions.length} questions)`);

    // Upsert Continuance
    const continuanceResult = await prisma.methodologyTemplate.upsert({
      where: {
        firmId_templateType_auditType: {
          firmId: FIRM_ID,
          templateType: 'continuance_questions',
          auditType: 'ALL',
        },
      },
      update: {
        items: continuanceQuestions,
        updatedAt: new Date(),
      },
      create: {
        firmId: FIRM_ID,
        templateType: 'continuance_questions',
        auditType: 'ALL',
        items: continuanceQuestions,
      },
    });
    console.log(`Continuance template upserted: ${continuanceResult.id} (${continuanceQuestions.length} questions)`);

    // Verify
    const verify = await prisma.methodologyTemplate.findMany({
      where: {
        firmId: FIRM_ID,
        templateType: { in: ['ethics_questions', 'continuance_questions'] },
      },
      select: { id: true, templateType: true, auditType: true, updatedAt: true },
    });
    console.log('\nVerification:');
    for (const t of verify) {
      console.log(`  ${t.templateType} (${t.auditType}): id=${t.id}, updated=${t.updatedAt.toISOString()}`);
    }

    console.log('\nDone!');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
