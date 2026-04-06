/**
 * Update Large & Unusual test: change wait step from 'sampling' to 'review_flagged'
 * so the UI shows ranked results instead of the sampling calculator.
 *
 * Usage: npx dotenv-cli -e .env.prod -- node scripts/fix-large-unusual-review-step.mjs
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const tests = await prisma.methodologyTest.findMany({ where: { name: { contains: 'Large' } } });
  for (const t of tests) {
    const flow = t.flow;
    let changed = false;
    for (const node of flow.nodes) {
      if (node.data?.label?.includes('Review') && node.data?.waitFor === 'sampling') {
        node.data.waitFor = 'review_flagged';
        node.data.triggerType = 'review_flagged';
        changed = true;
      }
    }
    if (changed) {
      await prisma.methodologyTest.update({ where: { id: t.id }, data: { flow } });
      console.log(`Updated "${t.name}" — wait step now 'review_flagged'`);
    }
  }
  console.log('Done');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
