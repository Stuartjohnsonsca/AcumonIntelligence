# Test Specs — Management Override

Framework: FRS102   Significant Risk: Y   Test count: 1

Source CSV row range: 2–2

---

### Test 2: Check journals posted

- FS Line: **Management Override**
- Assertion: **Occurrence & Accuracy**
- Type: **Judgement**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_no_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `mgmt_override` — Management-override journal entry test (ISA 240).

**Steps:**

 1. `test_journals` 🆕 — bindings: `{ criteria: ['round_numbers','period_end_weekends','unusual_users','manual_to_sensitive'], period_start: $ctx.engagement.periodStart, period_end: $ctx.engagement.periodEnd }`
 2. `request_documents`  — bindings: `{ document_type: 'other', transactions: $prev.sample_items }`
 3. `verify_evidence`  — bindings: `{ evidence_documents: $prev.documents, assertions: ['occurrence','accuracy'] }`
 4. `team_review`  — bindings: `{ instructions: 'Conclude on management override.' }`

**New Actions referenced:**

 - `test_journals` — Test Journals (Management Override)

---

