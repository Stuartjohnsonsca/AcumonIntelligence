-- Cleanup for the new PAR-source flag UX.
--
-- Previously the PAR send-rmm route auto-populated the Nature column
-- (riskIdentified) with "Flagged from PAR — significant movement
-- identified" when the client hadn't typed an explanation. Now that
-- PAR-sourced rows are flagged with an asterisk on the lineItem cell
-- instead, the Nature column should be left empty so the auditor can
-- write their own assessment.
--
-- Two passes:
--   1. Restore source='par' on rows that carry the boilerplate text —
--      the autosave round-trip was clobbering source=null on PAR rows
--      (separate bug, fixed forwards in subsequent commits) so we
--      use the boilerplate as a positive identifier.
--   2. Null out the boilerplate so the asterisk is the only visible
--      signal of the row's origin. Only matches the EXACT auto-text;
--      any auditor enrichments that contain extra words are left
--      alone.
--
-- Idempotent — re-running matches zero rows once cleared.

UPDATE audit_rmm_rows
SET source = 'par'
WHERE source IS NULL
  AND risk_identified = 'Flagged from PAR — significant movement identified';

UPDATE audit_rmm_rows
SET risk_identified = NULL
WHERE risk_identified = 'Flagged from PAR — significant movement identified';

-- Sanity check
SELECT
  COUNT(*) FILTER (WHERE source = 'par') AS par_rows,
  COUNT(*) FILTER (WHERE source = 'par' AND risk_identified IS NULL) AS par_with_blank_nature,
  COUNT(*) FILTER (WHERE source = 'par' AND risk_identified IS NOT NULL) AS par_with_nature_filled
FROM audit_rmm_rows;
