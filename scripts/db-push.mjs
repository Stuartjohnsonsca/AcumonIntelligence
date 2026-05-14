/**
 * Resilient `prisma db push` wrapper used by the production build.
 *
 * Why this exists: the previous build script ran
 *
 *   prisma db push --skip-generate --accept-data-loss || true
 *
 * The `|| true` swallowed ALL failures, so a deploy that couldn't apply
 * the schema (lock timeout, network blip, validation error) would still
 * succeed — the new code shipped against an unmigrated database and
 * threw at runtime (P2022 missing-column errors). This wrapper:
 *
 *   1. Runs `prisma db push --skip-generate --accept-data-loss`.
 *   2. If it fails because Postgres held an ACCESS EXCLUSIVE lock for
 *      too long, terminates any leaked `idle in transaction` sessions
 *      and retries once. This is the failure mode we just hit in
 *      production, where a stuck Prisma client kept an AccessShareLock
 *      on `methodology_tests` for 12+ minutes.
 *   3. Surfaces every other failure as a non-zero exit so the Vercel
 *      build fails loudly instead of deploying broken code.
 *
 * Safety: terminating idle-in-tx sessions is benign — they're already
 * not doing work, and any application code on those connections will
 * just retry on the pool. We never touch sessions in `active` state.
 */

import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const PRISMA_CMD = ['db', 'push', '--skip-generate', '--accept-data-loss'];

function runPrismaPush() {
  const result = spawnSync('npx', ['prisma', ...PRISMA_CMD], {
    stdio: ['inherit', 'pipe', 'pipe'],
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  // Echo prisma's output so the Vercel build log shows what happened.
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function looksLikeLockTimeout(text) {
  return /lock timeout|canceling statement due to lock timeout|55P03/i.test(text);
}

async function killIdleBlockers() {
  const prisma = new PrismaClient();
  try {
    // Generous client-side budget for the kill query itself — it
    // doesn't take any long-held locks, so this should be instant.
    await prisma.$executeRawUnsafe('SET statement_timeout = 30000');
    const blockers = await prisma.$queryRawUnsafe(`
      SELECT a.pid, left(a.query, 120) AS query
      FROM pg_stat_activity a
      JOIN pg_locks l ON l.pid = a.pid
      WHERE l.relation::regclass::text IN ('methodology_tests', 'test_action_steps', 'action_definitions')
        AND a.state = 'idle in transaction'
        AND a.pid != pg_backend_pid()
    `);
    if (!Array.isArray(blockers) || blockers.length === 0) {
      console.error('[db-push] no idle-in-tx blockers found; the lock timeout came from somewhere else');
      return 0;
    }
    for (const b of blockers) {
      console.error(`[db-push] terminating leaked session pid=${b.pid}: ${b.query}`);
      await prisma.$queryRawUnsafe(`SELECT pg_terminate_backend(${b.pid})`);
    }
    return blockers.length;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Belt-and-braces SQL safety net. Some schema changes (notably new
 * non-nullable columns + cross-table join models) have intermittently
 * failed to land via `prisma db push --accept-data-loss` in production,
 * and the runtime errors don't surface until an auditor opens the tab
 * that uses the new column. Each statement here is idempotent
 * (CREATE TABLE / ADD COLUMN IF NOT EXISTS), so re-running on every
 * deploy is safe and cheap. Add to this list when a future schema
 * change shows the same drift symptom; never modify or remove existing
 * statements (that's what `prisma db push` is for).
 */
/**
 * Run one safety-net statement with its own try/catch + timing log.
 * Each statement is independent so a transient failure on one (e.g.
 * a lock timeout, a Postgres parser quirk) can't take out the rest —
 * the previous "all in one try block" structure meant a single early
 * failure left every later statement unrun, which is why
 * methodology_tool_slug_remaps and methodology_industry_id were
 * intermittently missing on production even though the script
 * supposedly handled them.
 */
async function safetyNetStep(prisma, label, sql) {
  const t0 = Date.now();
  try {
    await prisma.$executeRawUnsafe(sql);
    console.error(`[db-push] ✓ ${label} (${Date.now() - t0}ms)`);
    return { label, ok: true };
  } catch (err) {
    console.error(`[db-push] ✗ ${label} (${Date.now() - t0}ms): ${err?.message || err}`);
    return { label, ok: false, error: err?.message || String(err) };
  }
}

async function applySchemaSafetyNet() {
  const prisma = new PrismaClient();
  const results = [];
  try {
    console.error('[db-push] applying schema safety net…');

    // 1. AuditDocumentTabAllocation join table — added on commit
    //    1469f9d. Without it, every per-tab Documents fetch 500s.
    results.push(await safetyNetStep(prisma, 'audit_document_tab_allocations table', `
      CREATE TABLE IF NOT EXISTS audit_document_tab_allocations (
        document_id      text        NOT NULL REFERENCES audit_documents(id) ON DELETE CASCADE,
        tab              text        NOT NULL,
        allocated_at     timestamptz NOT NULL DEFAULT now(),
        allocated_by_id  text        REFERENCES users(id) ON DELETE SET NULL,
        PRIMARY KEY (document_id, tab)
      )
    `));
    results.push(await safetyNetStep(prisma, 'audit_document_tab_allocations.tab idx', `
      CREATE INDEX IF NOT EXISTS audit_document_tab_allocations_tab_idx
        ON audit_document_tab_allocations(tab)
    `));
    results.push(await safetyNetStep(prisma, 'audit_document_tab_allocations.allocated_by_id idx', `
      CREATE INDEX IF NOT EXISTS audit_document_tab_allocations_allocated_by_idx
        ON audit_document_tab_allocations(allocated_by_id)
    `));

    // 2. AuditDocument.documentTypeAiSuggested column — added on
    //    commit ca3fc09. Selected by every AuditDocument.findMany.
    results.push(await safetyNetStep(prisma, 'audit_documents.document_type_ai_suggested column', `
      ALTER TABLE audit_documents
        ADD COLUMN IF NOT EXISTS document_type_ai_suggested boolean NOT NULL DEFAULT false
    `));

    // 3. Firm.methodologyToolSlugRemaps — per-firm tool slug overrides
    //    surfaced after a Methodology Admin deletes / renames a
    //    tool-wired question. Empty array is a sensible default.
    results.push(await safetyNetStep(prisma, 'firms.methodology_tool_slug_remaps column', `
      ALTER TABLE firms
        ADD COLUMN IF NOT EXISTS methodology_tool_slug_remaps jsonb NOT NULL DEFAULT '[]'::jsonb
    `));

    // 4. AuditEngagement.methodologyIndustryId — added on commit
    //    ab4865c (industry dropdown on the Opening tab). Without it,
    //    EVERY Prisma findUnique on audit_engagements throws because
    //    the implicit SELECT references methodology_industry_id;
    //    surfaces as 500s on Independence submit, the engagement
    //    loader, and anywhere the engagement is read with an include.
    results.push(await safetyNetStep(prisma, 'audit_engagements.methodology_industry_id column', `
      ALTER TABLE audit_engagements
        ADD COLUMN IF NOT EXISTS methodology_industry_id text
    `));
    results.push(await safetyNetStep(prisma, 'audit_engagements.methodology_industry_id idx', `
      CREATE INDEX IF NOT EXISTS audit_engagements_methodology_industry_id_idx
        ON audit_engagements(methodology_industry_id)
    `));
    results.push(await safetyNetStep(prisma, 'audit_engagements.methodology_industry_id FK', `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'audit_engagements_methodology_industry_id_fkey'
        ) THEN
          ALTER TABLE audit_engagements
            ADD CONSTRAINT audit_engagements_methodology_industry_id_fkey
            FOREIGN KEY (methodology_industry_id)
            REFERENCES methodology_industries(id)
            ON DELETE SET NULL;
        END IF;
      END $$
    `));

    // 5. AuditRMMRow.mergedGroupId — RMM row grouping. Rows sharing
    //    the same UUID render as one expandable group; null = standalone.
    //    Added by the RMM merge / unmerge feature; every Prisma read
    //    on audit_rmm_rows SELECTs it implicitly.
    results.push(await safetyNetStep(prisma, 'audit_rmm_rows.merged_group_id column', `
      ALTER TABLE audit_rmm_rows
        ADD COLUMN IF NOT EXISTS merged_group_id text
    `));
    results.push(await safetyNetStep(prisma, 'audit_rmm_rows.merged_group_id idx', `
      CREATE INDEX IF NOT EXISTS audit_rmm_rows_merged_group_id_idx
        ON audit_rmm_rows(merged_group_id)
    `));

    // 6. AuditEngagement.pendingAuditTypeChange + companions — added
    //    by the tile-change RI-approval flow. Every Prisma read on
    //    audit_engagements selects these implicitly, so missing them
    //    breaks Independence submit, the engagement loader, etc.
    results.push(await safetyNetStep(prisma, 'audit_engagements.pending_audit_type_change column', `
      ALTER TABLE audit_engagements
        ADD COLUMN IF NOT EXISTS pending_audit_type_change text
    `));
    results.push(await safetyNetStep(prisma, 'audit_engagements.pending_change_requested_by_id column', `
      ALTER TABLE audit_engagements
        ADD COLUMN IF NOT EXISTS pending_change_requested_by_id text
    `));
    results.push(await safetyNetStep(prisma, 'audit_engagements.pending_change_requested_at column', `
      ALTER TABLE audit_engagements
        ADD COLUMN IF NOT EXISTS pending_change_requested_at timestamptz
    `));
    results.push(await safetyNetStep(prisma, 'audit_engagements.pending_change_approval_token column', `
      ALTER TABLE audit_engagements
        ADD COLUMN IF NOT EXISTS pending_change_approval_token text
    `));
    results.push(await safetyNetStep(prisma, 'audit_engagements.pending_change_approval_token unique idx', `
      CREATE UNIQUE INDEX IF NOT EXISTS audit_engagements_pending_change_approval_token_key
        ON audit_engagements(pending_change_approval_token)
        WHERE pending_change_approval_token IS NOT NULL
    `));
    results.push(await safetyNetStep(prisma, 'audit_engagements.pending_change_approved_at column', `
      ALTER TABLE audit_engagements
        ADD COLUMN IF NOT EXISTS pending_change_approved_at timestamptz
    `));

    // 7. PortalMessage billing-attribution columns. Denormalised so
    //    the Super Admin Messaging Usage tab can GROUP BY firm /
    //    engagement without JOINing through clients on every roll-up.
    results.push(await safetyNetStep(prisma, 'portal_messages.firm_id column', `
      ALTER TABLE portal_messages
        ADD COLUMN IF NOT EXISTS firm_id text
    `));
    results.push(await safetyNetStep(prisma, 'portal_messages.audit_engagement_id column', `
      ALTER TABLE portal_messages
        ADD COLUMN IF NOT EXISTS audit_engagement_id text
    `));
    results.push(await safetyNetStep(prisma, 'portal_messages.billable_units column', `
      ALTER TABLE portal_messages
        ADD COLUMN IF NOT EXISTS billable_units integer NOT NULL DEFAULT 1
    `));
    results.push(await safetyNetStep(prisma, 'portal_messages.firm_id_created_at idx', `
      CREATE INDEX IF NOT EXISTS portal_messages_firm_id_created_at_idx
        ON portal_messages(firm_id, created_at)
    `));
    results.push(await safetyNetStep(prisma, 'portal_messages.audit_engagement_id idx', `
      CREATE INDEX IF NOT EXISTS portal_messages_audit_engagement_id_channel_created_idx
        ON portal_messages(audit_engagement_id, channel, created_at)
    `));

    const ok = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok);
    if (failed.length === 0) {
      console.error(`[db-push] safety-net complete — ${ok}/${results.length} statements applied.`);
    } else {
      console.error(`[db-push] safety-net partially applied — ${ok}/${results.length} OK, ${failed.length} failed:`);
      for (const f of failed) console.error(`[db-push]   ✗ ${f.label}: ${f.error}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

/** Run the safety net unconditionally so the must-have columns /
 *  tables get applied even when the surrounding `prisma db push` is
 *  erroring on something unrelated. Wrapped in its own try/catch so a
 *  safety-net failure can't mask the real underlying push error in
 *  the build log. */
async function applySchemaSafetyNetSafely(label) {
  try {
    await applySchemaSafetyNet();
  } catch (err) {
    console.error(`[db-push] safety-net (${label}) errored:`, err?.message || err);
  }
}

/**
 * Pre-push hygiene: drop indexes whose definitions don't match what
 * Prisma's `@unique` will create, so the subsequent `db push` doesn't
 * collide on a duplicate name.
 *
 * The three `client_portal_users_*_key` indexes below were created as
 * PARTIAL unique indexes (`CREATE UNIQUE INDEX ... WHERE col IS NOT
 * NULL`) by the early `scripts/sql/portal-*.sql` migrations. Prisma's
 * `@unique` annotation produces a NON-partial unique index. The two
 * are functionally equivalent on a nullable column — Postgres treats
 * NULLs as distinct in a regular unique index — but Prisma compares
 * by exact definition and tries to recreate, hitting
 * "relation … already exists" on every deploy.
 *
 * Dropping the partial indexes here is safe: data is untouched, and
 * the immediately-following `prisma db push` recreates each one with
 * the same name as a plain unique. Run as best-effort: a missing
 * index is fine, and any other error is logged but doesn't abort the
 * push (the push itself will surface real schema problems).
 */
async function dropConflictingPartialIndexes() {
  const prisma = new PrismaClient();
  const indexes = [
    'client_portal_users_telegram_link_code_key',
    'client_portal_users_wechat_link_code_key',
    'client_portal_users_wecom_bind_code_key',
  ];
  try {
    for (const name of indexes) {
      try {
        // Inspect first so we only drop the partial variant — a non-
        // partial one is already what Prisma wants and dropping it
        // would be churn (and a brief window without the uniqueness
        // guarantee).
        const rows = await prisma.$queryRawUnsafe(
          `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = '${name}'`
        );
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const def = String(rows[0]?.indexdef || '');
        if (!/\bWHERE\b/i.test(def)) {
          // Already a plain unique — nothing to do.
          continue;
        }
        console.error(`[db-push] dropping partial unique index ${name} so Prisma can recreate it as plain unique`);
        await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS public.${name}`);
      } catch (err) {
        console.error(`[db-push] could not inspect/drop ${name}:`, err?.message || err);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  // Drop conflicting partial unique indexes before db push tries to
  // recreate them. See dropConflictingPartialIndexes() docstring.
  try {
    await dropConflictingPartialIndexes();
  } catch (err) {
    console.error('[db-push] pre-push hygiene failed (continuing):', err?.message || err);
  }

  console.error('[db-push] applying schema with prisma db push…');
  const first = runPrismaPush();
  if (first.code === 0) {
    await applySchemaSafetyNet();
    return;
  }

  // Even on failure, attempt the safety net before deciding whether
  // to surface or retry. Adding columns / creating join tables that
  // are also defined in schema.prisma can unblock a push that's
  // otherwise stuck on a transient issue, and it guarantees the UI
  // doesn't 500 against a half-applied schema.
  await applySchemaSafetyNetSafely('after first failure');

  if (!looksLikeLockTimeout(first.stderr + first.stdout)) {
    console.error(`[db-push] failed (exit ${first.code}); not a lock-timeout, surfacing failure.`);
    process.exit(first.code || 1);
  }

  console.error('[db-push] lock timeout detected; checking for leaked idle-in-tx sessions…');
  let killed = 0;
  try {
    killed = await killIdleBlockers();
  } catch (err) {
    console.error('[db-push] failed to inspect/terminate blockers:', err?.message || err);
    process.exit(1);
  }

  if (killed === 0) {
    console.error('[db-push] no blockers to terminate; the lock contention is from active queries — surfacing original failure.');
    process.exit(first.code || 1);
  }

  console.error(`[db-push] terminated ${killed} blocker(s); retrying push…`);
  const second = runPrismaPush();
  if (second.code !== 0) {
    console.error(`[db-push] retry failed (exit ${second.code}).`);
    process.exit(second.code || 1);
  }
  console.error('[db-push] retry succeeded.');
  await applySchemaSafetyNet();
}

main().catch(err => {
  console.error('[db-push] unexpected error:', err);
  process.exit(1);
});
