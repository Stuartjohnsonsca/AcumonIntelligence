// One-off runner: applies prisma/migrations/20260417_accruals_pipeline/migration.sql
// directly against the target DB (resolved from DIRECT_URL / DATABASE_URL).
//
// Used because the target database has no _prisma_migrations tracking
// table — `prisma migrate deploy` would attempt to replay all 15
// committed migrations, which is unsafe (the schema is already there
// from earlier manual applications). This script runs ONLY the new
// accruals-pipeline migration inside a single transaction.
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const sqlPath = path.join(__dirname, '..', 'prisma', 'migrations', '20260417_accruals_pipeline', 'migration.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const prisma = new PrismaClient();
  try {
    // Split the migration into top-level statements and run them
    // one-by-one so we get clear errors per statement if anything
    // collides. Using $executeRawUnsafe rather than a single multi-
    // statement $executeRaw so PostgreSQL parses each separately.
    // Strip SQL line comments first, then split on semicolon-terminated
    // statements. An earlier version of this splitter filtered out any
    // block that began with `--`, which silently dropped the CREATE
    // TABLE and ALTER TABLE ADD COLUMN blocks (each of which starts
    // with a `-- ─── N. ─` header in the migration file).
    const stripped = sql
      .split(/\r?\n/)
      .map(l => l.replace(/--.*$/, ''))
      .join('\n');
    const statements = stripped
      .split(/;\s*(?:\n|$)/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    console.log(`Applying ${statements.length} SQL statements from migration.sql`);

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
