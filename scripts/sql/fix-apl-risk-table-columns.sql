-- Audit Planning Letter (id = cmo4ljce4000110p9be32z1lv) — split the
-- Significant Risks (Appendix A) and Areas of Focus (Appendix B) tables
-- so the two columns hold distinct fields:
--
--   Left  ("Significant Risk" / "Area of Focus" header) = {{fsLine}}
--     The financial-statement line item the risk attaches to —
--     "Supplier Payables", "Barclays Current Account" etc. Sourced
--     from RMM's `lineItem` column.
--
--   Right ("Description" header) = {{description}}
--     The Nature text typed on the RMM tab (`riskIdentified` column).
--
-- Before this fix the left column rendered `{{name}}`, which falls
-- back to lineItem when riskIdentified is empty — so once Nature WAS
-- typed, both columns would render the same text. This change keeps
-- the columns distinct regardless of what's been typed.
--
-- Both Appendix A and Appendix B share the same row template (only
-- the surrounding heading differs), so a single REPLACE hits both.
-- All long literals use `$$...$$` dollar quoting so the run script's
-- splitter doesn't trip on the inline-CSS semicolons. Idempotent —
-- re-running after the fix matches zero strings.

UPDATE document_templates
SET content = REPLACE(
  content,
  $$<td style="border-width: 1px; border-color: rgb(148, 163, 184); padding: 6px; vertical-align: top;">{{name}}</td><td style="border-width: 1px; border-color: rgb(148, 163, 184); padding: 6px; vertical-align: top;">{{description}}</td>$$,
  $$<td style="border-width: 1px; border-color: rgb(148, 163, 184); padding: 6px; vertical-align: top;">{{fsLine}}</td><td style="border-width: 1px; border-color: rgb(148, 163, 184); padding: 6px; vertical-align: top;">{{description}}</td>$$
)
WHERE id = 'cmo4ljce4000110p9be32z1lv'
  AND firm_id = 'johnsons-firm-id-0000-000000000001'
  AND name = 'Audit Planning Letter';

-- Verify — the old fragment should be gone, the new fragment present.
SELECT
  POSITION($$<td style="border-width: 1px; border-color: rgb(148, 163, 184); padding: 6px; vertical-align: top;">{{name}}</td>$$ IN content) AS old_left_col_left,
  POSITION($$<td style="border-width: 1px; border-color: rgb(148, 163, 184); padding: 6px; vertical-align: top;">{{fsLine}}</td>$$ IN content) AS new_left_col_left,
  length(content) AS bytes_after
FROM document_templates
WHERE id = 'cmo4ljce4000110p9be32z1lv';
