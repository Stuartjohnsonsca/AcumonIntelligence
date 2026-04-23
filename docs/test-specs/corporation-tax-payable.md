# Test Specs — Corporation tax payable

Framework: FRS102   Significant Risk: Y   Test count: 14

Source CSV row range: 495–508

---

### Test 495: Review changes from PY if either >PM or 30% and obtain explanation for movement

- FS Line: **Corporation tax payable**
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

### Test 496: Obtain a schedule of corporation tax payable and reconcile with the general ledger.

- FS Line: **Corporation tax payable**
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

### Test 497: Review tax computations and correspondence with HMRC to ensure all liabilities are recorded.

- FS Line: **Corporation tax payable**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `recalc_tax` — Recalculate tax provision.

**Steps:**

 1. `request_listing` 🆕 — bindings: `{ listing_type: 'far' if 'depreciation' in policy_type else 'other' }`
 2. `recalculate_balance` 🆕 — bindings: `{ policy_type: 'tax', inputs: $prev.data_table }`
 3. `team_review`  — bindings: `{ instructions: 'Review recalculation variances.' }`

**New Actions referenced:**

 - `recalculate_balance` — Recalculate Balance

---

### Test 498: Inspect payments made after year-end for unrecorded liabilities.

- FS Line: **Corporation tax payable**
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

### Test 499: Verify that corporation tax payable is classified correctly as a current liability.

- FS Line: **Corporation tax payable**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Corporation tax payable transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 500: Ensure separation from deferred tax and other tax payables.

- FS Line: **Corporation tax payable**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Corporation tax payable transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 501: Review financial statement presentation, including notes on corporation tax.

- FS Line: **Corporation tax payable**
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

### Test 502: Ensure disclosures include basis of calculation, payments made, and any outstanding disputes or uncertainties.

- FS Line: **Corporation tax payable**
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

### Test 503: Inspect supporting tax computations, tax returns, and HMRC correspondence to verify balances.

- FS Line: **Corporation tax payable**
- Assertion: **Existence**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `recalc_tax` — Recalculate tax provision.

**Steps:**

 1. `request_listing` 🆕 — bindings: `{ listing_type: 'far' if 'depreciation' in policy_type else 'other' }`
 2. `recalculate_balance` 🆕 — bindings: `{ policy_type: 'tax', inputs: $prev.data_table }`
 3. `team_review`  — bindings: `{ instructions: 'Review recalculation variances.' }`

**New Actions referenced:**

 - `recalculate_balance` — Recalculate Balance

---

### Test 504: Trace recorded liabilities to supporting documents.

- FS Line: **Corporation tax payable**
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

### Test 505: Recalculate corporation tax liability based on taxable profits, tax rates, and adjustments.

- FS Line: **Corporation tax payable**
- Assertion: **Valuation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `recalc_tax` — Recalculate tax provision.

**Steps:**

 1. `request_listing` 🆕 — bindings: `{ listing_type: 'far' if 'depreciation' in policy_type else 'other' }`
 2. `recalculate_balance` 🆕 — bindings: `{ policy_type: 'tax', inputs: $prev.data_table }`
 3. `team_review`  — bindings: `{ instructions: 'Review recalculation variances.' }`

**New Actions referenced:**

 - `recalculate_balance` — Recalculate Balance

---

### Test 506: Review provisions for uncertain tax positions, interest, and penalties.

- FS Line: **Corporation tax payable**
- Assertion: **Valuation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Review provisions for uncertain tax positions, interest, and penalties.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 507: Review correspondence with HMRC and relevant agreements to confirm the entity’s obligation to pay corporation 

- FS Line: **Corporation tax payable**
- Assertion: **Rights & obligations**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `ownership` — Inspect ownership evidence (contracts, deeds, agreements).

**Full description:**

> Review correspondence with HMRC and relevant agreements to confirm the entity’s obligation to pay corporation tax.

**Steps:**

 1. `select_sample`  — bindings: `{ population: $ctx.test.fsLineAccounts }`
 2. `request_documents`  — bindings: `{ document_type: 'contract', transactions: $prev.sample_items }`
 3. `review_contracts` 🆕 — bindings: `{ contract_sample: $prev.documents }`
 4. `team_review`  — bindings: `{ instructions: 'Review contract-terms alignment to recording.' }`

**New Actions referenced:**

 - `review_contracts` — Review Contracts / Agreements

---

### Test 508: Check for any disputes or deferred payment arrangements.

- FS Line: **Corporation tax payable**
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

