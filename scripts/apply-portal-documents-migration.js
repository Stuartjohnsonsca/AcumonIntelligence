// One-off runner: applies prisma/migrations/20260419_portal_documents/migration.sql
// directly against the target DB (resolved from DIRECT_URL / DATABASE_URL).
//
// Mirrors scripts/apply-accruals-migration.js — the target database
// has no `_prisma_migrations` tracking table so `prisma migrate deploy`
// would try to replay every committed migration and clash. This
// script runs ONLY the portal-documents migration inside a single
// transaction.
//
// Usage:  node scripts/apply-portal-documents-migration.js
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const sqlPath = path.join(__dirname, '..', 'prisma', 'migrations', '20260419_portal_documents', 'migration.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const prisma = new PrismaClient();
  try {
    // Strip SQL line comments then split on `;` so each statement
    // runs through $executeRawUnsafe separately. This migration uses
    // DO $$ BEGIN … EXCEPTION … END $$ blocks for idempotent foreign
    // keys; we DON'T split those at the internal semicolons — the
    // regex below only splits on semicolons at the end of a line
    // (i.e. top-level statement boundaries).
    const stripped = sql
      .split(/\r?\n/)
      .map(l => l.replace(/--.*$/, ''))
      .join('\n');

    // Split on `;` followed by newline or EOF. This handles the
    // `DO $$ … END $$` blocks correctly because the `$$` literal
    // form in PostgreSQL doesn't contain line-terminated semicolons
    // inside it in this file.
    const statements = stripped
      .split(/;\s*(?:\n|$)/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    console.log(`Applying ${statements.length} SQL statements from 20260419_portal_documents/migration.sql`);

    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        const preview = stmt.split('\n')[0].slice(0, 80);
        console.log(`  [${i + 1}/${statements.length}] ${preview}...`);
        await tx.$executeRawUnsafe(stmt);
      }
    }, { timeout: 120_000 });

    console.log('Migration applied successfully.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => { console.error('Migration failed:', err); process.exit(1); });
