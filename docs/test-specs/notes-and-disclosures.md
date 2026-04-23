# Test Specs — Notes and Disclosures

Framework: FRS102   Significant Risk: Y   Test count: 1

Source CSV row range: 3–3

---

### Test 3: Run FS Checker

- FS Line: **Notes and Disclosures**
- Assertion: **Occurrence & Accuracy**
- Type: **Judgement**
- Framework: FRS102
- Significant Risk: Y
- Output Format: `three_section_no_sampling`
- Execution Mode: `action_pipeline`
- Pattern: `fs_checker` — Run the FS Checker across draft financial statements.

**Steps:**

 1. `request_documents`  — bindings: `{ document_type: 'other', area_of_work: 'Notes and Disclosures' }`
 2. `run_fs_checker` 🆕 — bindings: `{ fs_document: $prev.documents, framework: $ctx.engagement.framework }`
 3. `team_review`  — bindings: `{ instructions: 'Review checker exceptions.' }`

**New Actions referenced:**

 - `run_fs_checker` — Run FS Checker

---

