# Test Specs — Going Concern

Framework: FRS102   Significant Risk: Y   Test count: 1

Source CSV row range: 1–1

---

### Test 1: Check cashflow forecast

- FS Line: **Going Concern**
- Assertion: **Occurrence & Accuracy**
- Type: **Judgement**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_no_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `going_concern` — Going-concern review: evaluate management's cash-flow forecast and conclude on opinion.

**Steps:**

 1. `request_documents`  — bindings: `{ document_type: 'other', area_of_work: 'Going Concern' }`
 2. `review_cashflow_forecast` 🆕 — bindings: `{ forecast_documents: $prev.documents }`
 3. `team_review`  — bindings: `{ instructions: 'Conclude on going-concern opinion wording.' }`

**New Actions referenced:**

 - `review_cashflow_forecast` — Review Cash-Flow Forecast (Going Concern)

---

