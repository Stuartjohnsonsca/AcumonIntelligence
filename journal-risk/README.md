# journal-risk

Management override journal risk scoring and selection module aligned to ISA 240.

## Quick Start

```bash
cd journal-risk
npm install
npm run build
node dist/index.js \
  --journals examples/journals.sample.csv \
  --users examples/users.sample.csv \
  --accounts examples/accounts.sample.csv \
  --config examples/config.sample.json \
  --out ./out
```

## How It Works

### Pipeline

1. **Ingest** - Load journals, users, accounts CSVs + config JSON. Validate all inputs.
2. **Completeness** - Compute population evidence (record count, hash totals, date coverage).
3. **Features** - Derive risk features: timing, user behaviour, account usage, keywords.
4. **Risk Engine** - Evaluate 13 explainable rules against each journal. Produce risk score + drivers.
5. **Selection** - Select journals across 3 layers with full audit trail.
6. **Reporting** - Export JSON, CSV, Markdown summary, and JSONL audit trail.

### Selection Layers

| Layer | Purpose | Criteria |
|-------|---------|----------|
| **Layer 1: Mandatory** | High-risk journals that must be tested | Score >= threshold OR >= N critical tags |
| **Layer 2: Targeted** | Coverage across risk dimensions | Top N per dimension bucket |
| **Layer 3: Unpredictable** | Element of unpredictability | Deterministic random from low/medium pool |

### Risk Rules (13 default)

| ID | Name | Severity | Dimension |
|----|------|----------|-----------|
| T01 | Post-close journal | Critical | Timing |
| T02 | Period-end window | High | Timing |
| T03 | Outside business hours | Medium | Timing |
| U01 | Senior management poster | Critical | User/Access |
| U02 | Atypical poster | High | User/Access |
| U03 | Same preparer and approver | High | User/Access |
| C01 | Seldom-used account | High | Content |
| C02 | Unusual account pair | High | Content |
| C03 | Round number | Medium | Content |
| D01 | Weak/missing explanation | High | Description |
| D02 | Suspicious keywords | High | Description |
| A01 | Judgmental/estimate account | High | Accounting Risk |
| B01 | Quick reversal | Medium | Behaviour |

### Explainability

Every selected journal has an explicit rationale composed from triggered rules, e.g.:
> "Selected because: post-close; senior poster (Finance Director); suspicious keyword 'as instructed'; round number."

### How to Add Rules

1. Edit `src/risk/rules.default.ts`
2. Add a new `RiskRule` object with unique `ruleId`
3. Add the corresponding derived function in `src/features/derived.ts`
4. Register the `derivedFn` name in `src/risk/ruleEngine.ts` evaluateRule switch
5. Add weight to config schema and sample config

## Outputs

| File | Description |
|------|-------------|
| `result.json` | Full structured output conforming to `schemas/journal-risk-score.v1.json` |
| `journals_scored.csv` | One row per journal with score, tags, selection layer |
| `selection_summary.md` | Human-readable summary with population evidence, selection counts, top journals |
| `audit_trail.jsonl` | Append-only log of run metadata and any override events |

## Testing

```bash
npm test
```

## Override Controls

Layer 1 mandatory journals cannot be unselected without recording a justification. The audit trail logs all override events with timestamp, user, and reason.
