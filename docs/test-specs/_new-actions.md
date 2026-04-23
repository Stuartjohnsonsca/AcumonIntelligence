# New Actions to Build

These Actions are referenced by the test specs but do not yet exist in `lib/action-seed.ts`. Once approved, each should be seeded in the same pattern as the existing system Actions.

## `analyse_accounting_policy`

**Name:** Analyse Accounting Policy Compliance

**Description:** AI-driven check that the entity's accounting policy for the FS line complies with the applicable standard (e.g., IFRS 15 performance obligations, IFRS 16 lease term, IAS 2 cost formula, IFRS 9 classification). Returns gaps and risk rating.

**Inputs (sketch):** policy_document (file or text from FS notes), framework, fs_line, standard_ref.

**Outputs (sketch):** findings (data_table with rule, compliant, gap_description, risk), pass_fail.

**Referenced by FS lines:** Accruals, Amount owed by group undertakings, Deferred tax, Inventory, Investments (financial assets), Revenue, Trade creditors

---

## `analyse_related_party`

**Name:** Analyse Related Party Transactions

**Description:** Identifies related-party transactions in the period using the related-party register + journal narrative search + accounting-system contacts, reconciles to disclosures in the FS, and flags undisclosed relationships.

**Inputs (sketch):** rp_register (file), period_start, period_end.

**Outputs (sketch):** rp_transactions (data_table), undisclosed_items, pass_fail.

**Referenced by FS lines:** Cost of Sales, Revenue

---

## `analytical_review_variance`

**Name:** Analytical Review — PY Variance

**Description:** Generic version of compute_gm_analysis for any FS line. Pulls CY + PY TB for a given FS line (or account code range), computes absolute and % movement, flags when |Δ| > PM or |Δ%| > 30%, and returns variances[] ready for request_gm_explanations.

**Inputs (sketch):** fs_line / account_codes (auto), tolerance_gbp (default = performance_materiality), tolerance_pct (default 30).

**Outputs (sketch):** variances (data_table with cy, py, delta, delta_pct, flagged, flag_reason), flagged_count, pass_fail.

**Referenced by FS lines:** Accruals, Amount owed by group undertakings, Amounts owed to group undertakings, Cash and Cash equivalents, Corporation tax payable, Cost of Sales, Deferred revenue, Deferred tax, Intangible assets, Interest payable and similar income, Inventory, Investments (financial assets), Investments in subsidaries, Loans and borrowings, Operating Expenses, Other Operating Income, Other creditors, Other debtors, Other interest receivable and similar income, Other taxation and social security payable, Prepayments and accrued income, Property plant and equipment, Reserves, Revenue, Share capital, Tax expense, Trade creditors, Trade debtors, Wages & Salaries

---

## `assess_estimates`

**Name:** Assess Management Estimates

**Description:** Evaluates a management estimate (ECL provision, impairment, FV, warranty provision, revenue variable consideration, deferred tax judgement) — gathers inputs, re-performs calc independently where feasible, stress-tests key assumptions, and rates management's bias.

**Inputs (sketch):** estimate_type, estimate_value, supporting_schedule (file), assumptions (text).

**Outputs (sketch):** reperformed_value, variance, bias_rating (neutral | optimistic | pessimistic), pass_fail.

**Referenced by FS lines:** Accruals, Amount owed by group undertakings, Cost of Sales, Deferred tax, Intangible assets, Interest payable and similar income, Investments (financial assets), Investments in subsidaries, Loans and borrowings, Other Operating Income, Other debtors, Other interest receivable and similar income, Prepayments and accrued income, Property plant and equipment, Reserves, Revenue, Tax expense, Trade debtors

---

## `bank_reconciliation_review`

**Name:** Review Bank Reconciliation

**Description:** Reviews the client's bank reconciliation at period end. Checks unreconciled items, stale cheques, uncleared receipts, post-YE clearance, and that reconciled balance = TB.

**Inputs (sketch):** reconciliation_file (file), bank_statement (file), tb_balance (auto).

**Outputs (sketch):** unreconciled_items, stale_items, reconciled_to_tb (pass_fail), exception_count.

---

## `physical_verification`

**Name:** Physical Verification / Observation

**Description:** Schedules and records physical verification — inventory count attendance, PPE physical inspection, cash count. Auditor uploads count sheets / photos / tag numbers, AI reconciles to sample register.

**Inputs (sketch):** item_type (inventory | ppe | cash), sample_items (register rows), count_date, location(s).

**Outputs (sketch):** observations (data_table with item_ref, existence_confirmed, condition, variance_qty, variance_value, photos), exception_count, pass_fail.

**Referenced by FS lines:** Cash and Cash equivalents, Inventory, Property plant and equipment

---

## `recalculate_balance`

**Name:** Recalculate Balance

**Description:** Generic recalculation wrapper: depreciation (by policy + cost + life), interest (rate × principal × days), tax (rate × taxable profit), ECL (% × ageing buckets), FX translation (rate × balance), prepayment amortisation. Picks the right formula from policy_type.

**Inputs (sketch):** policy_type (straight_line_depreciation | interest | tax | ecl_matrix | fx | prepayment_amortise | other), inputs (data_table with required columns per policy), comparison_values (data_table as booked).

**Outputs (sketch):** recalc_table (data_table with booked vs calculated vs diff), total_variance, pass_fail.

**Referenced by FS lines:** Amount owed by group undertakings, Amounts owed to group undertakings, Cash and Cash equivalents, Corporation tax payable, Cost of Sales, Deferred tax, Interest payable and similar income, Investments (financial assets), Loans and borrowings, Operating Expenses, Other creditors, Other interest receivable and similar income, Property plant and equipment, Revenue, Tax expense, Trade creditors

---

## `reconcile_register`

**Name:** Reconcile Sub-Ledger to TB

**Description:** Takes a register (FAR, stock list, debtors ledger, etc.), sums it, compares to the GL/TB account total, flags variance and lists unreconciled items. Differs from reconcile_to_tb in that it expects a register file format (not a parsed data_table) and produces a row-level variance report.

**Inputs (sketch):** register_file (file) OR register_table (json_table), account_codes, tolerance_gbp.

**Outputs (sketch):** register_total, tb_total, variance, unreconciled_items, pass_fail.

---

## `reconcile_to_tb`

**Name:** Reconcile Listing to Trial Balance

**Description:** Takes a data_table (client listing) and a TB account-code range, sums the listing, compares to the TB total, flags variance. Used standalone when request_listing isn't needed (data already extracted).

**Inputs (sketch):** data_table (population), account_codes, tolerance_gbp.

**Outputs (sketch):** listing_total, tb_total, variance, pass_fail.

**Referenced by FS lines:** Accruals, Amount owed by group undertakings, Amounts owed to group undertakings, Cash and Cash equivalents, Corporation tax payable, Deferred revenue, Deferred tax, Intangible assets, Interest payable and similar income, Inventory, Investments (financial assets), Loans and borrowings, Other Operating Income, Other creditors, Other debtors, Other interest receivable and similar income, Other taxation and social security payable, Prepayments and accrued income, Property plant and equipment, Reserves, Revenue, Share capital, Trade creditors, Trade debtors, Wages & Salaries

---

## `request_confirmations`

**Name:** Request Third-Party Confirmations

**Description:** Sends confirmation letters (bank, debtor, creditor, loan, legal, pension) to third parties. Tracks responses via portal / email, escalates non-responses with alternative-procedure guidance, extracts confirmed balance per party, reconciles to TB, and produces exception list.

**Inputs (sketch):** confirmation_type (bank | debtor | creditor | loan | legal | other), sample_items (counterparties + expected balances), message_to_counterparty, chase_schedule_days.

**Outputs (sketch):** confirmations (data_table with counterparty, expected, confirmed, variance, response_status), exception_count, pass_fail.

**Referenced by FS lines:** Amount owed by group undertakings, Amounts owed to group undertakings, Cash and Cash equivalents, Investments (financial assets), Loans and borrowings, Other Operating Income, Other creditors, Other debtors, Trade creditors, Trade debtors

---

## `request_listing`

**Name:** Request Listing from Client

**Description:** Generic version of request_accruals_listing. Requests any ledger/schedule from the client via portal (debtors ageing, creditors ageing, FAR, inventory listing, loan schedule, share register, etc.) with a structured-columns prompt. Parses the returned file, extracts a data_table, and reconciles the total to the specified TB account codes.

**Inputs (sketch):** message_to_client, listing_type (select — debtors_ageing | creditors_ageing | far | inventory | loan_schedule | share_register | ecl_schedule | deferred_tax | other), account_codes, tolerance_gbp.

**Outputs (sketch):** data_table (parsed rows), listing_total, tb_total, variance, tb_reconciled (pass_fail), portal_request_id.

**Referenced by FS lines:** Accruals, Amount owed by group undertakings, Amounts owed to group undertakings, Cash and Cash equivalents, Corporation tax payable, Deferred revenue, Deferred tax, Intangible assets, Interest payable and similar income, Inventory, Investments (financial assets), Loans and borrowings, Other Operating Income, Other creditors, Other debtors, Other interest receivable and similar income, Other taxation and social security payable, Prepayments and accrued income, Property plant and equipment, Reserves, Revenue, Share capital, Trade creditors, Trade debtors, Wages & Salaries

---

## `review_cashflow_forecast`

**Name:** Review Cash-Flow Forecast (Going Concern)

**Description:** Ingests management's going-concern cash-flow forecast, sensitivity analyses, and assumptions. AI challenges assumptions against CY actuals and budgets, stress-tests headroom, and evaluates the disclosed conclusion (unqualified / material uncertainty / adverse).

**Inputs (sketch):** forecast_documents (file), assumptions_document (file), period_covered_months (default 12).

**Outputs (sketch):** challenges (data_table with assumption, benchmark, delta, risk_rating), headroom_summary, recommended_opinion, pass_fail.

**Referenced by FS lines:** Going Concern

---

## `review_contracts`

**Name:** Review Contracts / Agreements

**Description:** For a sample of contracts (sales contracts, leases, loans, shareholder agreements, group agreements, licence agreements): extract key terms (parties, values, dates, covenants, performance obligations, termination clauses) and check they match how the transaction has been recorded.

**Inputs (sketch):** contract_sample (file_array or portal refs), expected_terms (multiselect — parties | value | dates | covenants | perf_obligations | termination | other).

**Outputs (sketch):** extracted_terms (data_table), misalignments (data_table), pass_fail.

**Referenced by FS lines:** Accruals, Amount owed by group undertakings, Amounts owed to group undertakings, Cash and Cash equivalents, Corporation tax payable, Deferred revenue, Deferred tax, Intangible assets, Inventory, Investments (financial assets), Investments in subsidaries, Loans and borrowings, Other creditors, Other debtors, Other taxation and social security payable, Prepayments and accrued income, Property plant and equipment, Reserves, Share capital, Trade debtors

---

## `review_disclosures`

**Name:** Review FS Disclosures (FS Line)

**Description:** AI-checks that the draft FS disclosures for a specific FS line are complete and compliant with the framework (e.g., IAS 16 for PPE, IFRS 15 for Revenue, IFRS 9 for financial instruments). Returns a per-rule checklist.

**Inputs (sketch):** fs_document (file), framework, fs_line, disclosure_rules (auto-sourced from standard).

**Outputs (sketch):** rules_checklist (data_table), exception_count, pass_fail.

**Referenced by FS lines:** Accruals, Amount owed by group undertakings, Amounts owed to group undertakings, Cash and Cash equivalents, Corporation tax payable, Cost of Sales, Deferred revenue, Deferred tax, Intangible assets, Interest payable and similar income, Inventory, Investments (financial assets), Investments in subsidaries, Loans and borrowings, Operating Expenses, Other Operating Income, Other creditors, Other debtors, Other interest receivable and similar income, Other taxation and social security payable, Prepayments and accrued income, Property plant and equipment, Reserves, Revenue, Share capital, Tax expense, Trade creditors, Trade debtors, Wages & Salaries

---

## `review_fraud_risk`

**Name:** Review Fraud Risk Indicators

**Description:** Scans a population for fraud indicators (fictitious counterparties, round-number patterns, side-letters, unusual terms, manual journals to revenue near YE) using ISA 240 criteria and AI-anomaly detection.

**Inputs (sketch):** population (data_table), fraud_scenarios (multiselect), period_end.

**Outputs (sketch):** flags (data_table with row_ref, scenario, score), reviewed_by_ai, pass_fail.

**Referenced by FS lines:** Operating Expenses

---

## `review_subsequent_activity`

**Name:** Review Subsequent Activity (Post-YE)

**Description:** Pulls post-YE transactions (receipts, payments, credit notes, returns, journals) from the accounting system or supplied exports, filters to the X-day window after period end, and runs AI analysis to identify items that affect the period-end balance (unrecorded receivables, unrecorded credit notes, sales reversals, etc.).

**Inputs (sketch):** transaction_type (receipts | payments | credit_notes | returns | journals), x_days_post_ye (default 60), fs_line / account_codes.

**Outputs (sketch):** findings (data_table), impact_value, pass_fail.

**Referenced by FS lines:** Accruals, Cash and Cash equivalents, Trade debtors

---

## `run_fs_checker`

**Name:** Run FS Checker

**Description:** Parses the draft financial statements and checks: disclosure completeness vs standards (IFRS / FRS102), cross-cast math, TB→FS tie, prior-year restatement flags, required-note coverage, formatting consistency.

**Inputs (sketch):** fs_document (file), framework (IFRS | FRS102 | other), tb_data (auto from engagement).

**Outputs (sketch):** checks (data_table with rule_code, pass_fail, evidence), exception_count, pass_fail.

**Referenced by FS lines:** Notes and Disclosures

---

## `test_journals`

**Name:** Test Journals (Management Override)

**Description:** Management override test. Pulls all journals for the period, applies ISA 240 risk criteria (unusual users, round numbers, period-end weekend posts, manual to sensitive accounts), AI-ranks suspicious items, selects a sample, and requests supporting evidence.

**Inputs (sketch):** criteria (multiselect of ISA 240 flags), sample_size, period_start, period_end.

**Outputs (sketch):** suspicious_journals (data_table), sample_items, pass_fail.

**Referenced by FS lines:** Management Override

---

