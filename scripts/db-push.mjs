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

async function main() {
  console.error('[db-push] applying schema with prisma db push…');
  const first = runPrismaPush();
  if (first.code === 0) return;

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
}

main().catch(err => {
  console.error('[db-push] unexpected error:', err);
  process.exit(1);
});
