# Test Specs — Wages & Salaries

Framework: FRS102   Significant Risk: Y   Test count: 22

Source CSV row range: 75–96

---

### Test 75: Review changes from PY if either >PM or 30% and obtain explanation for movement

- FS Line: **Wages & Salaries**
- Assertion: **Completeness**
- Type: **Analytical Review**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_no_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `ar_variance` — Analytical review of movement vs PY, investigate where delta breaches threshold.

**Steps:**

 1. `accounting_extract`  — bindings: `{ data_type: 'journals', account_codes: $ctx.test.fsLine → derive from fs_line_accounts }`
 2. `analytical_review_variance` 🆕 — bindings: `{ fs_line: $ctx.test.fsLine }`
 3. `request_gm_explanations`  — bindings: `{ variances: $prev.variances }`
 4. `assess_gm_explanations`  — bindings: `{ variances: $step.2.variances, explanations: $prev.explanations }`
 5. `team_review`  — bindings: `{ instructions: 'Review variance investigation and conclude.' }`

**New Actions referenced:**

 - `analytical_review_variance` — Analytical Review — PY Variance

---

### Test 76: Obtain an understanding of the payroll process and assess the design effectiveness of controls (e.g., approval

- FS Line: **Wages & Salaries**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `walkthrough` — Walkthrough / management discussion.

**Full description:**

> Obtain an understanding of the payroll process and assess the design effectiveness of controls (e.g., approval of new joiners, leavers, and changes to pay rates).

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Record walkthrough of the Wages & Salaries process; document controls and design effectiveness.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 77: Reconcile the total payroll cost per payroll system to the general ledger/trial balance.

- FS Line: **Wages & Salaries**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `listing_recon` — Obtain other listing and reconcile to TB.

**Steps:**

 1. `request_listing` 🆕 — bindings: `{ listing_type: 'other', account_codes: $ctx.test.fsLineAccounts }`
 2. `reconcile_to_tb` 🆕 — bindings: `{ data_table: $prev.data_table, account_codes: $ctx.test.fsLineAccounts }`
 3. `team_review`  — bindings: `{ instructions: 'Review reconciliation and any unreconciled items.' }`

**New Actions referenced:**

 - `request_listing` — Request Listing from Client
 - `reconcile_to_tb` — Reconcile Listing to Trial Balance

---

### Test 78: Perform analytical review by comparing monthly payroll costs to prior periods and budgets, considering headcou

- FS Line: **Wages & Salaries**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Full description:**

> Perform analytical review by comparing monthly payroll costs to prior periods and budgets, considering headcount movements.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Perform analytical review by comparing monthly payroll costs to prior periods and budgets, considering headcount movements.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 79: Review accruals for unpaid wages, overtime, and bonuses at year-end to ensure completeness.

- FS Line: **Wages & Salaries**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Review accruals for unpaid wages, overtime, and bonuses at year-end to ensure completeness.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 80: Inspect post year-end payments to identify any unrecorded liabilities.

- FS Line: **Wages & Salaries**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `urla` — Unrecorded-liabilities test: post-YE payments pipeline.

**Steps:**

 1. `request_documents`  — bindings: `{ document_type: 'bank_statement', area_of_work: $ctx.test.fsLine }`
 2. `extract_post_ye_bank_payments`  — bindings: `{ source_documents: $prev.documents }`
 3. `select_unrecorded_liabilities_sample`  — bindings: `{ population: $prev.data_table }`
 4. `request_documents`  — bindings: `{ document_type: 'invoice', transactions: $prev.sample_items }`
 5. `extract_accruals_evidence`  — bindings: `{ source_documents: $prev.documents, sample_items: $step.3.sample_items }`
 6. `verify_unrecorded_liabilities_sample`  — bindings: `{ sample_items: $step.3.sample_items, extracted_evidence: $prev.extracted_evidence }`
 7. `team_review`  — bindings: `{ instructions: 'Review URLA markers; reds need adjustment or disclosure.' }`

**New Actions referenced:** none (all existing).

---

### Test 81: Select samples of employees and trace salaries and wages recorded in the GL to supporting documentation such a

- FS Line: **Wages & Salaries**
- Assertion: **Occurence & Accuracy**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `sample_inspect` — Sample and inspect supporting contracts.

**Full description:**

> Select samples of employees and trace salaries and wages recorded in the GL to supporting documentation such as contracts, HR records, and payroll reports.

**Steps:**

 1. `accounting_extract`  — bindings: `{ data_type: 'journals', account_codes: $ctx.test.fsLineAccounts }`
 2. `select_sample`  — bindings: `{ population: $prev.data_table }`
 3. `request_documents`  — bindings: `{ transactions: $prev.sample_items, document_type: 'contract', area_of_work: $ctx.test.fsLine }`
 4. `verify_evidence`  — bindings: `{ evidence_documents: $prev.documents, sample_items: $step.2.sample_items, assertions: ['occurence'] }`
 5. `team_review`  — bindings: `{ instructions: 'Conclude on assertion testing.' }`

**New Actions referenced:** none (all existing).

---

### Test 82: Verify that only valid employees are included in payroll (no ghost employees).

- FS Line: **Wages & Salaries**
- Assertion: **Occurence & Accuracy**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Verify that only valid employees are included in payroll (no ghost employees).', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 83: Check pay rates, hours worked, and authorised deductions to ensure amounts are calculated accurately.

- FS Line: **Wages & Salaries**
- Assertion: **Occurence & Accuracy**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check pay rates, hours worked, and authorised deductions to ensure amounts are calculated accurately.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 84: Recalculate sample payroll amounts and agree totals to payslips or bank transfer records.

- FS Line: **Wages & Salaries**
- Assertion: **Occurence & Accuracy**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Recalculate sample payroll amounts and agree totals to payslips or bank transfer records.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 85: Test payroll expenses recorded immediately before and after year-end to ensure they are recorded in the correc

- FS Line: **Wages & Salaries**
- Assertion: **Cut Off**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `cutoff` — Cut-off test either side of period end.

**Full description:**

> Test payroll expenses recorded immediately before and after year-end to ensure they are recorded in the correct accounting period.

**Steps:**

 1. `accounting_extract`  — bindings: `{ data_type: 'journals', account_codes: $ctx.test.fsLineAccounts }`
 2. `analyse_cut_off`  — bindings: `{ data_table: $prev.data_table, period_end: $ctx.engagement.periodEnd, cut_off_days: 7 }`
 3. `team_review`  — bindings: `{ instructions: 'Review any cut-off exceptions.' }`

**New Actions referenced:** none (all existing).

---

### Test 86: Review payroll accruals and prepayments to ensure proper allocation between periods.

- FS Line: **Wages & Salaries**
- Assertion: **Cut Off**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `cutoff` — Cut-off test either side of period end.

**Steps:**

 1. `accounting_extract`  — bindings: `{ data_type: 'journals', account_codes: $ctx.test.fsLineAccounts }`
 2. `analyse_cut_off`  — bindings: `{ data_table: $prev.data_table, period_end: $ctx.engagement.periodEnd, cut_off_days: 7 }`
 3. `team_review`  — bindings: `{ instructions: 'Review any cut-off exceptions.' }`

**New Actions referenced:** none (all existing).

---

### Test 87: Inspect year-end adjustments for salaries, bonuses, and social security contributions.

- FS Line: **Wages & Salaries**
- Assertion: **Cut Off**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `cutoff` — Cut-off test either side of period end.

**Steps:**

 1. `accounting_extract`  — bindings: `{ data_type: 'journals', account_codes: $ctx.test.fsLineAccounts }`
 2. `analyse_cut_off`  — bindings: `{ data_table: $prev.data_table, period_end: $ctx.engagement.periodEnd, cut_off_days: 7 }`
 3. `team_review`  — bindings: `{ instructions: 'Review any cut-off exceptions.' }`

**New Actions referenced:** none (all existing).

---

### Test 88: Review postings to confirm that salaries, wages, bonuses, and related costs are classified correctly (e.g., ad

- FS Line: **Wages & Salaries**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Full description:**

> Review postings to confirm that salaries, wages, bonuses, and related costs are classified correctly (e.g., admin expenses, cost of sales, distribution costs).

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Wages & Salaries transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 89: Ensure that employer’s contributions (e.g., pension, social security, payroll taxes) are classified appropriat

- FS Line: **Wages & Salaries**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Full description:**

> Ensure that employer’s contributions (e.g., pension, social security, payroll taxes) are classified appropriately.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Wages & Salaries transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 90: Verify that capitalised staff costs (e.g., development costs under IAS 38, construction under IAS 16) meet rec

- FS Line: **Wages & Salaries**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Full description:**

> Verify that capitalised staff costs (e.g., development costs under IAS 38, construction under IAS 16) meet recognition criteria (if any).

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Wages & Salaries transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 91: Check for consistency with prior periods.

- FS Line: **Wages & Salaries**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Wages & Salaries transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 92: Review financial statement disclosures to ensure compliance with as required under financial reporting framewo

- FS Line: **Wages & Salaries**
- Assertion: **Presentation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `disclosure` — Review disclosures for compliance with framework.

**Full description:**

> Review financial statement disclosures to ensure compliance with as required under financial reporting framework.

**Steps:**

 1. `review_disclosures` 🆕 — bindings: `{ fs_line: $ctx.test.fsLine, framework: $ctx.engagement.framework }`
 2. `team_review`  — bindings: `{ instructions: 'Review disclosure-checklist exceptions.' }`

**New Actions referenced:**

 - `review_disclosures` — Review FS Disclosures (FS Line)

---

### Test 93: Confirm that directors’ remuneration and key management compensation are disclosed separately as required unde

- FS Line: **Wages & Salaries**
- Assertion: **Presentation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `disclosure` — Review disclosures for compliance with framework.

**Full description:**

> Confirm that directors’ remuneration and key management compensation are disclosed separately as required under financial reporting framework.

**Steps:**

 1. `review_disclosures` 🆕 — bindings: `{ fs_line: $ctx.test.fsLine, framework: $ctx.engagement.framework }`
 2. `team_review`  — bindings: `{ instructions: 'Review disclosure-checklist exceptions.' }`

**New Actions referenced:**

 - `review_disclosures` — Review FS Disclosures (FS Line)

---

### Test 94: Ensure pension and other post-employment benefit costs are presented and disclosed as required under financial

- FS Line: **Wages & Salaries**
- Assertion: **Presentation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `disclosure` — Review disclosures for compliance with framework.

**Full description:**

> Ensure pension and other post-employment benefit costs are presented and disclosed as required under financial reporting framework.

**Steps:**

 1. `review_disclosures` 🆕 — bindings: `{ fs_line: $ctx.test.fsLine, framework: $ctx.engagement.framework }`
 2. `team_review`  — bindings: `{ instructions: 'Review disclosure-checklist exceptions.' }`

**New Actions referenced:**

 - `review_disclosures` — Review FS Disclosures (FS Line)

---

### Test 95: Cross-check totals per payroll disclosures to GL, payroll records, and supporting schedules.

- FS Line: **Wages & Salaries**
- Assertion: **Presentation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `disclosure` — Review disclosures for compliance with framework.

**Steps:**

 1. `review_disclosures` 🆕 — bindings: `{ fs_line: $ctx.test.fsLine, framework: $ctx.engagement.framework }`
 2. `team_review`  — bindings: `{ instructions: 'Review disclosure-checklist exceptions.' }`

**New Actions referenced:**

 - `review_disclosures` — Review FS Disclosures (FS Line)

---

### Test 96: Ensure accounting policies for employee benefits, payroll, and share-based payments (if applicable) are clearl

- FS Line: **Wages & Salaries**
- Assertion: **Presentation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `disclosure` — Review disclosures for compliance with framework.

**Full description:**

> Ensure accounting policies for employee benefits, payroll, and share-based payments (if applicable) are clearly disclosed.

**Steps:**

 1. `review_disclosures` 🆕 — bindings: `{ fs_line: $ctx.test.fsLine, framework: $ctx.engagement.framework }`
 2. `team_review`  — bindings: `{ instructions: 'Review disclosure-checklist exceptions.' }`

**New Actions referenced:**

 - `review_disclosures` — Review FS Disclosures (FS Line)

---

