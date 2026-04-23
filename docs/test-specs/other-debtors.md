# Test Specs — Other debtors

Framework: FRS102   Significant Risk: Y   Test count: 17

Source CSV row range: 364–380

---

### Test 364: Review changes from PY if either >PM or 30% and obtain explanation for movement

- FS Line: **Other debtors**
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

### Test 365: Obtain a complete listing of other debtors and reconcile with the general ledger.

- FS Line: **Other debtors**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `listing_recon` — Obtain debtors_ageing listing and reconcile to TB.

**Steps:**

 1. `request_listing` 🆕 — bindings: `{ listing_type: 'debtors_ageing', account_codes: $ctx.test.fsLineAccounts }`
 2. `reconcile_to_tb` 🆕 — bindings: `{ data_table: $prev.data_table, account_codes: $ctx.test.fsLineAccounts }`
 3. `team_review`  — bindings: `{ instructions: 'Review reconciliation and any unreconciled items.' }`

**New Actions referenced:**

 - `request_listing` — Request Listing from Client
 - `reconcile_to_tb` — Reconcile Listing to Trial Balance

---

### Test 366: Review supporting invoices, agreements, and correspondence to ensure all amounts are recorded.

- FS Line: **Other debtors**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Review supporting invoices, agreements, and correspondence to ensure all amounts are recorded.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 367: Inspect post-year-end receipts to identify unrecorded balances.

- FS Line: **Other debtors**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Inspect post-year-end receipts to identify unrecorded balances.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 368: Verify that other debtors are correctly classified as current or non-current assets.

- FS Line: **Other debtors**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Other debtors transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 369: Check that balances are not misclassified as trade receivables, prepayments, or investments.

- FS Line: **Other debtors**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Other debtors transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 370: Confirm consistency with accounting policies and prior year.

- FS Line: **Other debtors**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Other debtors transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 371: Review disclosures for other debtors, including nature of balances, related party transactions, and aging.

- FS Line: **Other debtors**
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

### Test 372: Ensure balances are presented separately from trade receivables and other assets.

- FS Line: **Other debtors**
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

### Test 373: Inspect supporting documentation such as invoices, agreements, and correspondence.

- FS Line: **Other debtors**
- Assertion: **Existence**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `sample_inspect` — Sample and inspect supporting invoices.

**Steps:**

 1. `accounting_extract`  — bindings: `{ data_type: 'journals', account_codes: $ctx.test.fsLineAccounts }`
 2. `select_sample`  — bindings: `{ population: $prev.data_table }`
 3. `request_documents`  — bindings: `{ transactions: $prev.sample_items, document_type: 'invoice', area_of_work: $ctx.test.fsLine }`
 4. `verify_evidence`  — bindings: `{ evidence_documents: $prev.documents, sample_items: $step.2.sample_items, assertions: ['existence'] }`
 5. `team_review`  — bindings: `{ instructions: 'Conclude on assertion testing.' }`

**New Actions referenced:** none (all existing).

---

### Test 374: Send confirmations to debtors where material and appropriate.

- FS Line: **Other debtors**
- Assertion: **Existence**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `confirmations` — Send third-party confirmations (debtor).

**Steps:**

 1. `accounting_extract`  — bindings: `{ data_type: 'bank_transactions' if conf_type=='bank' else 'contacts', account_codes: $ctx.test.fsLineAccounts }`
 2. `select_sample`  — bindings: `{ population: $prev.data_table }`
 3. `request_confirmations` 🆕 — bindings: `{ confirmation_type: 'debtor', sample_items: $prev.sample_items }`
 4. `verify_evidence`  — bindings: `{ evidence_documents: $prev.confirmations, assertions: ['existence','valuation'] }`
 5. `team_review`  — bindings: `{ instructions: 'Review confirmation exceptions / non-responses and alternative procedures.' }`

**New Actions referenced:**

 - `request_confirmations` — Request Third-Party Confirmations

---

### Test 375: Verify cutoff by checking post-year-end receipts.

- FS Line: **Other debtors**
- Assertion: **Existence**
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

### Test 376: Assess recoverability of other debtors and consider allowances for doubtful debts.

- FS Line: **Other debtors**
- Assertion: **Valuation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Assess recoverability of other debtors and consider allowances for doubtful debts.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 377: Test calculations for accuracy and reasonableness.

- FS Line: **Other debtors**
- Assertion: **Valuation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `estimates` — Assess management estimate / judgement.

**Steps:**

 1. `request_documents`  — bindings: `{ document_type: 'other', area_of_work: $ctx.test.fsLine }`
 2. `assess_estimates` 🆕 — bindings: `{ estimate_type: 'other', supporting_schedule: $prev.documents }`
 3. `team_review`  — bindings: `{ instructions: 'Review estimate assessment and challenge.' }`

**New Actions referenced:**

 - `assess_estimates` — Assess Management Estimates

---

### Test 378: Ensure amounts are recorded net of any provisions.

- FS Line: **Other debtors**
- Assertion: **Valuation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Ensure amounts are recorded net of any provisions.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 379: Inspect agreements, contracts, or invoices to confirm the entity’s rights to collect the balances.

- FS Line: **Other debtors**
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

### Test 380: Check for any restrictions, pledges, or offset arrangements affecting the balances.

- FS Line: **Other debtors**
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

