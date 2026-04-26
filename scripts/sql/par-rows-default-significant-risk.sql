-- Default PAR-sourced RMM rows to rowCategory='significant_risk' when
-- the auditor hasn't yet assessed them (Likelihood + Magnitude both
-- empty → matrix can't classify → row would otherwise show no dot
-- and miss the Audit Planning Letter's Significant Risks appendix).
--
-- Rule of thumb: PAR pushed it because something material moved; the
-- conservative default is "treat it as a significant risk until the
-- auditor works through the assessment." Filling in Likelihood and
-- Magnitude lets the matrix compute the real classification, which
-- can downgrade the row.
--
-- Idempotent. Only flips rows that:
--   • carry source='par'
--   • have NO existing rowCategory
--   • have NO Likelihood AND NO Magnitude (i.e. unassessed — once
--     either is set, the client-side auto-derive takes over)

UPDATE audit_rmm_rows
SET row_category = 'significant_risk'
WHERE source = 'par'
  AND row_category IS NULL
  AND (likelihood IS NULL OR likelihood = '')
  AND (magnitude IS NULL OR magnitude = '');

-- Sanity check
SELECT
  COUNT(*) FILTER (WHERE source = 'par' AND row_category = 'significant_risk') AS par_significant_risk,
  COUNT(*) FILTER (WHERE source = 'par' AND row_category = 'area_of_focus')   AS par_area_of_focus,
  COUNT(*) FILTER (WHERE source = 'par' AND row_category IS NULL)              AS par_uncategorised
FROM audit_rmm_rows;
