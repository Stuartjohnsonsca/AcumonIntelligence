"""
Generate per-FS-line test spec markdown files from the test bank CSV.

Reads: test-bank-template-default (2).csv
Writes: one .md per FS line + _new-actions.md + README.md

Each spec block is the agreed format:

### Test N: <Test Description>
FS Line: <...>   Assertion: <...>   Type: <...>
Output Format: <...>

Steps:
 1. <action_code>  — bindings: { ... }
 2. ...

New Actions Needed:
  - <code> — <short>   [or "none"]

Notes:
  - <anything non-obvious>
"""
from __future__ import annotations
import csv
import os
import re
import textwrap
from collections import defaultdict

CSV_PATH = r"C:\Users\stuart\OneDrive - Johnsons Financial Management\AI Toolkit - Documents\Tools\Audit Programme\test-bank-template-default (2.csv"
OUT_DIR  = r"C:\Users\stuart\OneDrive - Johnsons Financial Management\AI Toolkit - Documents\Tools\Website\acumon-website\.claude\worktrees\goofy-davinci-44d11e\docs\test-specs"

# ───────────────────────────────────────────────────────────────────────────
# Existing system actions (from lib/action-seed.ts)
# ───────────────────────────────────────────────────────────────────────────
EXISTING_ACTIONS = {
    "request_documents", "extract_bank_statements", "accounting_extract",
    "select_sample",
    "ai_analysis", "analyse_large_unusual", "analyse_cut_off",
    "compare_bank_to_tb", "verify_evidence", "verify_property_assets",
    "request_accruals_listing", "extract_accruals_evidence", "verify_accruals_sample",
    "extract_post_ye_bank_payments", "select_unrecorded_liabilities_sample",
    "verify_unrecorded_liabilities_sample",
    "request_gm_data", "compute_gm_analysis",
    "request_gm_explanations", "assess_gm_explanations",
    "team_review",
}

# ───────────────────────────────────────────────────────────────────────────
# New actions proposed (collected as we go)
# ───────────────────────────────────────────────────────────────────────────
NEW_ACTIONS: dict[str, dict] = {}

def need(code: str, name: str, description: str, inputs: str = "", outputs: str = ""):
    """Register a new action needed (idempotent)."""
    if code not in NEW_ACTIONS:
        NEW_ACTIONS[code] = {
            "name": name,
            "description": description,
            "inputs": inputs,
            "outputs": outputs,
            "used_by": set(),
        }
    return code

# Pre-register new actions — inputs/outputs sketched for the build phase.
need(
    "analytical_review_variance",
    "Analytical Review — PY Variance",
    "Generic version of compute_gm_analysis for any FS line. Pulls CY + PY TB for a given FS line (or account code range), computes absolute and % movement, flags when |Δ| > PM or |Δ%| > 30%, and returns variances[] ready for request_gm_explanations.",
    "fs_line / account_codes (auto), tolerance_gbp (default = performance_materiality), tolerance_pct (default 30).",
    "variances (data_table with cy, py, delta, delta_pct, flagged, flag_reason), flagged_count, pass_fail.",
)
need(
    "request_listing",
    "Request Listing from Client",
    "Generic version of request_accruals_listing. Requests any ledger/schedule from the client via portal (debtors ageing, creditors ageing, FAR, inventory listing, loan schedule, share register, etc.) with a structured-columns prompt. Parses the returned file, extracts a data_table, and reconciles the total to the specified TB account codes.",
    "message_to_client, listing_type (select — debtors_ageing | creditors_ageing | far | inventory | loan_schedule | share_register | ecl_schedule | deferred_tax | other), account_codes, tolerance_gbp.",
    "data_table (parsed rows), listing_total, tb_total, variance, tb_reconciled (pass_fail), portal_request_id.",
)
need(
    "reconcile_to_tb",
    "Reconcile Listing to Trial Balance",
    "Takes a data_table (client listing) and a TB account-code range, sums the listing, compares to the TB total, flags variance. Used standalone when request_listing isn't needed (data already extracted).",
    "data_table (population), account_codes, tolerance_gbp.",
    "listing_total, tb_total, variance, pass_fail.",
)
need(
    "request_confirmations",
    "Request Third-Party Confirmations",
    "Sends confirmation letters (bank, debtor, creditor, loan, legal, pension) to third parties. Tracks responses via portal / email, escalates non-responses with alternative-procedure guidance, extracts confirmed balance per party, reconciles to TB, and produces exception list.",
    "confirmation_type (bank | debtor | creditor | loan | legal | other), sample_items (counterparties + expected balances), message_to_counterparty, chase_schedule_days.",
    "confirmations (data_table with counterparty, expected, confirmed, variance, response_status), exception_count, pass_fail.",
)
need(
    "physical_verification",
    "Physical Verification / Observation",
    "Schedules and records physical verification — inventory count attendance, PPE physical inspection, cash count. Auditor uploads count sheets / photos / tag numbers, AI reconciles to sample register.",
    "item_type (inventory | ppe | cash), sample_items (register rows), count_date, location(s).",
    "observations (data_table with item_ref, existence_confirmed, condition, variance_qty, variance_value, photos), exception_count, pass_fail.",
)
need(
    "recalculate_balance",
    "Recalculate Balance",
    "Generic recalculation wrapper: depreciation (by policy + cost + life), interest (rate × principal × days), tax (rate × taxable profit), ECL (% × ageing buckets), FX translation (rate × balance), prepayment amortisation. Picks the right formula from policy_type.",
    "policy_type (straight_line_depreciation | interest | tax | ecl_matrix | fx | prepayment_amortise | other), inputs (data_table with required columns per policy), comparison_values (data_table as booked).",
    "recalc_table (data_table with booked vs calculated vs diff), total_variance, pass_fail.",
)
need(
    "review_subsequent_activity",
    "Review Subsequent Activity (Post-YE)",
    "Pulls post-YE transactions (receipts, payments, credit notes, returns, journals) from the accounting system or supplied exports, filters to the X-day window after period end, and runs AI analysis to identify items that affect the period-end balance (unrecorded receivables, unrecorded credit notes, sales reversals, etc.).",
    "transaction_type (receipts | payments | credit_notes | returns | journals), x_days_post_ye (default 60), fs_line / account_codes.",
    "findings (data_table), impact_value, pass_fail.",
)
need(
    "test_journals",
    "Test Journals (Management Override)",
    "Management override test. Pulls all journals for the period, applies ISA 240 risk criteria (unusual users, round numbers, period-end weekend posts, manual to sensitive accounts), AI-ranks suspicious items, selects a sample, and requests supporting evidence.",
    "criteria (multiselect of ISA 240 flags), sample_size, period_start, period_end.",
    "suspicious_journals (data_table), sample_items, pass_fail.",
)
need(
    "run_fs_checker",
    "Run FS Checker",
    "Parses the draft financial statements and checks: disclosure completeness vs standards (IFRS / FRS102), cross-cast math, TB→FS tie, prior-year restatement flags, required-note coverage, formatting consistency.",
    "fs_document (file), framework (IFRS | FRS102 | other), tb_data (auto from engagement).",
    "checks (data_table with rule_code, pass_fail, evidence), exception_count, pass_fail.",
)
need(
    "review_cashflow_forecast",
    "Review Cash-Flow Forecast (Going Concern)",
    "Ingests management's going-concern cash-flow forecast, sensitivity analyses, and assumptions. AI challenges assumptions against CY actuals and budgets, stress-tests headroom, and evaluates the disclosed conclusion (unqualified / material uncertainty / adverse).",
    "forecast_documents (file), assumptions_document (file), period_covered_months (default 12).",
    "challenges (data_table with assumption, benchmark, delta, risk_rating), headroom_summary, recommended_opinion, pass_fail.",
)
need(
    "review_disclosures",
    "Review FS Disclosures (FS Line)",
    "AI-checks that the draft FS disclosures for a specific FS line are complete and compliant with the framework (e.g., IAS 16 for PPE, IFRS 15 for Revenue, IFRS 9 for financial instruments). Returns a per-rule checklist.",
    "fs_document (file), framework, fs_line, disclosure_rules (auto-sourced from standard).",
    "rules_checklist (data_table), exception_count, pass_fail.",
)
need(
    "reconcile_register",
    "Reconcile Sub-Ledger to TB",
    "Takes a register (FAR, stock list, debtors ledger, etc.), sums it, compares to the GL/TB account total, flags variance and lists unreconciled items. Differs from reconcile_to_tb in that it expects a register file format (not a parsed data_table) and produces a row-level variance report.",
    "register_file (file) OR register_table (json_table), account_codes, tolerance_gbp.",
    "register_total, tb_total, variance, unreconciled_items, pass_fail.",
)
need(
    "analyse_accounting_policy",
    "Analyse Accounting Policy Compliance",
    "AI-driven check that the entity's accounting policy for the FS line complies with the applicable standard (e.g., IFRS 15 performance obligations, IFRS 16 lease term, IAS 2 cost formula, IFRS 9 classification). Returns gaps and risk rating.",
    "policy_document (file or text from FS notes), framework, fs_line, standard_ref.",
    "findings (data_table with rule, compliant, gap_description, risk), pass_fail.",
)
need(
    "assess_estimates",
    "Assess Management Estimates",
    "Evaluates a management estimate (ECL provision, impairment, FV, warranty provision, revenue variable consideration, deferred tax judgement) — gathers inputs, re-performs calc independently where feasible, stress-tests key assumptions, and rates management's bias.",
    "estimate_type, estimate_value, supporting_schedule (file), assumptions (text).",
    "reperformed_value, variance, bias_rating (neutral | optimistic | pessimistic), pass_fail.",
)
need(
    "review_contracts",
    "Review Contracts / Agreements",
    "For a sample of contracts (sales contracts, leases, loans, shareholder agreements, group agreements, licence agreements): extract key terms (parties, values, dates, covenants, performance obligations, termination clauses) and check they match how the transaction has been recorded.",
    "contract_sample (file_array or portal refs), expected_terms (multiselect — parties | value | dates | covenants | perf_obligations | termination | other).",
    "extracted_terms (data_table), misalignments (data_table), pass_fail.",
)
need(
    "bank_reconciliation_review",
    "Review Bank Reconciliation",
    "Reviews the client's bank reconciliation at period end. Checks unreconciled items, stale cheques, uncleared receipts, post-YE clearance, and that reconciled balance = TB.",
    "reconciliation_file (file), bank_statement (file), tb_balance (auto).",
    "unreconciled_items, stale_items, reconciled_to_tb (pass_fail), exception_count.",
)
need(
    "analyse_related_party",
    "Analyse Related Party Transactions",
    "Identifies related-party transactions in the period using the related-party register + journal narrative search + accounting-system contacts, reconciles to disclosures in the FS, and flags undisclosed relationships.",
    "rp_register (file), period_start, period_end.",
    "rp_transactions (data_table), undisclosed_items, pass_fail.",
)
need(
    "review_fraud_risk",
    "Review Fraud Risk Indicators",
    "Scans a population for fraud indicators (fictitious counterparties, round-number patterns, side-letters, unusual terms, manual journals to revenue near YE) using ISA 240 criteria and AI-anomaly detection.",
    "population (data_table), fraud_scenarios (multiselect), period_end.",
    "flags (data_table with row_ref, scenario, score), reviewed_by_ai, pass_fail.",
)

# ───────────────────────────────────────────────────────────────────────────
# Pattern mapping — maps test description to (pattern_id, steps, notes, new_codes)
# ───────────────────────────────────────────────────────────────────────────
# Each pattern returns a list of step dicts + a list of new-action codes to register.
# Step binding strings use the $prev / $step.N / $ctx.* convention from action-seed.

# Common step templates
def steps_analytical_review():
    return [
        ("accounting_extract",         {"data_type": "'journals'", "account_codes": "$ctx.test.fsLine → derive from fs_line_accounts"}),
        ("analytical_review_variance", {"fs_line": "$ctx.test.fsLine"}),
        ("request_gm_explanations",    {"variances": "$prev.variances"}),
        ("assess_gm_explanations",     {"variances": "$step.2.variances", "explanations": "$prev.explanations"}),
        ("team_review",                {"instructions": "'Review variance investigation and conclude.'"}),
    ]

def steps_listing_reconciliation(listing_type: str):
    return [
        ("request_listing",   {"listing_type": f"'{listing_type}'", "account_codes": "$ctx.test.fsLineAccounts"}),
        ("reconcile_to_tb",   {"data_table": "$prev.data_table", "account_codes": "$ctx.test.fsLineAccounts"}),
        ("team_review",       {"instructions": "'Review reconciliation and any unreconciled items.'"}),
    ]

def steps_sample_inspect(doc_type: str, assertion: str):
    return [
        ("accounting_extract", {"data_type": "'journals'", "account_codes": "$ctx.test.fsLineAccounts"}),
        ("select_sample",      {"population": "$prev.data_table"}),
        ("request_documents",  {"transactions": "$prev.sample_items", "document_type": f"'{doc_type}'", "area_of_work": "$ctx.test.fsLine"}),
        ("verify_evidence",    {"evidence_documents": "$prev.documents", "sample_items": "$step.2.sample_items", "assertions": f"['{assertion}']"}),
        ("team_review",        {"instructions": "'Conclude on assertion testing.'"}),
    ]

def steps_cutoff():
    return [
        ("accounting_extract", {"data_type": "'journals'", "account_codes": "$ctx.test.fsLineAccounts"}),
        ("analyse_cut_off",    {"data_table": "$prev.data_table", "period_end": "$ctx.engagement.periodEnd", "cut_off_days": "7"}),
        ("team_review",        {"instructions": "'Review any cut-off exceptions.'"}),
    ]

def steps_confirmations(conf_type: str):
    return [
        ("accounting_extract",      {"data_type": "'bank_transactions' if conf_type=='bank' else 'contacts'", "account_codes": "$ctx.test.fsLineAccounts"}),
        ("select_sample",           {"population": "$prev.data_table"}),
        ("request_confirmations",   {"confirmation_type": f"'{conf_type}'", "sample_items": "$prev.sample_items"}),
        ("verify_evidence",         {"evidence_documents": "$prev.confirmations", "assertions": "['existence','valuation']"}),
        ("team_review",             {"instructions": "'Review confirmation exceptions / non-responses and alternative procedures.'"}),
    ]

def steps_physical(item_type: str):
    return [
        ("request_listing",         {"listing_type": "'far' if item_type=='ppe' else 'inventory'"}),
        ("select_sample",           {"population": "$prev.data_table"}),
        ("physical_verification",   {"item_type": f"'{item_type}'", "sample_items": "$prev.sample_items"}),
        ("team_review",             {"instructions": "'Review physical-verification exceptions.'"}),
    ]

def steps_disclosure_review():
    return [
        ("review_disclosures",  {"fs_line": "$ctx.test.fsLine", "framework": "$ctx.engagement.framework"}),
        ("team_review",         {"instructions": "'Review disclosure-checklist exceptions.'"}),
    ]

def steps_recalc(policy_type: str):
    return [
        ("request_listing",       {"listing_type": "'far' if 'depreciation' in policy_type else 'other'"}),
        ("recalculate_balance",   {"policy_type": f"'{policy_type}'", "inputs": "$prev.data_table"}),
        ("team_review",           {"instructions": "'Review recalculation variances.'"}),
    ]

def steps_subsequent(tx_type: str):
    return [
        ("review_subsequent_activity", {"transaction_type": f"'{tx_type}'", "fs_line": "$ctx.test.fsLine", "x_days_post_ye": "60"}),
        ("team_review",                {"instructions": "'Review post-YE items affecting period-end balance.'"}),
    ]

def steps_ai_only(prompt_hint: str):
    return [
        ("ai_analysis",  {"prompt_template": f"'{prompt_hint}'", "output_format": "'pass_fail'"}),
        ("team_review",  {"instructions": "'Review AI assessment and conclude.'"}),
    ]

def steps_policy():
    return [
        ("analyse_accounting_policy", {"framework": "$ctx.engagement.framework", "fs_line": "$ctx.test.fsLine"}),
        ("team_review",               {"instructions": "'Review policy-compliance findings.'"}),
    ]

def steps_estimates(estimate_type: str):
    return [
        ("request_documents",    {"document_type": "'other'", "area_of_work": "$ctx.test.fsLine"}),
        ("assess_estimates",     {"estimate_type": f"'{estimate_type}'", "supporting_schedule": "$prev.documents"}),
        ("team_review",          {"instructions": "'Review estimate assessment and challenge.'"}),
    ]

def steps_contracts():
    return [
        ("select_sample",         {"population": "$ctx.test.fsLineAccounts"}),
        ("request_documents",     {"document_type": "'contract'", "transactions": "$prev.sample_items"}),
        ("review_contracts",      {"contract_sample": "$prev.documents"}),
        ("team_review",           {"instructions": "'Review contract-terms alignment to recording.'"}),
    ]

def steps_urla():  # Unrecorded liabilities / liabilities (post-YE bank payments)
    return [
        ("request_documents",                       {"document_type": "'bank_statement'", "area_of_work": "$ctx.test.fsLine"}),
        ("extract_post_ye_bank_payments",           {"source_documents": "$prev.documents"}),
        ("select_unrecorded_liabilities_sample",    {"population": "$prev.data_table"}),
        ("request_documents",                       {"document_type": "'invoice'", "transactions": "$prev.sample_items"}),
        ("extract_accruals_evidence",               {"source_documents": "$prev.documents", "sample_items": "$step.3.sample_items"}),
        ("verify_unrecorded_liabilities_sample",    {"sample_items": "$step.3.sample_items", "extracted_evidence": "$prev.extracted_evidence"}),
        ("team_review",                             {"instructions": "'Review URLA markers; reds need adjustment or disclosure.'"}),
    ]

def steps_board_minutes():
    return [
        ("ai_analysis",   {"prompt_template": "'Scan board minutes and contracts for indications of unrecorded assets/liabilities for {fs_line}.'"}),
        ("team_review",   {"instructions": "'Review AI findings from minutes.'"}),
    ]

def steps_bank_recon():
    return [
        ("request_documents",             {"document_type": "'bank_statement'", "area_of_work": "'Cash and Cash equivalents'"}),
        ("extract_bank_statements",       {"source_files": "$prev.documents"}),
        ("bank_reconciliation_review",    {"bank_statement": "$step.1.documents"}),
        ("team_review",                   {"instructions": "'Review bank rec exceptions.'"}),
    ]

# Regex-based classifier — returns (pattern_id, description, step_builder_call, new_codes)
def classify(desc: str, fs_line: str, assertion: str, t_type: str):
    d = desc.lower()
    # Management Override
    if fs_line == "Management Override":
        return ("mgmt_override", "Management-override journal entry test (ISA 240).",
                [("test_journals", {"criteria": "['round_numbers','period_end_weekends','unusual_users','manual_to_sensitive']", "period_start": "$ctx.engagement.periodStart", "period_end": "$ctx.engagement.periodEnd"}),
                 ("request_documents", {"document_type": "'other'", "transactions": "$prev.sample_items"}),
                 ("verify_evidence", {"evidence_documents": "$prev.documents", "assertions": "['occurrence','accuracy']"}),
                 ("team_review", {"instructions": "'Conclude on management override.'"})],
                ["test_journals"])
    if fs_line == "Going Concern":
        return ("going_concern", "Going-concern review: evaluate management's cash-flow forecast and conclude on opinion.",
                [("request_documents", {"document_type": "'other'", "area_of_work": "'Going Concern'"}),
                 ("review_cashflow_forecast", {"forecast_documents": "$prev.documents"}),
                 ("team_review", {"instructions": "'Conclude on going-concern opinion wording.'"})],
                ["review_cashflow_forecast"])
    if fs_line == "Notes and Disclosures":
        return ("fs_checker", "Run the FS Checker across draft financial statements.",
                [("request_documents", {"document_type": "'other'", "area_of_work": "'Notes and Disclosures'"}),
                 ("run_fs_checker", {"fs_document": "$prev.documents", "framework": "$ctx.engagement.framework"}),
                 ("team_review", {"instructions": "'Review checker exceptions.'"})],
                ["run_fs_checker"])

    # Analytical review — PY variance
    if "review changes from py" in d or ("analytical" == t_type.lower()[:10] and "py" in d):
        return ("ar_variance", "Analytical review of movement vs PY, investigate where delta breaches threshold.",
                steps_analytical_review(), ["analytical_review_variance"])
    # Sampling calculator determine sample size
    if "sampling calculator" in d or "determine the number of samples" in d:
        return ("sample_size", "Determine sample size via the Sample Calculator.",
                [("select_sample", {"sample_type": "'standard'", "population": "$ctx.test.fsLineAccounts"})],
                [])
    # Cut-off
    if "cut-off" in d or "cut off" in d or "cutoff" in d or assertion == "Cut Off":
        return ("cutoff", "Cut-off test either side of period end.", steps_cutoff(), [])
    # FS Checker / disclosure
    if "run fs checker" in d:
        return ("fs_checker_one", "Run FS Checker.", [("run_fs_checker", {"framework": "$ctx.engagement.framework"}), ("team_review", {"instructions": "'Review.'"})], ["run_fs_checker"])
    # Disclosure review
    if assertion == "Presentation" or "disclosure" in d or "presented" in d or "ias 24" in d or "ifrs 15" in d and "disclosure" in d:
        return ("disclosure", "Review disclosures for compliance with framework.", steps_disclosure_review(), ["review_disclosures"])
    # Reconciliation of listing/register to TB
    if ("reconcile" in d and ("general ledger" in d or "trial balance" in d or "tb" in d or "far" in d)) or ("obtain" in d and ("listing" in d or "schedule" in d)):
        # Pick listing type by FS line
        listing_map = {
            "Accruals": "creditors_ageing",
            "Trade debtors": "debtors_ageing",
            "Trade creditors": "creditors_ageing",
            "Other debtors": "debtors_ageing",
            "Other creditors": "creditors_ageing",
            "Property plant and equipment": "far",
            "Intangible assets": "far",
            "Inventory": "inventory",
            "Loans and borrowings": "loan_schedule",
            "Share capital": "share_register",
            "Investments (financial assets)": "other",
            "Investments in subsidaries": "other",
            "Prepayments and accrued income": "other",
            "Deferred revenue": "other",
            "Deferred tax": "deferred_tax",
            "Cash and Cash equivalents": "other",
        }
        lt = listing_map.get(fs_line, "other")
        return ("listing_recon", f"Obtain {lt} listing and reconcile to TB.",
                steps_listing_reconciliation(lt), ["request_listing", "reconcile_to_tb"])
    # Confirmations
    if "confirmation" in d or "confirm balances" in d or "send confirmations" in d:
        conf = "bank" if fs_line.startswith("Cash") else ("debtor" if "debtor" in fs_line.lower() else ("creditor" if "creditor" in fs_line.lower() or fs_line=="Loans and borrowings" else "other"))
        return ("confirmations", f"Send third-party confirmations ({conf}).", steps_confirmations(conf), ["request_confirmations"])
    # Physical verification
    if "physical verification" in d or "observe cash" in d or "asset tags" in d or "serial number" in d or "observe" in d and "count" in d or "stocktake" in d or "inventory count" in d:
        item = "inventory" if fs_line == "Inventory" else ("cash" if fs_line.startswith("Cash") else "ppe")
        return ("physical", f"Physical verification of {item}.", steps_physical(item), ["physical_verification"])
    # Subsequent receipts (debtors, revenue completeness)
    if "subsequent receipt" in d or "unrecorded receivable" in d:
        return ("subs_receipts", "Inspect subsequent receipts post-YE.", steps_subsequent("receipts"), ["review_subsequent_activity"])
    # Subsequent payments / unrecorded creditors
    if "subsequent payment" in d or "subsequent bank statement" in d or "unrecorded accrual" in d or "unrecorded transaction" in d:
        return ("subs_payments", "Inspect subsequent payments / statements post-YE.", steps_subsequent("payments"), ["review_subsequent_activity"])
    # URLA — unrecorded liabilities pipeline
    if "unrecorded" in d and "liabilit" in d:
        return ("urla", "Unrecorded-liabilities test: post-YE payments pipeline.", steps_urla(), [])
    # Credit notes / returns
    if "credit note" in d or "returns" in d and "reverse" in d:
        return ("subs_creditnotes", "Review post-YE credit notes / returns for period impact.", steps_subsequent("credit_notes"), ["review_subsequent_activity"])
    # Recalculate depreciation
    if "recalculate depreciation" in d or "depreciation expense" in d and "recalculate" in d:
        return ("recalc_dep", "Recalculate depreciation.", steps_recalc("straight_line_depreciation"), ["recalculate_balance"])
    # Recalculate interest
    if "recalculate" in d and "interest" in d or ("interest" in d and "accrual" in d):
        return ("recalc_int", "Recalculate interest.", steps_recalc("interest"), ["recalculate_balance"])
    # Recalculate tax
    if ("tax" in d and ("calculation" in d or "recalc" in d or "rate" in d)) or "tax computation" in d:
        return ("recalc_tax", "Recalculate tax provision.", steps_recalc("tax"), ["recalculate_balance"])
    # ECL / allowance for bad debts / impairment
    if "expected credit loss" in d or "ecl" in d or "allowance for" in d or "write-off" in d or "provision" in d and "bad debt" in d:
        return ("ecl", "Assess ECL / bad-debt provision.", steps_estimates("ecl"), ["assess_estimates"])
    # Impairment
    if "impairment" in d:
        return ("impairment", "Assess impairment indicators and review.", steps_estimates("impairment"), ["assess_estimates"])
    # FV / revaluation
    if "revaluation" in d or "fair value" in d or "valuer" in d:
        return ("fv", "Assess valuation / revaluation.", steps_estimates("fair_value"), ["assess_estimates"])
    # Policy review
    if "accounting policy" in d or ("ifrs" in d and "applied" in d) or "policy" in d and "consist" in d:
        return ("policy", "Review accounting-policy compliance.", steps_policy(), ["analyse_accounting_policy"])
    # Classification
    if assertion == "Classification" or "classified" in d or "classification" in d or "misclass" in d:
        return ("classification", "Check classification within FS line.",
                steps_ai_only(f"Check classification of {fs_line} transactions for correct sub-categorisation against policy."), [])
    # Related party / IAS 24 / shareholder agreement
    if "related part" in d or "ias 24" in d:
        return ("related_party", "Identify and reconcile related-party transactions.",
                [("analyse_related_party", {"period_start": "$ctx.engagement.periodStart", "period_end": "$ctx.engagement.periodEnd"}),
                 ("team_review", {"instructions": "'Confirm RP disclosure agrees to findings.'"})],
                ["analyse_related_party"])
    # Ownership / rights via title deeds / contracts
    if assertion == "Rights & obligations" or "title deed" in d or "ownership" in d or "pledged" in d or "encumbr" in d:
        return ("ownership", "Inspect ownership evidence (contracts, deeds, agreements).", steps_contracts(), ["review_contracts"])
    # Sample + inspect supporting docs (existence / valuation / accuracy)
    if "supporting document" in d or "trace" in d and "invoice" in d or "inspect" in d and ("invoice" in d or "contract" in d) or "sample" in d and ("invoice" in d or "purchase invoice" in d or "contract" in d):
        doc = "invoice"
        if "contract" in d: doc = "contract"
        if "bank statement" in d: doc = "bank_statement"
        a = assertion.lower().split()[0] if assertion else "existence"
        return ("sample_inspect", f"Sample and inspect supporting {doc}s.", steps_sample_inspect(doc, a), [])
    # Board minutes / budget scan
    if "board minute" in d or "budget" in d and "unrecorded" in d:
        return ("board_minutes", "AI scan of board minutes / budgets for unrecorded items.", steps_board_minutes(), [])
    # Bank reconciliation
    if "bank reconciliation" in d or "reconcile bank" in d:
        return ("bank_recon", "Review bank reconciliation at period end.", steps_bank_recon(), ["bank_reconciliation_review"])
    # Fraud risk
    if "fictitious" in d or "fraud risk" in d or ("unusual terms" in d):
        return ("fraud", "Scan for fraud-risk indicators.",
                [("review_fraud_risk", {"fs_line": "$ctx.test.fsLine", "period_end": "$ctx.engagement.periodEnd"}),
                 ("team_review", {"instructions": "'Review fraud-risk scan results.'"})],
                ["review_fraud_risk"])
    # Discuss with management / understand process (Judgement / walkthrough)
    if "discuss with management" in d or "understand" in d and "process" in d or "walkthrough" in d or "design effectiveness" in d:
        return ("walkthrough", "Walkthrough / management discussion.",
                steps_ai_only(f"Record walkthrough of the {fs_line} process; document controls and design effectiveness."), [])
    # Performance obligation satisfaction
    if "performance obligation" in d:
        return ("perf_oblig", "Assess performance-obligation satisfaction per IFRS 15.",
                steps_ai_only(f"For {fs_line}, assess how the performance obligation is satisfied per the contract terms."), [])
    # FX / exchange rate
    if "foreign currenc" in d or "exchange rate" in d or "fx" in d:
        return ("fx", "Test FX translation on foreign-currency balances.",
                steps_recalc("fx"), ["recalculate_balance"])
    # Estimates / judgements (generic)
    if "estimate" in d or "judgement" in d or "reasonableness" in d:
        return ("estimates", "Assess management estimate / judgement.", steps_estimates("other"), ["assess_estimates"])
    # Aging review
    if "aging" in d or "ageing" in d:
        return ("ageing", "Review debtor/creditor ageing.",
                [("request_listing", {"listing_type": "'debtors_ageing' if 'debtor' in '%s'.lower() else 'creditors_ageing'" % fs_line}),
                 ("ai_analysis", {"prompt_template": "'Review ageing buckets for overdue items that may indicate ECL / disputed balances.'", "input_data": "$prev.data_table"}),
                 ("team_review", {"instructions": "'Review ageing findings.'"})],
                ["request_listing"])
    # Default — AI analysis with prompt derived from description
    return ("generic_ai", "Generic AI-analysis step with prompt mirroring the test description.",
            steps_ai_only(desc.replace("'", "\\'")), [])

# ───────────────────────────────────────────────────────────────────────────
# Rendering
# ───────────────────────────────────────────────────────────────────────────
def fmt_bindings(b: dict) -> str:
    if not b: return "{}"
    parts = [f"{k}: {v}" for k, v in b.items()]
    return "{ " + ", ".join(parts) + " }"

def output_format_for(fs_line: str, t_type: str) -> str:
    if t_type == "Analytical Review":   return "three_section_no_sampling"
    if t_type == "Judgement":           return "three_section_no_sampling"
    return "three_section_sampling"

def slugify(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s or "untitled"

def read_rows():
    rows = []
    with open(CSV_PATH, "r", encoding="cp1252") as f:
        rdr = csv.DictReader(f)
        for r in rdr:
            rows.append({k.strip(): (v or "").strip() for k, v in r.items()})
    return rows

def main():
    rows = read_rows()
    print(f"Read {len(rows)} tests")

    by_fs = defaultdict(list)
    for i, r in enumerate(rows, 1):
        r["_idx"] = i
        by_fs[r["FS Line Item"]].append(r)

    # Per-FS-line files
    index_entries = []
    for fs in sorted(by_fs.keys()):
        fs_rows = by_fs[fs]
        slug = slugify(fs)
        fname = f"{slug}.md"
        index_entries.append((fs, fname, len(fs_rows)))

        with open(os.path.join(OUT_DIR, fname), "w", encoding="utf-8") as out:
            out.write(f"# Test Specs — {fs}\n\n")
            out.write(f"Framework: FRS102   Significant Risk: Y   Test count: {len(fs_rows)}\n\n")
            out.write(f"Source CSV row range: {fs_rows[0]['_idx']}–{fs_rows[-1]['_idx']}\n\n")
            out.write("---\n\n")

            for r in fs_rows:
                desc = r["Test Description"].replace("\r","").replace("\n","\n  ")
                assertion = r.get("Assertion","").strip()
                t_type = r.get("Type","").strip()
                pid, summary, steps, new_codes = classify(r["Test Description"], fs, assertion, t_type)

                for code in new_codes:
                    if code in NEW_ACTIONS:
                        NEW_ACTIONS[code]["used_by"].add(fs)

                out.write(f"### Test {r['_idx']}: {r['Test Description'][:110].replace(chr(10),' ')}\n\n")
                out.write(f"- FS Line: **{fs}**\n")
                out.write(f"- Assertion: **{assertion}**\n")
                out.write(f"- Type: **{t_type}**\n")
                out.write(f"- Framework: FRS102\n")
                out.write(f"- Significant Risk: Y\n")
                out.write(f"- Output Format: `{output_format_for(fs, t_type)}`\n")
                out.write(f"- Execution Mode: `action_pipeline`\n")
                out.write(f"- Pattern: `{pid}` — {summary}\n\n")
                if "\n" in r["Test Description"] or len(r["Test Description"]) > 110:
                    out.write(f"**Full description:**\n\n> {desc}\n\n")

                out.write("**Steps:**\n\n")
                for idx, (code, bindings) in enumerate(steps, 1):
                    flag = " " if code in EXISTING_ACTIONS else " 🆕"
                    out.write(f" {idx}. `{code}`{flag} — bindings: `{fmt_bindings(bindings)}`\n")
                out.write("\n")

                new_used = [c for c in new_codes if c in NEW_ACTIONS]
                if new_used:
                    out.write("**New Actions referenced:**\n\n")
                    for c in new_used:
                        out.write(f" - `{c}` — {NEW_ACTIONS[c]['name']}\n")
                    out.write("\n")
                else:
                    out.write("**New Actions referenced:** none (all existing).\n\n")

                out.write("---\n\n")

    # _new-actions.md
    with open(os.path.join(OUT_DIR, "_new-actions.md"), "w", encoding="utf-8") as out:
        out.write("# New Actions to Build\n\n")
        out.write("These Actions are referenced by the test specs but do not yet exist in `lib/action-seed.ts`. "
                  "Once approved, each should be seeded in the same pattern as the existing system Actions.\n\n")
        for code, info in sorted(NEW_ACTIONS.items()):
            out.write(f"## `{code}`\n\n")
            out.write(f"**Name:** {info['name']}\n\n")
            out.write(f"**Description:** {info['description']}\n\n")
            if info["inputs"]:  out.write(f"**Inputs (sketch):** {info['inputs']}\n\n")
            if info["outputs"]: out.write(f"**Outputs (sketch):** {info['outputs']}\n\n")
            if info["used_by"]:
                used = ", ".join(sorted(info["used_by"]))
                out.write(f"**Referenced by FS lines:** {used}\n\n")
            out.write("---\n\n")

    # README.md index
    with open(os.path.join(OUT_DIR, "README.md"), "w", encoding="utf-8") as out:
        out.write("# Audit Test Specs — Draft Test Pack\n\n")
        out.write(f"Generated from `test-bank-template-default (2.csv` — **{sum(n for _,_,n in index_entries)} tests** across **{len(index_entries)} FS lines**.\n\n")
        out.write("Each spec block is formatted for review and direct handoff to Claude for Action-Pipeline build-out. "
                  "Symbols:\n\n")
        out.write(" - No icon = existing Action (already in `lib/action-seed.ts`)\n")
        out.write(" - 🆕 = **new Action** needed — see [_new-actions.md](./_new-actions.md)\n\n")
        out.write("## Binding conventions\n\n")
        out.write("Bindings use the runtime variable syntax from the Action Pipeline engine:\n\n")
        out.write(" - `$prev.<field>` — output of the preceding step\n")
        out.write(" - `$step.N.<field>` — output of step N (1-indexed)\n")
        out.write(" - `$ctx.engagement.*` — engagement-level context (periodEnd, framework, etc.)\n")
        out.write(" - `$ctx.test.fsLine` / `$ctx.test.fsLineAccounts` — current test context\n")
        out.write(" - Literal values in single quotes (e.g. `'invoice'`, `'60'`)\n\n")
        out.write("## FS Lines (alphabetical)\n\n")
        for fs, fname, n in index_entries:
            out.write(f" - [{fs}]({fname}) — {n} tests\n")
        out.write("\n## Cross-cutting docs\n\n")
        out.write(" - [_new-actions.md](./_new-actions.md) — catalogue of new Actions this test pack needs\n")

    print("Wrote files:")
    for fs, fname, n in index_entries:
        print(f"  {fname} ({n} tests)")
    print("  _new-actions.md")
    print("  README.md")

if __name__ == "__main__":
    main()
