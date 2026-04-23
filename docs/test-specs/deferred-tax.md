# Test Specs — Deferred tax

Framework: FRS102   Significant Risk: Y   Test count: 17

Source CSV row range: 330–346

---

### Test 330: Review changes from PY if either >PM or 30% and obtain explanation for movement

- FS Line: **Deferred tax**
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

### Test 331: Obtain a detailed schedule of deferred tax assets from management and reconcile to the general ledger.

- FS Line: **Deferred tax**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `listing_recon` — Obtain deferred_tax listing and reconcile to TB.

**Steps:**

 1. `request_listing` 🆕 — bindings: `{ listing_type: 'deferred_tax', account_codes: $ctx.test.fsLineAccounts }`
 2. `reconcile_to_tb` 🆕 — bindings: `{ data_table: $prev.data_table, account_codes: $ctx.test.fsLineAccounts }`
 3. `team_review`  — bindings: `{ instructions: 'Review reconciliation and any unreconciled items.' }`

**New Actions referenced:**

 - `request_listing` — Request Listing from Client
 - `reconcile_to_tb` — Reconcile Listing to Trial Balance

---

### Test 332: Review temporary differences, carryforwards, and adjustments for completeness.

- FS Line: **Deferred tax**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Review temporary differences, carryforwards, and adjustments for completeness.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 333: Inspect tax computations, tax returns, and supporting documents to ensure all DTAs are recorded.

- FS Line: **Deferred tax**
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

### Test 334: Verify correct classification of deferred tax assets as non-current.

- FS Line: **Deferred tax**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Deferred tax transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 335: Check proper separation from deferred tax liabilities.

- FS Line: **Deferred tax**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Deferred tax transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 336: Ensure consistency with prior year and accounting policy.

- FS Line: **Deferred tax**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `policy` — Review accounting-policy compliance.

**Steps:**

 1. `analyse_accounting_policy` 🆕 — bindings: `{ framework: $ctx.engagement.framework, fs_line: $ctx.test.fsLine }`
 2. `team_review`  — bindings: `{ instructions: 'Review policy-compliance findings.' }`

**New Actions referenced:**

 - `analyse_accounting_policy` — Analyse Accounting Policy Compliance

---

### Test 337: Review disclosures of deferred tax assets, including nature, movement, and unrecognized amounts.

- FS Line: **Deferred tax**
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

### Test 338: Check presentation in the statement of financial position and notes.

- FS Line: **Deferred tax**
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

### Test 339: Inspect supporting evidence for DTAs, including temporary differences schedules, tax returns, and accounting r

- FS Line: **Deferred tax**
- Assertion: **Existence**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Full description:**

> Inspect supporting evidence for DTAs, including temporary differences schedules, tax returns, and accounting records.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Inspect supporting evidence for DTAs, including temporary differences schedules, tax returns, and accounting records.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 340: Confirm the existence of deductible temporary differences and unused tax losses.

- FS Line: **Deferred tax**
- Assertion: **Existence**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Confirm the existence of deductible temporary differences and unused tax losses.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 341: Assess the recoverability of DTAs based on future taxable profits.

- FS Line: **Deferred tax**
- Assertion: **Valuation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Assess the recoverability of DTAs based on future taxable profits.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 342: Review management assumptions and forecasts used for realization.

- FS Line: **Deferred tax**
- Assertion: **Valuation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Review management assumptions and forecasts used for realization.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 343: Test calculations for accuracy, including tax rates and timing of reversal.

- FS Line: **Deferred tax**
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

### Test 344: Consider impairment of deferred tax assets if recovery is uncertain.

- FS Line: **Deferred tax**
- Assertion: **Valuation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `impairment` — Assess impairment indicators and review.

**Steps:**

 1. `request_documents`  — bindings: `{ document_type: 'other', area_of_work: $ctx.test.fsLine }`
 2. `assess_estimates` 🆕 — bindings: `{ estimate_type: 'impairment', supporting_schedule: $prev.documents }`
 3. `team_review`  — bindings: `{ instructions: 'Review estimate assessment and challenge.' }`

**New Actions referenced:**

 - `assess_estimates` — Assess Management Estimates

---

### Test 345: Inspect relevant tax filings and correspondence to confirm the entity has rights to the tax benefits.

- FS Line: **Deferred tax**
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

### Test 346: Review any agreements or restrictions that may affect recognition of DTAs.

- FS Line: **Deferred tax**
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

