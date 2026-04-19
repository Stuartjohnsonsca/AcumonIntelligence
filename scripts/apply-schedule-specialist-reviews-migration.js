// One-off runner for prisma/migrations/20260420_schedule_specialist_reviews/migration.sql
// Mirrors scripts/apply-portal-documents-migration.js. Usage:
//   node scripts/apply-schedule-specialist-reviews-migration.js
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const sqlPath = path.join(__dirname, '..', 'prisma', 'migrations', '20260420_schedule_specialist_reviews', 'migration.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const prisma = new PrismaClient();
  try {
    const stripped = sql
      .split(/\r?\n/)
      .map(l => l.replace(/--.*$/, ''))
      .join('\n');
    const statements = stripped
      .split(/;\s*(?:\n|$)/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    console.log(`Applying ${statements.length} SQL statements from 20260420_schedule_specialist_reviews/migration.sql`);
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
