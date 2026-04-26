-- Follow-up data fix for the "Audit Planning Letter" document template
-- (id = cmo4ljce4000110p9be32z1lv, firm = johnsons-firm-id-0000-000000000001).
--
-- Three rendering bugs reported after the timetable parse-error fix:
--
-- A. Team table renders the internal role code ("Manager") instead of
--    the friendly UI label ("Reviewer"). Fixed by replacing `{{role}}`
--    with `{{roleLabel}}`. The `roleLabel` field is added to the team
--    template-context entries in this same change set (see
--    lib/template-context.ts).
--
-- B. Timetable "Expected Completion" column shows the revisedTarget
--    only — blank when revisedTarget is null. The data model treats
--    targetDate as the agreed date and revisedTarget as a later
--    over-ride, so the rendered date should fall back to targetDate
--    when revisedTarget is empty. Fixed by wrapping the date in the
--    `default` helper.
--
-- C. Significant Risks (Appendix A) and Areas of Focus (Appendix B)
--    tables had the same structural bug as the timetable: an empty
--    self-closed `{{#each auditPlan.X}}{{/each}}` outside the table,
--    then a static `<tr>` inside `<tbody>` referencing `{{name}}` and
--    `{{description}}` at the top-level scope (where they resolve to
--    nothing). Fixed by removing the empty each and wrapping the row
--    in a comment-bracketed each block.
--
-- All long literals use `$$...$$` dollar quoting so the run script's
-- splitter doesn't trip on semicolons inside inline CSS. Idempotent —
-- re-running after the fix is applied matches zero strings.

-- 1. Pre-flight — should return one row, ~14391 bytes.
SELECT id, name, length(content) AS bytes_before
FROM document_templates
WHERE id = 'cmo4ljce4000110p9be32z1lv'
  AND firm_id = 'johnsons-firm-id-0000-000000000001';

-- 2. Apply all three fixes via nested REPLACEs.
UPDATE document_templates
SET content =
  -- Fix A: team role code → friendly label.
  REPLACE(
    -- Fix B: timetable date falls back to targetDate when no revised target.
    REPLACE(
      -- Fix C2: Areas of Focus structure — strip empty each + wrap <tr>.
      REPLACE(
        REPLACE(
          -- Fix C1: Significant Risks structure — strip empty each + wrap <tr>.
          REPLACE(
            REPLACE(
              content,
              -- C1a: remove the empty self-closed each.
              $${{#each auditPlan.significantRisks}}{{/each}}<table$$,
              $$<table$$
            ),
            -- C1b: wrap the static <tr> in comment-bracketed each.
            $$<tbody><tr><td style="border-width: 1px; border-color: rgb(148, 163, 184); padding: 6px; vertical-align: top;">{{name}}</td><td style="border-width: 1px; border-color: rgb(148, 163, 184); padding: 6px; vertical-align: top;">{{description}}</td></tr></tbody></table><p></p></div><div><hr></div>$$,
            $$<tbody><!--{{#each auditPlan.significantRisks}}--><tr><td style="border-width: 1px; border-color: rgb(148, 163, 184); padding: 6px; vertical-align: top;">{{name}}</td><td style="border-width: 1px; border-color: rgb(148, 163, 184); padding: 6px; vertical-align: top;">{{description}}</td></tr><!--{{/each}}--></tbody></table><p></p></div><div><hr></div>$$
          ),
          -- C2a: remove Areas of Focus empty self-closed each.
          $${{#each auditPlan.areasOfFocus}}{{/each}}<table$$,
          $$<table$$
        ),
        -- C2b: wrap Areas of Focus static <tr> in comment-bracketed each.
        -- Anchored on the trailing </div><div><p></p></div> so we hit
        -- the SECOND of the two identically-styled tbody/tr/tbody blocks.
        $$<tbody><tr><td style="border-width: 1px; border-color: rgb(148, 163, 184); padding: 6px; vertical-align: top;">{{name}}</td><td style="border-width: 1px; border-color: rgb(148, 163, 184); padding: 6px; vertical-align: top;">{{description}}</td></tr></tbody></table><p></p></div><div><p></p></div>$$,
        $$<tbody><!--{{#each auditPlan.areasOfFocus}}--><tr><td style="border-width: 1px; border-color: rgb(148, 163, 184); padding: 6px; vertical-align: top;">{{name}}</td><td style="border-width: 1px; border-color: rgb(148, 163, 184); padding: 6px; vertical-align: top;">{{description}}</td></tr><!--{{/each}}--></tbody></table><p></p></div><div><p></p></div>$$
      ),
      -- B: timetable date fallback.
      $${{formatDate revisedTarget "dd MMMM yyyy"}}$$,
      $${{formatDate (default revisedTarget targetDate) "dd MMMM yyyy"}}$$
    ),
    -- A: team role code → friendly label.
    $$<tr><td>{{role}}</td><td>{{name}}</td></tr>$$,
    $$<tr><td>{{roleLabel}}</td><td>{{name}}</td></tr>$$
  )
WHERE id = 'cmo4ljce4000110p9be32z1lv'
  AND firm_id = 'johnsons-firm-id-0000-000000000001'
  AND name = 'Audit Planning Letter';

-- 3. Post-flight verification — all four should return 0 (= "not present").
SELECT
  POSITION('{{#each auditPlan.significantRisks}}{{/each}}' IN content) AS sig_empty_each_left,
  POSITION('{{#each auditPlan.areasOfFocus}}{{/each}}' IN content) AS focus_empty_each_left,
  POSITION($${{formatDate revisedTarget "dd MMMM yyyy"}}$$ IN content) AS bare_revised_left,
  POSITION('<td>{{role}}</td>' IN content) AS bare_role_left,
  length(content) AS bytes_after
FROM document_templates
WHERE id = 'cmo4ljce4000110p9be32z1lv';
