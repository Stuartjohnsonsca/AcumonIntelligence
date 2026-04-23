# Test Specs — Loans and borrowings

Framework: FRS102   Significant Risk: Y   Test count: 18

Source CSV row range: 381–398

---

### Test 381: Review changes from PY if either >PM or 30% and obtain explanation for movement

- FS Line: **Loans and borrowings**
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

### Test 382: Obtain a complete schedule of all loans and borrowings and reconcile with the general ledger.

- FS Line: **Loans and borrowings**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `listing_recon` — Obtain loan_schedule listing and reconcile to TB.

**Steps:**

 1. `request_listing` 🆕 — bindings: `{ listing_type: 'loan_schedule', account_codes: $ctx.test.fsLineAccounts }`
 2. `reconcile_to_tb` 🆕 — bindings: `{ data_table: $prev.data_table, account_codes: $ctx.test.fsLineAccounts }`
 3. `team_review`  — bindings: `{ instructions: 'Review reconciliation and any unreconciled items.' }`

**New Actions referenced:**

 - `request_listing` — Request Listing from Client
 - `reconcile_to_tb` — Reconcile Listing to Trial Balance

---

### Test 383: Review loan agreements, drawdown schedules, and bank statements to ensure all borrowings are recorded. For new

- FS Line: **Loans and borrowings**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `listing_recon` — Obtain loan_schedule listing and reconcile to TB.

**Full description:**

> Review loan agreements, drawdown schedules, and bank statements to ensure all borrowings are recorded. For new borrowings during the year, obtain and review the loan agreements. Similarly for loans closed during the year, obtain and review evidence of closure.

**Steps:**

 1. `request_listing` 🆕 — bindings: `{ listing_type: 'loan_schedule', account_codes: $ctx.test.fsLineAccounts }`
 2. `reconcile_to_tb` 🆕 — bindings: `{ data_table: $prev.data_table, account_codes: $ctx.test.fsLineAccounts }`
 3. `team_review`  — bindings: `{ instructions: 'Review reconciliation and any unreconciled items.' }`

**New Actions referenced:**

 - `request_listing` — Request Listing from Client
 - `reconcile_to_tb` — Reconcile Listing to Trial Balance

---

### Test 384: Inspect subsequent borrowings or repayments after year-end to identify unrecorded liabilities.

- FS Line: **Loans and borrowings**
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

### Test 385: Verify correct classification of borrowings as current or non-current based on contractual terms and covenant 

- FS Line: **Loans and borrowings**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Full description:**

> Verify correct classification of borrowings as current or non-current based on contractual terms and covenant provisions.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Loans and borrowings transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 386: Check proper classification of interest and finance charges.

- FS Line: **Loans and borrowings**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Loans and borrowings transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 387: Confirm consistency with accounting policies and prior year.

- FS Line: **Loans and borrowings**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Loans and borrowings transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 388: Review presentation of loans and borrowings in the financial statements, including notes on terms, interest ra

- FS Line: **Loans and borrowings**
- Assertion: **Presentation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `disclosure` — Review disclosures for compliance with framework.

**Full description:**

> Review presentation of loans and borrowings in the financial statements, including notes on terms, interest rates, maturities, and covenants.

**Steps:**

 1. `review_disclosures` 🆕 — bindings: `{ fs_line: $ctx.test.fsLine, framework: $ctx.engagement.framework }`
 2. `team_review`  — bindings: `{ instructions: 'Review disclosure-checklist exceptions.' }`

**New Actions referenced:**

 - `review_disclosures` — Review FS Disclosures (FS Line)

---

### Test 389: Ensure disclosure of any covenant breaches, waivers, or restrictions imposed by lenders.

- FS Line: **Loans and borrowings**
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

### Test 390: Inspect loan agreements, confirmations from lenders, and drawdown schedules to verify balances.

- FS Line: **Loans and borrowings**
- Assertion: **Existence**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `confirmations` — Send third-party confirmations (creditor).

**Steps:**

 1. `accounting_extract`  — bindings: `{ data_type: 'bank_transactions' if conf_type=='bank' else 'contacts', account_codes: $ctx.test.fsLineAccounts }`
 2. `select_sample`  — bindings: `{ population: $prev.data_table }`
 3. `request_confirmations` 🆕 — bindings: `{ confirmation_type: 'creditor', sample_items: $prev.sample_items }`
 4. `verify_evidence`  — bindings: `{ evidence_documents: $prev.confirmations, assertions: ['existence','valuation'] }`
 5. `team_review`  — bindings: `{ instructions: 'Review confirmation exceptions / non-responses and alternative procedures.' }`

**New Actions referenced:**

 - `request_confirmations` — Request Third-Party Confirmations

---

### Test 391: Trace recorded borrowings to supporting documents and bank statements.

- FS Line: **Loans and borrowings**
- Assertion: **Existence**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `sample_inspect` — Sample and inspect supporting bank_statements.

**Steps:**

 1. `accounting_extract`  — bindings: `{ data_type: 'journals', account_codes: $ctx.test.fsLineAccounts }`
 2. `select_sample`  — bindings: `{ population: $prev.data_table }`
 3. `request_documents`  — bindings: `{ transactions: $prev.sample_items, document_type: 'bank_statement', area_of_work: $ctx.test.fsLine }`
 4. `verify_evidence`  — bindings: `{ evidence_documents: $prev.documents, sample_items: $step.2.sample_items, assertions: ['existence'] }`
 5. `team_review`  — bindings: `{ instructions: 'Conclude on assertion testing.' }`

**New Actions referenced:** none (all existing).

---

### Test 392: Recalculate interest accruals and repayments.

- FS Line: **Loans and borrowings**
- Assertion: **Valuation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `recalc_int` — Recalculate interest.

**Steps:**

 1. `request_listing` 🆕 — bindings: `{ listing_type: 'far' if 'depreciation' in policy_type else 'other' }`
 2. `recalculate_balance` 🆕 — bindings: `{ policy_type: 'interest', inputs: $prev.data_table }`
 3. `team_review`  — bindings: `{ instructions: 'Review recalculation variances.' }`

**New Actions referenced:**

 - `recalculate_balance` — Recalculate Balance

---

### Test 393: Check amortized cost or fair value measurement for borrowings under applicable standards.

- FS Line: **Loans and borrowings**
- Assertion: **Valuation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `fv` — Assess valuation / revaluation.

**Steps:**

 1. `request_documents`  — bindings: `{ document_type: 'other', area_of_work: $ctx.test.fsLine }`
 2. `assess_estimates` 🆕 — bindings: `{ estimate_type: 'fair_value', supporting_schedule: $prev.documents }`
 3. `team_review`  — bindings: `{ instructions: 'Review estimate assessment and challenge.' }`

**New Actions referenced:**

 - `assess_estimates` — Assess Management Estimates

---

### Test 394: Assess whether covenant breaches could result in accelerated repayment or penalties, and adjust valuation if n

- FS Line: **Loans and borrowings**
- Assertion: **Valuation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Full description:**

> Assess whether covenant breaches could result in accelerated repayment or penalties, and adjust valuation if necessary.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Assess whether covenant breaches could result in accelerated repayment or penalties, and adjust valuation if necessary.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 395: Inspect loan agreements, board resolutions, and correspondence with lenders to confirm the entity’s obligation

- FS Line: **Loans and borrowings**
- Assertion: **Rights & obligations**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `ownership` — Inspect ownership evidence (contracts, deeds, agreements).

**Full description:**

> Inspect loan agreements, board resolutions, and correspondence with lenders to confirm the entity’s obligations.

**Steps:**

 1. `select_sample`  — bindings: `{ population: $ctx.test.fsLineAccounts }`
 2. `request_documents`  — bindings: `{ document_type: 'contract', transactions: $prev.sample_items }`
 3. `review_contracts` 🆕 — bindings: `{ contract_sample: $prev.documents }`
 4. `team_review`  — bindings: `{ instructions: 'Review contract-terms alignment to recording.' }`

**New Actions referenced:**

 - `review_contracts` — Review Contracts / Agreements

---

### Test 396: Review compliance with covenants, including financial ratios and other conditions.

- FS Line: **Loans and borrowings**
- Assertion: **Rights & obligations**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `ownership` — Inspect ownership evidence (contracts, deeds, agreements).

**Steps:**

 1. `select_sample`  — bindings: `{ population: $ctx.test.fsLineAccounts }`
 2. `request_documents`  — bindings: `{ document_type: 'contract', transactions: $prev.sample_items }`
 3. `review_contracts` 🆕 — bindings: `{ contract_sample: $prev.documents }`
 4. `team_review`  — bindings: `{ instructions: 'Review contract-terms alignment to recording.' }`

**New Actions referenced:**

 - `review_contracts` — Review Contracts / Agreements

---

### Test 397: Check for pledges, guarantees, or restrictions triggered by covenants.

- FS Line: **Loans and borrowings**
- Assertion: **Rights & obligations**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `ownership` — Inspect ownership evidence (contracts, deeds, agreements).

**Steps:**

 1. `select_sample`  — bindings: `{ population: $ctx.test.fsLineAccounts }`
 2. `request_documents`  — bindings: `{ document_type: 'contract', transactions: $prev.sample_items }`
 3. `review_contracts` 🆕 — bindings: `{ contract_sample: $prev.documents }`
 4. `team_review`  — bindings: `{ instructions: 'Review contract-terms alignment to recording.' }`

**New Actions referenced:**

 - `review_contracts` — Review Contracts / Agreements

---

### Test 398: Confirm disclosure of any breaches, waivers, or potential consequences.

- FS Line: **Loans and borrowings**
- Assertion: **Rights & obligations**
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

