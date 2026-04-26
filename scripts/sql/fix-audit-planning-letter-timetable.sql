-- One-off data fix for the "Audit Planning Letter" document template
-- (id = cmo4ljce4000110p9be32z1lv, firm = johnsons-firm-id-0000-000000000001).
--
-- Bug 1 — orphan block tags between the team table and the timetable
--   table: a `{{/each}}` with no matching `{{#each}}` and a dangling
--   `-->` (stored HTML-encoded as `--&gt;`). Produced the
--   "Expecting 'EOF', got 'OPEN_ENDBLOCK'" Handlebars parse error.
--
-- Bug 2 — missing `<!--{{/each}}-->` close-comment in the timetable
--   <tbody>. The second `{{#each auditTimetable}}` (the one wrapping
--   the milestone <tr>) had no matching close.
--
-- All long literals use `$$...$$` dollar quoting because:
--   (a) the inline CSS contains semicolons, which the run script's
--       statement splitter would otherwise misread as SQL terminators,
--   (b) the literals contain double quotes around CSS values, which
--       would break single-quoted strings.
-- Idempotent — re-running after the fix is applied matches zero
-- strings and leaves the row unchanged.

-- 1. Pre-flight — should return exactly one row, ~14550 bytes.
SELECT id, name, firm_id, length(content) AS bytes_before
FROM document_templates
WHERE id = 'cmo4ljce4000110p9be32z1lv'
  AND firm_id = 'johnsons-firm-id-0000-000000000001'
  AND name = 'Audit Planning Letter';

-- 2. Apply both fixes. Triple-keyed WHERE locks the update to one row.
UPDATE document_templates
SET content = REPLACE(
  REPLACE(
    content,
    $$<p>{{#each auditTimetable}}{{/each}}</p><p></p><p></p>{{#if targetDate}}{{#if revisedTarget}}{{#if revisedTarget}}{{#if targetDate}}{{/if}}{{/if}}{{/if}}{{/if}}{{/each}}--&gt;$$,
    ''
  ),
  $$<td style="border:1px solid #94a3b8;padding:6px;vertical-align:top">{{formatDate revisedTarget "dd MMMM yyyy"}}</td></tr></tbody>$$,
  $$<td style="border:1px solid #94a3b8;padding:6px;vertical-align:top">{{formatDate revisedTarget "dd MMMM yyyy"}}</td></tr><!--{{/each}}--></tbody>$$
)
WHERE id = 'cmo4ljce4000110p9be32z1lv'
  AND firm_id = 'johnsons-firm-id-0000-000000000001'
  AND name = 'Audit Planning Letter';

-- 3. Post-flight verification — both POSITION calls should return 0.
SELECT
  POSITION('{{/each}}--&gt;' IN content) AS orphan_still_there,
  POSITION($${{formatDate revisedTarget "dd MMMM yyyy"}}</td></tr></tbody>$$ IN content) AS missing_close_still_there,
  length(content) AS bytes_after
FROM document_templates
WHERE id = 'cmo4ljce4000110p9be32z1lv';
