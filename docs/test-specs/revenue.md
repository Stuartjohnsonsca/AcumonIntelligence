# Test Specs — Revenue

Framework: FRS102   Significant Risk: Y   Test count: 24

Source CSV row range: 4–27

---

### Test 4: Obtain understanding of the entity's process for recording sales and assess the design effectiveness of contro

- FS Line: **Revenue**
- Assertion: **Completeness**
- Type: **Judgement**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_no_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `walkthrough` — Walkthrough / management discussion.

**Full description:**

> Obtain understanding of the entity's process for recording sales and assess the design effectiveness of controls relavant to the process.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Record walkthrough of the Revenue process; document controls and design effectiveness.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 5: Obtain sales listing for the period and ensure that the total of sales matches to the trial balance. If separa

- FS Line: **Revenue**
- Assertion: **Completeness**
- Type: **Judgement**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_no_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `listing_recon` — Obtain other listing and reconcile to TB.

**Full description:**

> Obtain sales listing for the period and ensure that the total of sales matches to the trial balance. If separate system is in use for recording sales transactions, ensure that the total sales as per independent system matches to the General Ledger/TB.

**Steps:**

 1. `request_listing` 🆕 — bindings: `{ listing_type: 'other', account_codes: $ctx.test.fsLineAccounts }`
 2. `reconcile_to_tb` 🆕 — bindings: `{ data_table: $prev.data_table, account_codes: $ctx.test.fsLineAccounts }`
 3. `team_review`  — bindings: `{ instructions: 'Review reconciliation and any unreconciled items.' }`

**New Actions referenced:**

 - `request_listing` — Request Listing from Client
 - `reconcile_to_tb` — Reconcile Listing to Trial Balance

---

### Test 6: Discuss with management on the open projects at year-end and assess how the revenue for the work completed to 

- FS Line: **Revenue**
- Assertion: **Completeness**
- Type: **Judgement**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_no_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `walkthrough` — Walkthrough / management discussion.

**Full description:**

> Discuss with management on the open projects at year-end and assess how the revenue for the work completed to the year-end has been caculated and recorded.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Record walkthrough of the Revenue process; document controls and design effectiveness.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 7: Perform trend analysis (monthly sales, comparison to prior periods/budgets) to identify any unusual fluctuatio

- FS Line: **Revenue**
- Assertion: **Completeness**
- Type: **Judgement**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_no_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `generic_ai` — Generic AI-analysis step with prompt mirroring the test description.

**Full description:**

> Perform trend analysis (monthly sales, comparison to prior periods/budgets) to identify any unusual fluctuations.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Perform trend analysis (monthly sales, comparison to prior periods/budgets) to identify any unusual fluctuations.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 8: Review changes from PY if either >PM or 30% and obtain explanation for movement

- FS Line: **Revenue**
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

### Test 9: Assess if management has applied the correct accounting policy (IFRS 15 / UKGAAP) in line with performance obl

- FS Line: **Revenue**
- Assertion: **Occurence & Accuracy**
- Type: **Analytical Review**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_no_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `policy` — Review accounting-policy compliance.

**Full description:**

> Assess if management has applied the correct accounting policy (IFRS 15 / UKGAAP) in line with performance obligations.

**Steps:**

 1. `analyse_accounting_policy` 🆕 — bindings: `{ framework: $ctx.engagement.framework, fs_line: $ctx.test.fsLine }`
 2. `team_review`  — bindings: `{ instructions: 'Review policy-compliance findings.' }`

**New Actions referenced:**

 - `analyse_accounting_policy` — Analyse Accounting Policy Compliance

---

### Test 10: Using sampling calculator determine the number of samples to tested.

- FS Line: **Revenue**
- Assertion: **Occurence & Accuracy**
- Type: **Analytical Review**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_no_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `sample_size` — Determine sample size via the Sample Calculator.

**Steps:**

 1. `select_sample`  — bindings: `{ sample_type: 'standard', population: $ctx.test.fsLineAccounts }`

**New Actions referenced:** none (all existing).

---

### Test 11: Obtain supporting documents such as invoice, contract and Goods Delivery Note (where applicable) to trace amou

- FS Line: **Revenue**
- Assertion: **Occurence & Accuracy**
- Type: **Analytical Review**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_no_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `sample_inspect` — Sample and inspect supporting contracts.

**Full description:**

> Obtain supporting documents such as invoice, contract and Goods Delivery Note (where applicable) to trace amount recorded in GL to the supporting documents.

**Steps:**

 1. `accounting_extract`  — bindings: `{ data_type: 'journals', account_codes: $ctx.test.fsLineAccounts }`
 2. `select_sample`  — bindings: `{ population: $prev.data_table }`
 3. `request_documents`  — bindings: `{ transactions: $prev.sample_items, document_type: 'contract', area_of_work: $ctx.test.fsLine }`
 4. `verify_evidence`  — bindings: `{ evidence_documents: $prev.documents, sample_items: $step.2.sample_items, assertions: ['occurence'] }`
 5. `team_review`  — bindings: `{ instructions: 'Conclude on assertion testing.' }`

**New Actions referenced:** none (all existing).

---

### Test 12: Assess how the performance obligation is satisfied as per the terms of the agreement.

- FS Line: **Revenue**
- Assertion: **Occurence & Accuracy**
- Type: **Analytical Review**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_no_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `perf_oblig` — Assess performance-obligation satisfaction per IFRS 15.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'For Revenue, assess how the performance obligation is satisfied per the contract terms.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 13: For sales in foreign currencies, ensure that the appropriate exchange rate (i.e., on the date of transactions)

- FS Line: **Revenue**
- Assertion: **Occurence & Accuracy**
- Type: **Analytical Review**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_no_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `fx` — Test FX translation on foreign-currency balances.

**Full description:**

> For sales in foreign currencies, ensure that the appropriate exchange rate (i.e., on the date of transactions) is applied by management.

**Steps:**

 1. `request_listing` 🆕 — bindings: `{ listing_type: 'far' if 'depreciation' in policy_type else 'other' }`
 2. `recalculate_balance` 🆕 — bindings: `{ policy_type: 'fx', inputs: $prev.data_table }`
 3. `team_review`  — bindings: `{ instructions: 'Review recalculation variances.' }`

**New Actions referenced:**

 - `recalculate_balance` — Recalculate Balance

---

### Test 14: Where revenue involves estimates/judgements (e.g., variable consideration, long-term contracts), assess reason

- FS Line: **Revenue**
- Assertion: **Occurence & Accuracy**
- Type: **Analytical Review**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_no_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `estimates` — Assess management estimate / judgement.

**Full description:**

> Where revenue involves estimates/judgements (e.g., variable consideration, long-term contracts), assess reasonableness and appropriateness.

**Steps:**

 1. `request_documents`  — bindings: `{ document_type: 'other', area_of_work: $ctx.test.fsLine }`
 2. `assess_estimates` 🆕 — bindings: `{ estimate_type: 'other', supporting_schedule: $prev.documents }`
 3. `team_review`  — bindings: `{ instructions: 'Review estimate assessment and challenge.' }`

**New Actions referenced:**

 - `assess_estimates` — Assess Management Estimates

---

### Test 15: Consider fraud risk of fictitious sales (e.g., unusual terms, related party sales).

- FS Line: **Revenue**
- Assertion: **Occurence & Accuracy**
- Type: **Analytical Review**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_no_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `related_party` — Identify and reconcile related-party transactions.

**Steps:**

 1. `analyse_related_party` 🆕 — bindings: `{ period_start: $ctx.engagement.periodStart, period_end: $ctx.engagement.periodEnd }`
 2. `team_review`  — bindings: `{ instructions: 'Confirm RP disclosure agrees to findings.' }`

**New Actions referenced:**

 - `analyse_related_party` — Analyse Related Party Transactions

---

### Test 16: Clearly define the cut-off period relevant for performing the procedure, considering management’s timeline for

- FS Line: **Revenue**
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

### Test 17: Select samples covering pre-period and post year-end and perform testing to ensure that the revenue is recorde

- FS Line: **Revenue**
- Assertion: **Cut Off**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `cutoff` — Cut-off test either side of period end.

**Full description:**

> Select samples covering pre-period and post year-end and perform testing to ensure that the revenue is recorded in the appropriate period.

**Steps:**

 1. `accounting_extract`  — bindings: `{ data_type: 'journals', account_codes: $ctx.test.fsLineAccounts }`
 2. `analyse_cut_off`  — bindings: `{ data_table: $prev.data_table, period_end: $ctx.engagement.periodEnd, cut_off_days: 7 }`
 3. `team_review`  — bindings: `{ instructions: 'Review any cut-off exceptions.' }`

**New Actions referenced:** none (all existing).

---

### Test 18: Review post year-end returns/credit notes to check if revenue recorded pre-year-end should be reversed.

- FS Line: **Revenue**
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

### Test 19: Review the revenue recognition policy and chart of accounts to confirm that revenue streams are appropriately 

- FS Line: **Revenue**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Full description:**

> Review the revenue recognition policy and chart of accounts to confirm that revenue streams are appropriately defined.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Revenue transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 20: Test a sample of revenue transactions to confirm correct classification between product sales, services, relat

- FS Line: **Revenue**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Full description:**

> Test a sample of revenue transactions to confirm correct classification between product sales, services, related parties, or other categories.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Revenue transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 21: Ensure items not meeting the definition of revenue (e.g., reimbursements, finance income) are not misclassifie

- FS Line: **Revenue**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Full description:**

> Ensure items not meeting the definition of revenue (e.g., reimbursements, finance income) are not misclassified within revenue.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Revenue transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 22: Compare classification of revenue streams to prior periods for consistency.

- FS Line: **Revenue**
- Assertion: **Classification**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `classification` — Check classification within FS line.

**Steps:**

 1. `ai_analysis`  — bindings: `{ prompt_template: 'Check classification of Revenue transactions for correct sub-categorisation against policy.', output_format: 'pass_fail' }`
 2. `team_review`  — bindings: `{ instructions: 'Review AI assessment and conclude.' }`

**New Actions referenced:** none (all existing).

---

### Test 23: Review revenue disclosures for compliance with IFRS 15 and UKGAAP, including: • Disaggregation of revenue into

- FS Line: **Revenue**
- Assertion: **Presentation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `disclosure` — Review disclosures for compliance with framework.

**Full description:**

> Review revenue disclosures for compliance with IFRS 15 and UKGAAP, including:
  • Disaggregation of revenue into meaningful categories (e.g., by geography, product, service, timing of transfer).
  • Disclosure of contract balances (assets and liabilities).
  • Disclosure of significant judgements and estimates in revenue recognition.

**Steps:**

 1. `review_disclosures` 🆕 — bindings: `{ fs_line: $ctx.test.fsLine, framework: $ctx.engagement.framework }`
 2. `team_review`  — bindings: `{ instructions: 'Review disclosure-checklist exceptions.' }`

**New Actions referenced:**

 - `review_disclosures` — Review FS Disclosures (FS Line)

---

### Test 24: Verify that related party revenues are disclosed in accordance with IAS 24.

- FS Line: **Revenue**
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

### Test 25: Assess whether gross vs. net presentation (principal vs. agent) is appropriate (if applicable).

- FS Line: **Revenue**
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

### Test 26: Perform consistency checks between segment reporting, trial balance, management reporting packs, and FS disclo

- FS Line: **Revenue**
- Assertion: **Presentation**
- Type: **Test of Details**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `disclosure` — Review disclosures for compliance with framework.

**Full description:**

> Perform consistency checks between segment reporting, trial balance, management reporting packs, and FS disclosures.

**Steps:**

 1. `review_disclosures` 🆕 — bindings: `{ fs_line: $ctx.test.fsLine, framework: $ctx.engagement.framework }`
 2. `team_review`  — bindings: `{ instructions: 'Review disclosure-checklist exceptions.' }`

**New Actions referenced:**

 - `review_disclosures` — Review FS Disclosures (FS Line)

---

### Test 27: Ensure presentation is aligned with industry norms and regulatory expectations.

- FS Line: **Revenue**
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

