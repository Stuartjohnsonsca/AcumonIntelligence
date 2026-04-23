# Test Specs — Cost of Sales

Framework: FRS102   Significant Risk: Y   Test count: 23

Source CSV row range: 28–50

---

### Test 28: Review changes from PY if either >PM or 30% and obtain explanation for movement

- FS Line: **Cost of Sales**
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

### Test 29: Obtain an understanding of the process for recording purchases and CoS, including controls over matching goods

- FS Line: **Cost of Sales**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `walkthrough` — Walkthrough / management discussion.

**Full description:**

> Obtain an understanding of the process for recording purchases and CoS, including controls over matching goods received, purchase invoices, and postings to the ledger.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Record walkthrough of the Cost of Sales process; document controls and design effectiveness.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 30: Perform a reconciliation between the purchases/GRN records and the General Ledger/Trial Balance to ensure all 

- FS Line: **Cost of Sales**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Full description:**

> Perform a reconciliation between the purchases/GRN records and the General Ledger/Trial Balance to ensure all costs are captured.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Perform a reconciliation between the purchases/GRN records and the General Ledger/Trial Balance to ensure all costs are captured.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 31: Review whether accruals for un-invoiced goods/services at year-end are identified and recorded (GRNI testing).

- FS Line: **Cost of Sales**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Review whether accruals for un-invoiced goods/services at year-end are identified and recorded (GRNI testing).', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 32: Perform cut-off testing around year-end to ensure completeness of accrued costs.

- FS Line: **Cost of Sales**
- Assertion: **Completeness**
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

### Test 33: Analytical review: compare gross margin % with prior periods and budget to identify anomalies.

- FS Line: **Cost of Sales**
- Assertion: **Completeness**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Analytical review: compare gross margin % with prior periods and budget to identify anomalies.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 34: Select samples of recorded cost of sales and trace to supporting documentation (e.g., supplier invoices, GRNs,

- FS Line: **Cost of Sales**
- Assertion: **Occurence & Accuracy**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `sample_inspect` — Sample and inspect supporting contracts.

**Full description:**

> Select samples of recorded cost of sales and trace to supporting documentation (e.g., supplier invoices, GRNs, contracts, inventory issues) to verify validity and accuracy.

**Steps:**

 1. `accounting_extract`  — bindings: `{ data_type: 'journals', account_codes: $ctx.test.fsLineAccounts }`
 2. `select_sample`  — bindings: `{ population: $prev.data_table }`
 3. `request_documents`  — bindings: `{ transactions: $prev.sample_items, document_type: 'contract', area_of_work: $ctx.test.fsLine }`
 4. `verify_evidence`  — bindings: `{ evidence_documents: $prev.documents, sample_items: $step.2.sample_items, assertions: ['occurence'] }`
 5. `team_review`  — bindings: `{ instructions: 'Conclude on assertion testing.' }`

**New Actions referenced:** none (all existing).

---

### Test 35: Verify that amounts recorded agree to supplier invoices and contracts, including price and quantity checks.

- FS Line: **Cost of Sales**
- Assertion: **Occurence & Accuracy**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Verify that amounts recorded agree to supplier invoices and contracts, including price and quantity checks.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 36: For foreign currency purchases, test application of exchange rates to ensure accuracy.

- FS Line: **Cost of Sales**
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

### Test 37: Where allocations or estimates are used (e.g., overhead absorption into inventory), evaluate the appropriatene

- FS Line: **Cost of Sales**
- Assertion: **Occurence & Accuracy**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `estimates` — Assess management estimate / judgement.

**Full description:**

> Where allocations or estimates are used (e.g., overhead absorption into inventory), evaluate the appropriateness of methods applied.

**Steps:**

 1. `request_documents`  — bindings: `{ document_type: 'other', area_of_work: $ctx.test.fsLine }`
 2. `assess_estimates` 🆕 — bindings: `{ estimate_type: 'other', supporting_schedule: $prev.documents }`
 3. `team_review`  — bindings: `{ instructions: 'Review estimate assessment and challenge.' }`

**New Actions referenced:**

 - `assess_estimates` — Assess Management Estimates

---

### Test 38: Consider fraud risk of fictitious purchases (e.g., unusual terms, related party purchases).

- FS Line: **Cost of Sales**
- Assertion: **Occurence & Accuracy**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `related_party` — Identify and reconcile related-party transactions.

**Steps:**

 1. `analyse_related_party` 🆕 — bindings: `{ period_start: $ctx.engagement.periodStart, period_end: $ctx.engagement.periodEnd }`
 2. `team_review`  — bindings: `{ instructions: 'Confirm RP disclosure agrees to findings.' }`

**New Actions referenced:**

 - `analyse_related_party` — Analyse Related Party Transactions

---

### Test 39: Clearly define the cut-off period relevant for performing the procedure, considering management’s timeline for

- FS Line: **Cost of Sales**
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

### Test 40: Test purchases/CoS recorded immediately before and after year-end, tracing to GRNs and invoices to ensure cost

- FS Line: **Cost of Sales**
- Assertion: **Cut Off**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `cutoff` — Cut-off test either side of period end.

**Full description:**

> Test purchases/CoS recorded immediately before and after year-end, tracing to GRNs and invoices to ensure costs are recorded in the correct period.

**Steps:**

 1. `accounting_extract`  — bindings: `{ data_type: 'journals', account_codes: $ctx.test.fsLineAccounts }`
 2. `analyse_cut_off`  — bindings: `{ data_table: $prev.data_table, period_end: $ctx.engagement.periodEnd, cut_off_days: 7 }`
 3. `team_review`  — bindings: `{ instructions: 'Review any cut-off exceptions.' }`

**New Actions referenced:** none (all existing).

---

### Test 41: Review returns and credit notes issued after year-end to ensure related costs are adjusted appropriately.

- FS Line: **Cost of Sales**
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

### Test 42: Verify that cost of sales is classified correctly and not misstated as operating expenses or other costs.

- FS Line: **Cost of Sales**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Cost of Sales transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 43: Review the allocation of direct costs (materials, labour, subcontracting) and indirect costs to ensure consist

- FS Line: **Cost of Sales**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Full description:**

> Review the allocation of direct costs (materials, labour, subcontracting) and indirect costs to ensure consistent and appropriate classification.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Cost of Sales transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 44: Ensure consistency of classification with prior periods and industry norms.

- FS Line: **Cost of Sales**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Cost of Sales transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 45: Check that related party costs are identified and correctly classified.

- FS Line: **Cost of Sales**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Cost of Sales transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 46: Review disclosures in the FS to ensure compliance with requirements under financial reporting framework.

- FS Line: **Cost of Sales**
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

### Test 47: Confirm that disclosures on cost of sales, inventory, and related balances (e.g., GRNI accruals, purchase comm

- FS Line: **Cost of Sales**
- Assertion: **Presentation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `disclosure` — Review disclosures for compliance with framework.

**Full description:**

> Confirm that disclosures on cost of sales, inventory, and related balances (e.g., GRNI accruals, purchase commitments) are complete and accurate.

**Steps:**

 1. `review_disclosures` 🆕 — bindings: `{ fs_line: $ctx.test.fsLine, framework: $ctx.engagement.framework }`
 2. `team_review`  — bindings: `{ instructions: 'Review disclosure-checklist exceptions.' }`

**New Actions referenced:**

 - `review_disclosures` — Review FS Disclosures (FS Line)

---

### Test 48: Ensure disclosure of related party purchases is in line with IAS 24.

- FS Line: **Cost of Sales**
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

### Test 49: Perform consistency checks between CoS, revenue, and inventory disclosures to ensure margins reconcile appropr

- FS Line: **Cost of Sales**
- Assertion: **Presentation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `disclosure` — Review disclosures for compliance with framework.

**Full description:**

> Perform consistency checks between CoS, revenue, and inventory disclosures to ensure margins reconcile appropriately.

**Steps:**

 1. `review_disclosures` 🆕 — bindings: `{ fs_line: $ctx.test.fsLine, framework: $ctx.engagement.framework }`
 2. `team_review`  — bindings: `{ instructions: 'Review disclosure-checklist exceptions.' }`

**New Actions referenced:**

 - `review_disclosures` — Review FS Disclosures (FS Line)

---

### Test 50: Ensure accounting policies for inventory valuation and expense recognition are clearly presented.

- FS Line: **Cost of Sales**
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

