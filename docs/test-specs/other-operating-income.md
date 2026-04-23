# Test Specs — Other Operating Income

Framework: FRS102   Significant Risk: Y   Test count: 21

Source CSV row range: 97–117

---

### Test 97: Review changes from PY if either >PM or 30% and obtain explanation for movement

- FS Line: **Other Operating Income**
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

### Test 98: Obtain an understanding of the processes for identifying and recording other operating income (e.g., grants, r

- FS Line: **Other Operating Income**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `walkthrough` — Walkthrough / management discussion.

**Full description:**

> Obtain an understanding of the processes for identifying and recording other operating income (e.g., grants, rental income, management fees, foreign exchange gains).

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Record walkthrough of the Other Operating Income process; document controls and design effectiveness.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 99: Reconcile other operating income per the general ledger/trial balance to supporting schedules maintained by ma

- FS Line: **Other Operating Income**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `listing_recon` — Obtain other listing and reconcile to TB.

**Full description:**

> Reconcile other operating income per the general ledger/trial balance to supporting schedules maintained by management.

**Steps:**

 1. `request_listing` 🆕 — bindings: `{ listing_type: 'other', account_codes: $ctx.test.fsLineAccounts }`
 2. `reconcile_to_tb` 🆕 — bindings: `{ data_table: $prev.data_table, account_codes: $ctx.test.fsLineAccounts }`
 3. `team_review`  — bindings: `{ instructions: 'Review reconciliation and any unreconciled items.' }`

**New Actions referenced:**

 - `request_listing` — Request Listing from Client
 - `reconcile_to_tb` — Reconcile Listing to Trial Balance

---

### Test 100: Perform analytical review by comparing income streams with prior periods and budgets to identify unusual varia

- FS Line: **Other Operating Income**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Full description:**

> Perform analytical review by comparing income streams with prior periods and budgets to identify unusual variances.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Perform analytical review by comparing income streams with prior periods and budgets to identify unusual variances.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 101: Review minutes of board meetings, contracts, and correspondence to identify potential income streams not recor

- FS Line: **Other Operating Income**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Full description:**

> Review minutes of board meetings, contracts, and correspondence to identify potential income streams not recorded.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Review minutes of board meetings, contracts, and correspondence to identify potential income streams not recorded.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 102: Inspect post year-end receipts to identify income that should have been recognised in the current year.

- FS Line: **Other Operating Income**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Inspect post year-end receipts to identify income that should have been recognised in the current year.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 103: Select samples of recorded other operating income and trace to supporting documentation (e.g., lease agreement

- FS Line: **Other Operating Income**
- Assertion: **Occurence & Accuracy**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `sample_inspect` — Sample and inspect supporting invoices.

**Full description:**

> Select samples of recorded other operating income and trace to supporting documentation (e.g., lease agreements, grant letters, invoices, bank receipts).

**Steps:**

 1. `accounting_extract`  — bindings: `{ data_type: 'journals', account_codes: $ctx.test.fsLineAccounts }`
 2. `select_sample`  — bindings: `{ population: $prev.data_table }`
 3. `request_documents`  — bindings: `{ transactions: $prev.sample_items, document_type: 'invoice', area_of_work: $ctx.test.fsLine }`
 4. `verify_evidence`  — bindings: `{ evidence_documents: $prev.documents, sample_items: $step.2.sample_items, assertions: ['occurence'] }`
 5. `team_review`  — bindings: `{ instructions: 'Conclude on assertion testing.' }`

**New Actions referenced:** none (all existing).

---

### Test 104: Verify that income recorded relates to the entity and represents genuine transactions.

- FS Line: **Other Operating Income**
- Assertion: **Occurence & Accuracy**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Verify that income recorded relates to the entity and represents genuine transactions.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 105: Check accuracy of recorded amounts against agreements, calculations, or confirmations.

- FS Line: **Other Operating Income**
- Assertion: **Occurence & Accuracy**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `confirmations` — Send third-party confirmations (other).

**Steps:**

 1. `accounting_extract`  — bindings: `{ data_type: 'bank_transactions' if conf_type=='bank' else 'contacts', account_codes: $ctx.test.fsLineAccounts }`
 2. `select_sample`  — bindings: `{ population: $prev.data_table }`
 3. `request_confirmations` 🆕 — bindings: `{ confirmation_type: 'other', sample_items: $prev.sample_items }`
 4. `verify_evidence`  — bindings: `{ evidence_documents: $prev.confirmations, assertions: ['existence','valuation'] }`
 5. `team_review`  — bindings: `{ instructions: 'Review confirmation exceptions / non-responses and alternative procedures.' }`

**New Actions referenced:**

 - `request_confirmations` — Request Third-Party Confirmations

---

### Test 106: Where income involves estimates (e.g., government grants, service allocations), evaluate the appropriateness o

- FS Line: **Other Operating Income**
- Assertion: **Occurence & Accuracy**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `estimates` — Assess management estimate / judgement.

**Full description:**

> Where income involves estimates (e.g., government grants, service allocations), evaluate the appropriateness of management’s methodology.

**Steps:**

 1. `request_documents`  — bindings: `{ document_type: 'other', area_of_work: $ctx.test.fsLine }`
 2. `assess_estimates` 🆕 — bindings: `{ estimate_type: 'other', supporting_schedule: $prev.documents }`
 3. `team_review`  — bindings: `{ instructions: 'Review estimate assessment and challenge.' }`

**New Actions referenced:**

 - `assess_estimates` — Assess Management Estimates

---

### Test 107: Test items of other operating income recorded immediately before and after year-end to ensure recognition in t

- FS Line: **Other Operating Income**
- Assertion: **Cut Off**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `cutoff` — Cut-off test either side of period end.

**Full description:**

> Test items of other operating income recorded immediately before and after year-end to ensure recognition in the correct period.

**Steps:**

 1. `accounting_extract`  — bindings: `{ data_type: 'journals', account_codes: $ctx.test.fsLineAccounts }`
 2. `analyse_cut_off`  — bindings: `{ data_table: $prev.data_table, period_end: $ctx.engagement.periodEnd, cut_off_days: 7 }`
 3. `team_review`  — bindings: `{ instructions: 'Review any cut-off exceptions.' }`

**New Actions referenced:** none (all existing).

---

### Test 108: Review terms of agreements (e.g., rental periods, grant conditions, service periods) to ensure income is alloc

- FS Line: **Other Operating Income**
- Assertion: **Cut Off**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `cutoff` — Cut-off test either side of period end.

**Full description:**

> Review terms of agreements (e.g., rental periods, grant conditions, service periods) to ensure income is allocated to the right reporting period.

**Steps:**

 1. `accounting_extract`  — bindings: `{ data_type: 'journals', account_codes: $ctx.test.fsLineAccounts }`
 2. `analyse_cut_off`  — bindings: `{ data_table: $prev.data_table, period_end: $ctx.engagement.periodEnd, cut_off_days: 7 }`
 3. `team_review`  — bindings: `{ instructions: 'Review any cut-off exceptions.' }`

**New Actions referenced:** none (all existing).

---

### Test 109: Inspect post year-end receipts and assess whether income should have been recognised earlier.

- FS Line: **Other Operating Income**
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

### Test 110: Review postings to confirm that other operating income is not misclassified as revenue, finance income, or exc

- FS Line: **Other Operating Income**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Full description:**

> Review postings to confirm that other operating income is not misclassified as revenue, finance income, or exceptional items unless appropriate.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Other Operating Income transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 111: Ensure different categories of other operating income (e.g., grants, rental income, service fees) are correctl

- FS Line: **Other Operating Income**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Full description:**

> Ensure different categories of other operating income (e.g., grants, rental income, service fees) are correctly classified in line with accounting policies.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Other Operating Income transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 112: Compare classification with prior periods for consistency.

- FS Line: **Other Operating Income**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Other Operating Income transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 113: Ensure related party income is separately identified.

- FS Line: **Other Operating Income**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Other Operating Income transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 114: Review financial statement presentation of other operating income for compliance with financial reporting fram

- FS Line: **Other Operating Income**
- Assertion: **Presentation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `disclosure` — Review disclosures for compliance with framework.

**Full description:**

> Review financial statement presentation of other operating income for compliance with financial reporting framework..

**Steps:**

 1. `review_disclosures` 🆕 — bindings: `{ fs_line: $ctx.test.fsLine, framework: $ctx.engagement.framework }`
 2. `team_review`  — bindings: `{ instructions: 'Review disclosure-checklist exceptions.' }`

**New Actions referenced:**

 - `review_disclosures` — Review FS Disclosures (FS Line)

---

### Test 115: Confirm that significant categories of other income are separately disclosed where material.

- FS Line: **Other Operating Income**
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

### Test 116: Cross-check note disclosures to GL, supporting schedules, and management accounts.

- FS Line: **Other Operating Income**
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

### Test 117: Ensure accounting policies for other income streams are clearly disclosed and consistently applied.

- FS Line: **Other Operating Income**
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

