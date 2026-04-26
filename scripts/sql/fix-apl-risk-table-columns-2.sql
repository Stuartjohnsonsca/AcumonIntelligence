-- Follow-up to fix-apl-risk-table-columns.sql. The two appendix tables
-- in the template have slightly DIFFERENT inline CSS:
--   - Areas of Focus (Appendix B):  border-color: rgb(148, 163, 184)
--   - Significant Risks (Appendix A): border-color: #f1f9f8   ← editor
--                                     normalised this on a later save
--
-- The first SQL fix only matched the rgb form, so Significant Risks
-- still rendered the line-item in BOTH columns (name fell back to
-- lineItem when riskIdentified was null). This catches the #f1f9f8
-- variant too. Idempotent: re-running matches zero strings.

UPDATE document_templates
SET content = REPLACE(
  content,
  $$<td style="border-width: 1px; border-color: #f1f9f8; padding: 6px; vertical-align: top;">{{name}}</td><td style="border-width: 1px; border-color: #f1f9f8; padding: 6px; vertical-align: top;">{{description}}</td>$$,
  $$<td style="border-width: 1px; border-color: #f1f9f8; padding: 6px; vertical-align: top;">{{fsLine}}</td><td style="border-width: 1px; border-color: #f1f9f8; padding: 6px; vertical-align: top;">{{description}}</td>$$
)
WHERE id = 'cmo4ljce4000110p9be32z1lv'
  AND firm_id = 'johnsons-firm-id-0000-000000000001'
  AND name = 'Audit Planning Letter';

-- Verify — the #f1f9f8 variant should now show {{fsLine}} on the left.
SELECT
  POSITION($$#f1f9f8; padding: 6px; vertical-align: top;">{{name}}$$ IN content) AS old_left_still_there,
  POSITION($$#f1f9f8; padding: 6px; vertical-align: top;">{{fsLine}}$$ IN content) AS new_left_present,
  length(content) AS bytes_after
FROM document_templates
WHERE id = 'cmo4ljce4000110p9be32z1lv';
