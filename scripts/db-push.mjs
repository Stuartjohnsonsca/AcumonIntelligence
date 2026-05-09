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
async function applySchemaSafetyNet() {
  const prisma = new PrismaClient();
  try {
    // 1. AuditDocumentTabAllocation join table — added on commit
    //    1469f9d. Without it, every per-tab Documents fetch 500s.
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS audit_document_tab_allocations (
        document_id      text        NOT NULL REFERENCES audit_documents(id) ON DELETE CASCADE,
        tab              text        NOT NULL,
        allocated_at     timestamptz NOT NULL DEFAULT now(),
        allocated_by_id  text        REFERENCES users(id) ON DELETE SET NULL,
        PRIMARY KEY (document_id, tab)
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS audit_document_tab_allocations_tab_idx
        ON audit_document_tab_allocations(tab)
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS audit_document_tab_allocations_allocated_by_idx
        ON audit_document_tab_allocations(allocated_by_id)
    `);

    // 2. AuditDocument.documentTypeAiSuggested column — added on
    //    commit ca3fc09. Selected by every AuditDocument.findMany.
    await prisma.$executeRawUnsafe(`
      ALTER TABLE audit_documents
        ADD COLUMN IF NOT EXISTS document_type_ai_suggested boolean NOT NULL DEFAULT false
    `);

    // 3. Firm.methodologyToolSlugRemaps — per-firm tool slug overrides
    //    surfaced after a Methodology Admin deletes / renames a
    //    tool-wired question. Empty array is a sensible default.
    await prisma.$executeRawUnsafe(`
      ALTER TABLE firms
        ADD COLUMN IF NOT EXISTS methodology_tool_slug_remaps jsonb NOT NULL DEFAULT '[]'::jsonb
    `);

    console.error('[db-push] safety-net SQL applied.');
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

async function main() {
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
