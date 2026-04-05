/**
 * Set isIngest = true on "Request Bank Statements" and "Extract Bank Statement Data" tests.
 * These are data collection/prep tests, not auditable substantive tests.
 *
 * Tests live in two places:
 * 1. MethodologyTest (standalone tests with `name` field)
 * 2. MethodologyTestBank.tests (JSON array with `description` field)
 *
 * Usage: npx dotenv-cli -e .env.prod -- node scripts/set-ingest-flags.mjs
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const INGEST_PATTERNS = [
  'Request Bank Statements',
  'Extract Bank Statement Data',
];

function matchesIngest(text) {
  if (!text) return false;
  return INGEST_PATTERNS.some(p => text.includes(p));
}

async function main() {
  // 1. MethodologyTest (standalone)
  const standaloneTests = await prisma.methodologyTest.findMany({
    where: { isIngest: false },
  });
  let standaloneCount = 0;
  for (const t of standaloneTests) {
    if (matchesIngest(t.name) || matchesIngest(t.description)) {
      await prisma.methodologyTest.update({
        where: { id: t.id },
        data: { isIngest: true },
      });
      console.log(`  MethodologyTest "${t.name}" → isIngest = true`);
      standaloneCount++;
    }
  }
  console.log(`MethodologyTest: updated ${standaloneCount} record(s)`);

  // 2. MethodologyTestBank (JSON tests array)
  const allBanks = await prisma.methodologyTestBank.findMany();
  let bankCount = 0;
  for (const bank of allBanks) {
    const tests = Array.isArray(bank.tests) ? bank.tests : [];
    let changed = false;
    for (const test of tests) {
      if ((matchesIngest(test.description) || matchesIngest(test.name)) && !test.isIngest) {
        test.isIngest = true;
        changed = true;
        console.log(`  TestBank [${bank.fsLine}] "${test.description}" → isIngest = true`);
      }
    }
    if (changed) {
      await prisma.methodologyTestBank.update({
        where: { id: bank.id },
        data: { tests },
      });
      bankCount++;
    }
  }
  console.log(`MethodologyTestBank: updated ${bankCount} entry/entries`);
}

main()
  .then(() => { console.log('Done'); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });
