-- Quick verification query — should return 0 after migrate-all-to-sme.sql.
SELECT audit_type, COUNT(*) AS row_count
FROM methodology_templates
GROUP BY audit_type
ORDER BY audit_type;
