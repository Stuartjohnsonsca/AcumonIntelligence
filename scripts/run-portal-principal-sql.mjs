#!/usr/bin/env node
/**
 * Runs scripts/sql/portal-principal.sql against the DB the app is
 * connected to (DIRECT_URL preferred — DDL shouldn't go through pgbouncer).
 *
 * One-off: safe to re-run because every statement is idempotent.
 */

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Accept a CLI arg to run any SQL file in scripts/sql/; defaults to
// portal-principal.sql. Usage:
//   node scripts/run-portal-principal-sql.mjs                    # default
//   node scripts/run-portal-principal-sql.mjs independence-gate  # by basename
//   node scripts/run-portal-principal-sql.mjs ./scripts/sql/foo.sql  # by path
const argPath = process.argv[2];
const SQL_PATH = argPath
  ? (argPath.includes('/') || argPath.includes('\\') || argPath.endsWith('.sql'))
    ? resolve(argPath)
    : resolve(__dirname, 'sql', argPath + '.sql')
  : resolve(__dirname, 'sql', 'portal-principal.sql');

console.log(`Running SQL: ${SQL_PATH}`);

const raw = readFileSync(SQL_PATH, 'utf8');

// Split on semicolons that are NOT inside DO $$ ... $$ blocks AND NOT
// inside a `-- line comment`. The earlier version ignored line
// comments so a `;` inside e.g. `-- Idempotent; safe to re-run` got
// treated as a statement terminator, producing a garbled chunk that
// PostgreSQL rejected with "syntax error at or near 'safe'".
function splitStatements(sql) {
  const out = [];
  let cur = '';
  let inDollar = false;
  let inLineComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    // Newline always terminates a line comment.
    if (inLineComment) {
      cur += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    // Enter a line comment on `--` outside dollar-quote.
    if (!inDollar && ch === '-' && sql[i + 1] === '-') {
      inLineComment = true;
      cur += '--';
      i++;
      continue;
    }
    // Dollar-quote toggle.
    if (ch === '$' && sql[i + 1] === '$') {
      inDollar = !inDollar;
      cur += '$$';
      i++;
      continue;
    }
    // Statement terminator — only outside dollar-quote and not in a comment.
    if (ch === ';' && !inDollar) {
      if (cur.trim().length > 0) out.push(cur.trim() + ';');
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim().length > 0) out.push(cur.trim());
  // Filter pure-comment chunks (strip line + block comments, then whitespace).
  return out.filter(s => s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim().length > 0);
}

const statements = splitStatements(raw);

console.log(`Parsed ${statements.length} statement(s) from portal-principal.sql`);

// Prefer DIRECT_URL (bypasses pgbouncer, cleanest for DDL) but if it's
// unreachable from this network — common for Supabase direct 5432 —
// fall back to DATABASE_URL via the pooler. Our DDL statements are all
// auto-commit ALTER / CREATE, which pgbouncer transaction mode handles
// fine; DO $$ blocks are also single-statement from pgbouncer's POV.
const poolerUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;
const dbUrl = directUrl || poolerUrl;
if (!dbUrl) {
  console.error('No DATABASE_URL or DIRECT_URL in env — cannot run.');
  process.exit(1);
}

// Strip ?pgbouncer=true from the URL when using the pooler for DDL —
// prepared statements are what pgbouncer rejects, and Prisma will
// try to use them by default. Add &connection_limit=1 to force a
// clean session.
let finalUrl = dbUrl;
if (finalUrl.includes('pooler.supabase.com')) {
  const u = new URL(finalUrl);
  u.searchParams.set('pgbouncer', 'true');
  u.searchParams.set('connection_limit', '1');
  finalUrl = u.toString();
  console.log('Using pooler connection (pgbouncer=true, limit=1)');
} else {
  console.log('Using direct connection');
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalUrl } },
  log: ['error', 'warn'],
});

// Sanity check — confirm we can reach the DB at all before running DDL.
try {
  await prisma.$queryRawUnsafe('SELECT 1');
  console.log('DB connection: OK');
} catch (err) {
  console.error('DB connection FAILED:', err?.message || err);
  console.error('Full error:', JSON.stringify(err, Object.getOwnPropertyNames(err || {}), 2));
  process.exit(1);
}

let ok = 0;
let errors = 0;
try {
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const summary = stmt.slice(0, 80).replace(/\s+/g, ' ');
    try {
      await prisma.$executeRawUnsafe(stmt);
      console.log(`  [${i + 1}/${statements.length}] OK   — ${summary}…`);
      ok++;
    } catch (err) {
      errors++;
      console.error(`  [${i + 1}/${statements.length}] FAIL — ${summary}…`);
      console.error(`       message: ${err?.message || '(empty)'}`);
      console.error(`       code:    ${err?.code || '(none)'}`);
      console.error(`       meta:    ${JSON.stringify(err?.meta)}`);
      if (errors === 1) {
        // First failure gets the full error dump so we can diagnose.
        console.error(`       FULL: ${JSON.stringify(err, Object.getOwnPropertyNames(err || {}), 2).slice(0, 1500)}`);
      }
    }
  }
} finally {
  await prisma.$disconnect();
}

console.log(`\nDone. ${ok} succeeded, ${errors} failed.`);
process.exit(errors > 0 ? 1 : 0);
