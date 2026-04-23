# Test Specs — Property plant and equipment

Framework: FRS102   Significant Risk: Y   Test count: 21

Source CSV row range: 185–205

---

### Test 185: Review changes from PY if either >PM or 30% and obtain explanation for movement

- FS Line: **Property plant and equipment**
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

### Test 186: Review fixed asset register (FAR) and reconcile to the general ledger and trial balance.

- FS Line: **Property plant and equipment**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `listing_recon` — Obtain far listing and reconcile to TB.

**Steps:**

 1. `request_listing` 🆕 — bindings: `{ listing_type: 'far', account_codes: $ctx.test.fsLineAccounts }`
 2. `reconcile_to_tb` 🆕 — bindings: `{ data_table: $prev.data_table, account_codes: $ctx.test.fsLineAccounts }`
 3. `team_review`  — bindings: `{ instructions: 'Review reconciliation and any unreconciled items.' }`

**New Actions referenced:**

 - `request_listing` — Request Listing from Client
 - `reconcile_to_tb` — Reconcile Listing to Trial Balance

---

### Test 187: Test a sample of additions by tracing to purchase invoices, contracts, and approvals to confirm all assets are

- FS Line: **Property plant and equipment**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `sample_inspect` — Sample and inspect supporting contracts.

**Full description:**

> Test a sample of additions by tracing to purchase invoices, contracts, and approvals to confirm all assets are recorded.

**Steps:**

 1. `accounting_extract`  — bindings: `{ data_type: 'journals', account_codes: $ctx.test.fsLineAccounts }`
 2. `select_sample`  — bindings: `{ population: $prev.data_table }`
 3. `request_documents`  — bindings: `{ transactions: $prev.sample_items, document_type: 'contract', area_of_work: $ctx.test.fsLine }`
 4. `verify_evidence`  — bindings: `{ evidence_documents: $prev.documents, sample_items: $step.2.sample_items, assertions: ['completeness'] }`
 5. `team_review`  — bindings: `{ instructions: 'Conclude on assertion testing.' }`

**New Actions referenced:** none (all existing).

---

### Test 188: Review repairs and maintenance expense accounts for potential capital expenditure that should be reclassified.

- FS Line: **Property plant and equipment**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `ecl` — Assess ECL / bad-debt provision.

**Steps:**

 1. `request_documents`  — bindings: `{ document_type: 'other', area_of_work: $ctx.test.fsLine }`
 2. `assess_estimates` 🆕 — bindings: `{ estimate_type: 'ecl', supporting_schedule: $prev.documents }`
 3. `team_review`  — bindings: `{ instructions: 'Review estimate assessment and challenge.' }`

**New Actions referenced:**

 - `assess_estimates` — Assess Management Estimates

---

### Test 189: Inspect board minutes, budgets for evidence of unrecorded assets.

- FS Line: **Property plant and equipment**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `board_minutes` — AI scan of board minutes / budgets for unrecorded items.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Scan board minutes and contracts for indications of unrecorded assets/liabilities for {fs_line}.' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI findings from minutes.' }`

**New Actions referenced:** none (all existing).

---

### Test 190: Ensure additions are correctly classified between PPE categories (land, buildings, plant, fixtures, etc.).

- FS Line: **Property plant and equipment**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Property plant and equipment transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 191: Review construction-in-progress balances to ensure correct classification and transfer to appropriate asset ca

- FS Line: **Property plant and equipment**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Full description:**

> Review construction-in-progress balances to ensure correct classification and transfer to appropriate asset category once complete.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Property plant and equipment transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 192: Review financial statements to ensure PPE is presented separately from other non-current assets.

- FS Line: **Property plant and equipment**
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

### Test 193: Ensure accumulated depreciation and impairment are disclosed separately from gross cost.

- FS Line: **Property plant and equipment**
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

### Test 194: Verify disclosure of accounting policies, depreciation methods, useful lives, restrictions on title, and pledg

- FS Line: **Property plant and equipment**
- Assertion: **Presentation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `disclosure` — Review disclosures for compliance with framework.

**Full description:**

> Verify disclosure of accounting policies, depreciation methods, useful lives, restrictions on title, and pledged assets.

**Steps:**

 1. `review_disclosures` 🆕 — bindings: `{ fs_line: $ctx.test.fsLine, framework: $ctx.engagement.framework }`
 2. `team_review`  — bindings: `{ instructions: 'Review disclosure-checklist exceptions.' }`

**New Actions referenced:**

 - `review_disclosures` — Review FS Disclosures (FS Line)

---

### Test 195: Check disclosure of contractual commitments for acquisition of PPE.

- FS Line: **Property plant and equipment**
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

### Test 196: Perform physical verification of PPE (on a sample basis) and reconcile to the FAR.

- FS Line: **Property plant and equipment**
- Assertion: **Existence**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `listing_recon` — Obtain far listing and reconcile to TB.

**Steps:**

 1. `request_listing` 🆕 — bindings: `{ listing_type: 'far', account_codes: $ctx.test.fsLineAccounts }`
 2. `reconcile_to_tb` 🆕 — bindings: `{ data_table: $prev.data_table, account_codes: $ctx.test.fsLineAccounts }`
 3. `team_review`  — bindings: `{ instructions: 'Review reconciliation and any unreconciled items.' }`

**New Actions referenced:**

 - `request_listing` — Request Listing from Client
 - `reconcile_to_tb` — Reconcile Listing to Trial Balance

---

### Test 197: Inspect asset tags, serial numbers, and location to confirm physical existence.

- FS Line: **Property plant and equipment**
- Assertion: **Existence**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `physical` — Physical verification of ppe.

**Steps:**

 1. `request_listing` 🆕 — bindings: `{ listing_type: 'far' if item_type=='ppe' else 'inventory' }`
 2. `select_sample`  — bindings: `{ population: $prev.data_table }`
 3. `physical_verification` 🆕 — bindings: `{ item_type: 'ppe', sample_items: $prev.sample_items }`
 4. `team_review`  — bindings: `{ instructions: 'Review physical-verification exceptions.' }`

**New Actions referenced:**

 - `physical_verification` — Physical Verification / Observation

---

### Test 198: For disposals, verify removal from FAR and agreement to disposal documentation (sales invoice, scrap records).

- FS Line: **Property plant and equipment**
- Assertion: **Existence**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'For disposals, verify removal from FAR and agreement to disposal documentation (sales invoice, scrap records).', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 199: Recalculate depreciation expense and compare with FAR and policy.

- FS Line: **Property plant and equipment**
- Assertion: **Valuation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `recalc_dep` — Recalculate depreciation.

**Steps:**

 1. `request_listing` 🆕 — bindings: `{ listing_type: 'far' if 'depreciation' in policy_type else 'other' }`
 2. `recalculate_balance` 🆕 — bindings: `{ policy_type: 'straight_line_depreciation', inputs: $prev.data_table }`
 3. `team_review`  — bindings: `{ instructions: 'Review recalculation variances.' }`

**New Actions referenced:**

 - `recalculate_balance` — Recalculate Balance

---

### Test 200: Test a sample of additions to verify recorded cost includes all directly attributable costs.

- FS Line: **Property plant and equipment**
- Assertion: **Valuation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Test a sample of additions to verify recorded cost includes all directly attributable costs.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 201: Where revaluations are performed, assess competence of valuer, methodology used, and appropriateness of assump

- FS Line: **Property plant and equipment**
- Assertion: **Valuation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `fv` — Assess valuation / revaluation.

**Full description:**

> Where revaluations are performed, assess competence of valuer, methodology used, and appropriateness of assumptions.

**Steps:**

 1. `request_documents`  — bindings: `{ document_type: 'other', area_of_work: $ctx.test.fsLine }`
 2. `assess_estimates` 🆕 — bindings: `{ estimate_type: 'fair_value', supporting_schedule: $prev.documents }`
 3. `team_review`  — bindings: `{ instructions: 'Review estimate assessment and challenge.' }`

**New Actions referenced:**

 - `assess_estimates` — Assess Management Estimates

---

### Test 202: Test for impairment indicators and if triggered, assess management’s impairment review (recoverable amount = h

- FS Line: **Property plant and equipment**
- Assertion: **Valuation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `impairment` — Assess impairment indicators and review.

**Full description:**

> Test for impairment indicators and if triggered, assess management’s impairment review (recoverable amount = higher of fair value less costs of disposal and value in use).

**Steps:**

 1. `request_documents`  — bindings: `{ document_type: 'other', area_of_work: $ctx.test.fsLine }`
 2. `assess_estimates` 🆕 — bindings: `{ estimate_type: 'impairment', supporting_schedule: $prev.documents }`
 3. `team_review`  — bindings: `{ instructions: 'Review estimate assessment and challenge.' }`

**New Actions referenced:**

 - `assess_estimates` — Assess Management Estimates

---

### Test 203: Inspect purchase documents, title deeds to confirm ownership rights.

- FS Line: **Property plant and equipment**
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

### Test 204: Check whether assets are pledged as security and ensure appropriate disclosure.

- FS Line: **Property plant and equipment**
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

### Test 205: Review supplier contracts and insurance policies for indications of ownership.

- FS Line: **Property plant and equipment**
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

