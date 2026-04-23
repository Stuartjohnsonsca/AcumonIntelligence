# Audit Test Specs — Draft Test Pack

Generated from `test-bank-template-default (2.csv` — **534 tests** across **32 FS lines**.

Each spec block is formatted for review and direct handoff to Claude for Action-Pipeline build-out. Symbols:

 - No icon = existing Action (already in `lib/action-seed.ts`)
 - 🆕 = **new Action** needed — see [_new-actions.md](./_new-actions.md)

## Binding conventions

Bindings use the runtime variable syntax from the Action Pipeline engine:

 - `$prev.<field>` — output of the preceding step
 - `$step.N.<field>` — output of step N (1-indexed)
 - `$ctx.engagement.*` — engagement-level context (periodEnd, framework, etc.)
 - `$ctx.test.fsLine` / `$ctx.test.fsLineAccounts` — current test context
 - Literal values in single quotes (e.g. `'invoice'`, `'60'`)

## FS Lines (alphabetical)

 - [Accruals](accruals.md) — 16 tests
 - [Amount owed by group undertakings](amount-owed-by-group-undertakings.md) — 17 tests
 - [Amounts owed to group undertakings](amounts-owed-to-group-undertakings.md) — 19 tests
 - [Cash and Cash equivalents](cash-and-cash-equivalents.md) — 18 tests
 - [Corporation tax payable](corporation-tax-payable.md) — 14 tests
 - [Cost of Sales](cost-of-sales.md) — 23 tests
 - [Deferred revenue](deferred-revenue.md) — 16 tests
 - [Deferred tax](deferred-tax.md) — 17 tests
 - [Going Concern](going-concern.md) — 1 tests
 - [Intangible assets](intangible-assets.md) — 19 tests
 - [Interest payable and similar income](interest-payable-and-similar-income.md) — 22 tests
 - [Inventory](inventory.md) — 18 tests
 - [Investments (financial assets)](investments-financial-assets.md) — 20 tests
 - [Investments in subsidaries](investments-in-subsidaries.md) — 16 tests
 - [Loans and borrowings](loans-and-borrowings.md) — 18 tests
 - [Management Override](management-override.md) — 1 tests
 - [Notes and Disclosures](notes-and-disclosures.md) — 1 tests
 - [Operating Expenses](operating-expenses.md) — 24 tests
 - [Other Operating Income](other-operating-income.md) — 21 tests
 - [Other creditors](other-creditors.md) — 15 tests
 - [Other debtors](other-debtors.md) — 17 tests
 - [Other interest receivable and similar income](other-interest-receivable-and-similar-income.md) — 23 tests
 - [Other taxation and social security payable](other-taxation-and-social-security-payable.md) — 15 tests
 - [Prepayments and accrued income](prepayments-and-accrued-income.md) — 15 tests
 - [Property plant and equipment](property-plant-and-equipment.md) — 21 tests
 - [Reserves](reserves.md) — 13 tests
 - [Revenue](revenue.md) — 24 tests
 - [Share capital](share-capital.md) — 13 tests
 - [Tax expense](tax-expense.md) — 22 tests
 - [Trade creditors](trade-creditors.md) — 15 tests
 - [Trade debtors](trade-debtors.md) — 18 tests
 - [Wages & Salaries](wages-salaries.md) — 22 tests

## Cross-cutting docs

 - [_new-actions.md](./_new-actions.md) — catalogue of new Actions this test pack needs
