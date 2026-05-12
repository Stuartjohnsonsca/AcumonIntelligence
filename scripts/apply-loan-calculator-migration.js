// One-off runner: applies prisma/migrations/manual/2026-05-12-loan-calculator.sql
// against the target DB via the Supabase pooler URL (DATABASE_URL).
//
// Idempotent (CREATE TABLE / CREATE INDEX IF NOT EXISTS) so safe to
// re-run. Uses $executeRawUnsafe so each statement is parsed
// independently — clearer per-statement errors than a single multi-
// statement $executeRaw.
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const sqlPath = path.join(__dirname, '..', 'prisma', 'migrations', 'manual', '2026-05-12-loan-calculator.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Strip line comments, then split on semicolon-terminated statements.
  const stripped = sql
    .split(/\r?\n/)
    .map(l => l.replace(/--.*$/, ''))
    .join('\n');
  const statements = stripped
    .split(/;\s*(?:\n|$)/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  console.log(`Applying ${statements.length} SQL statements from 2026-05-12-loan-calculator.sql`);

  const prisma = new PrismaClient();
  try {
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      const preview = stmt.split('\n')[0].slice(0, 80);
      console.log(`  [${i + 1}/${statements.length}] ${preview}...`);
      await prisma.$executeRawUnsafe(stmt);
    }
    console.log('Migration applied successfully.');

    // Verify the table exists.
    const rows = await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'audit_loan_calculators'`,
    );
    console.log('Verify:', rows);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => { console.error('Migration failed:', err); process.exit(1); });
