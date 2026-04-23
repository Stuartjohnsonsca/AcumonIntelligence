# Test Specs — Operating Expenses

Framework: FRS102   Significant Risk: Y   Test count: 24

Source CSV row range: 51–74

---

### Test 51: Review changes from PY if either >PM or 30% and obtain explanation for movement

- FS Line: **Operating Expenses**
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

### Test 52: Obtain an understanding of the process for recording admin expenses and assess design effectiveness of related

- FS Line: **Operating Expenses**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `walkthrough` — Walkthrough / management discussion.

**Full description:**

> Obtain an understanding of the process for recording admin expenses and assess design effectiveness of related controls (e.g., invoice processing, approval workflows).

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Record walkthrough of the Operating Expenses process; document controls and design effectiveness.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 53: Perform reconciliation of expense listings to the GL/TB to Ensure all expenses are captured.

- FS Line: **Operating Expenses**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Perform reconciliation of expense listings to the GL/TB to Ensure all expenses are captured.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 54: Review accruals for unrecorded expenses and test for completeness.

- FS Line: **Operating Expenses**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Review accruals for unrecorded expenses and test for completeness.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 55: Perform analytical review by comparing admin expense categories to prior periods and budgets to identify anoma

- FS Line: **Operating Expenses**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Full description:**

> Perform analytical review by comparing admin expense categories to prior periods and budgets to identify anomalies.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Perform analytical review by comparing admin expense categories to prior periods and budgets to identify anomalies.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 56: Perform search for unrecorded liabilities (review post year-end payments, supplier statements)

- FS Line: **Operating Expenses**
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

### Test 57: Select a sample of expenses and trace to supporting documents (invoices, contracts, expense claims) to confirm

- FS Line: **Operating Expenses**
- Assertion: **Occurence & Accuracy**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `sample_inspect` — Sample and inspect supporting contracts.

**Full description:**

> Select a sample of expenses and trace to supporting documents (invoices, contracts, expense claims) to confirm validity and accuracy.

**Steps:**

 1. `accounting_extract`  — bindings: `{ data_type: 'journals', account_codes: $ctx.test.fsLineAccounts }`
 2. `select_sample`  — bindings: `{ population: $prev.data_table }`
 3. `request_documents`  — bindings: `{ transactions: $prev.sample_items, document_type: 'contract', area_of_work: $ctx.test.fsLine }`
 4. `verify_evidence`  — bindings: `{ evidence_documents: $prev.documents, sample_items: $step.2.sample_items, assertions: ['occurence'] }`
 5. `team_review`  — bindings: `{ instructions: 'Conclude on assertion testing.' }`

**New Actions referenced:** none (all existing).

---

### Test 58: Verify that expenses relate to the entity’s business operations and are not personal/non-business in nature.

- FS Line: **Operating Expenses**
- Assertion: **Occurence & Accuracy**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Verify that expenses relate to the entity’s business operations and are not personal/non-business in nature.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 59: Check accuracy of recorded amounts against supplier invoices and underlying contracts.

- FS Line: **Operating Expenses**
- Assertion: **Occurence & Accuracy**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check accuracy of recorded amounts against supplier invoices and underlying contracts.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 60: For foreign currency expenses, test the application of exchange rates.

- FS Line: **Operating Expenses**
- Assertion: **Occurence & Accuracy**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `fx` — Test FX translation on foreign-currency balances.

**Steps:**

 1. `request_listing` 🆕 — bindings: `{ listing_type: 'far' if 'depreciation' in policy_type else 'other' }`
 2. `recalculate_balance` 🆕 — bindings: `{ policy_type: 'fx', inputs: $prev.data_table }`
 3. `team_review`  — bindings: `{ instructions: 'Review recalculation variances.' }`

**New Actions referenced:**

 - `recalculate_balance` — Recalculate Balance

---

### Test 61: Consider fraud risks (e.g., duplicate payments, management override, misallocation of personal expenses).

- FS Line: **Operating Expenses**
- Assertion: **Occurence & Accuracy**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `fraud` — Scan for fraud-risk indicators.

**Steps:**

 1. `review_fraud_risk` 🆕 — bindings: `{ fs_line: $ctx.test.fsLine, period_end: $ctx.engagement.periodEnd }`
 2. `team_review`  — bindings: `{ instructions: 'Review fraud-risk scan results.' }`

**New Actions referenced:**

 - `review_fraud_risk` — Review Fraud Risk Indicators

---

### Test 62: Clearly define the cut-off period relevant for performing the procedure, considering management’s timeline for

- FS Line: **Operating Expenses**
- Assertion: **Cut Off**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `cutoff` — Cut-off test either side of period end.

**Full description:**

> Clearly define the cut-off period relevant for performing the procedure, considering management’s timeline for closing accounts before and after year-end.

**Steps:**

 1. `accounting_extract`  — bindings: `{ data_type: 'journals', account_codes: $ctx.test.fsLineAccounts }`
 2. `analyse_cut_off`  — bindings: `{ data_table: $prev.data_table, period_end: $ctx.engagement.periodEnd, cut_off_days: 7 }`
 3. `team_review`  — bindings: `{ instructions: 'Review any cut-off exceptions.' }`

**New Actions referenced:** none (all existing).

---

### Test 63: Test a sample of expenses recorded just before and after year-end to ensure they are recorded in the correct a

- FS Line: **Operating Expenses**
- Assertion: **Cut Off**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `cutoff` — Cut-off test either side of period end.

**Full description:**

> Test a sample of expenses recorded just before and after year-end to ensure they are recorded in the correct accounting period.

**Steps:**

 1. `accounting_extract`  — bindings: `{ data_type: 'journals', account_codes: $ctx.test.fsLineAccounts }`
 2. `analyse_cut_off`  — bindings: `{ data_table: $prev.data_table, period_end: $ctx.engagement.periodEnd, cut_off_days: 7 }`
 3. `team_review`  — bindings: `{ instructions: 'Review any cut-off exceptions.' }`

**New Actions referenced:** none (all existing).

---

### Test 64: Review accruals and prepayments to ensure costs are recognised in the right period.

- FS Line: **Operating Expenses**
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

### Test 65: Inspect post year-end invoices to determine whether related expenses should have been recorded in the prior ye

- FS Line: **Operating Expenses**
- Assertion: **Cut Off**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `cutoff` — Cut-off test either side of period end.

**Full description:**

> Inspect post year-end invoices to determine whether related expenses should have been recorded in the prior year.

**Steps:**

 1. `accounting_extract`  — bindings: `{ data_type: 'journals', account_codes: $ctx.test.fsLineAccounts }`
 2. `analyse_cut_off`  — bindings: `{ data_table: $prev.data_table, period_end: $ctx.engagement.periodEnd, cut_off_days: 7 }`
 3. `team_review`  — bindings: `{ instructions: 'Review any cut-off exceptions.' }`

**New Actions referenced:** none (all existing).

---

### Test 66: Review expense accounts to confirm admin expenses are not misclassified as cost of sales, finance costs, or ca

- FS Line: **Operating Expenses**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Full description:**

> Review expense accounts to confirm admin expenses are not misclassified as cost of sales, finance costs, or capitalised as assets (unless appropriate, e.g., development costs under IAS 38).

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Operating Expenses transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 67: Test samples to ensure consistent allocation across appropriate categories (e.g., staff costs, professional fe

- FS Line: **Operating Expenses**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Full description:**

> Test samples to ensure consistent allocation across appropriate categories (e.g., staff costs, professional fees, IT, premises).

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Operating Expenses transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 68: Compare with prior periods to assess consistency of classification.

- FS Line: **Operating Expenses**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Operating Expenses transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 69: Ensure related party transactions are identified and appropriately classified.

- FS Line: **Operating Expenses**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Operating Expenses transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 70: Review disclosures in the FS to ensure compliance with requirements under financial reporting framework.

- FS Line: **Operating Expenses**
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

### Test 71: Confirm that significant categories of admin expenses are separately disclosed where material (e.g., audit fee

- FS Line: **Operating Expenses**
- Assertion: **Presentation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `disclosure` — Review disclosures for compliance with framework.

**Full description:**

> Confirm that significant categories of admin expenses are separately disclosed where material (e.g., audit fees, directors’ remuneration, R&D costs).

**Steps:**

 1. `review_disclosures` 🆕 — bindings: `{ fs_line: $ctx.test.fsLine, framework: $ctx.engagement.framework }`
 2. `team_review`  — bindings: `{ instructions: 'Review disclosure-checklist exceptions.' }`

**New Actions referenced:**

 - `review_disclosures` — Review FS Disclosures (FS Line)

---

### Test 72: Ensure related party expenses are disclosed in line with IAS 24.

- FS Line: **Operating Expenses**
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

### Test 73: Cross-check totals per note disclosures to TB/GL and management accounts.

- FS Line: **Operating Expenses**
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

### Test 74: Ensure accounting policies for expense recognition and presentation are clear and appropriately disclosed.

- FS Line: **Operating Expenses**
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

