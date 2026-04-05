/**
 * Set isIngest = true on "Request Bank Statements" and "Extract Bank Statement Data" tests.
 * These are data collection/prep tests, not auditable substantive tests.
 *
 * Usage: node scripts/set-ingest-flags.mjs
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const ingestNames = [
    'Request Bank Statements',
    'Extract Bank Statement Data',
  ];

  for (const name of ingestNames) {
    const result = await prisma.methodologyTest.updateMany({
      where: { name, isIngest: false },
      data: { isIngest: true },
    });
    console.log(`${name}: updated ${result.count} record(s)`);
  }

  // Also check test bank entries (JSON-based tests)
  const bankEntries = await prisma.methodologyTestBank.findMany({
    where: {
      OR: ingestNames.map(n => ({ name: { contains: n } })),
    },
  });

  for (const entry of bankEntries) {
    const tests = (entry.tests || []);
    let changed = false;
    for (const test of tests) {
      if (ingestNames.some(n => test.description?.includes(n) || test.name?.includes(n))) {
        if (!test.isIngest) {
          test.isIngest = true;
          changed = true;
        }
      }
    }
    if (changed) {
      await prisma.methodologyTestBank.update({
        where: { id: entry.id },
        data: { tests },
      });
      console.log(`Test bank "${entry.name}": updated isIngest flags`);
    }
  }
}

main()
  .then(() => { console.log('Done'); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });
