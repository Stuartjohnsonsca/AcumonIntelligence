/**
 * Migrate significantRisk boolean to category string on MethodologyTest.
 * Also seed default testCategories in MethodologyRiskTable for all firms.
 *
 * Usage: npx dotenv-cli -e .env.prod -- node scripts/migrate-test-categories.mjs
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const DEFAULT_CATEGORIES = [
  'Significant Risk',
  'Area of Focus',
  'Other',
  'Analytical Review',
  'Mandatory',
];

async function main() {
  // 1. Migrate significantRisk → category
  const sigRiskTests = await prisma.methodologyTest.updateMany({
    where: { significantRisk: true, category: 'Other' },
    data: { category: 'Significant Risk' },
  });
  console.log(`Migrated ${sigRiskTests.count} significant risk tests → category = "Significant Risk"`);

  // 2. Seed testCategories in MethodologyRiskTable for all firms
  const firms = await prisma.firm.findMany({ select: { id: true, name: true } });
  for (const firm of firms) {
    const existing = await prisma.methodologyRiskTable.findUnique({
      where: { firmId_tableType: { firmId: firm.id, tableType: 'testCategories' } },
    });
    if (!existing) {
      await prisma.methodologyRiskTable.create({
        data: {
          firmId: firm.id,
          tableType: 'testCategories',
          data: { categories: DEFAULT_CATEGORIES },
        },
      });
      console.log(`  Seeded testCategories for firm "${firm.name}"`);
    } else {
      console.log(`  testCategories already exists for firm "${firm.name}" — skipping`);
    }
  }

  // 3. Seed AR confidence factor for all firms
  for (const firm of firms) {
    const existing = await prisma.methodologyRiskTable.findUnique({
      where: { firmId_tableType: { firmId: firm.id, tableType: 'arConfidenceFactor' } },
    });
    if (!existing) {
      await prisma.methodologyRiskTable.create({
        data: {
          firmId: firm.id,
          tableType: 'arConfidenceFactor',
          data: { confidenceFactor: 1.0 },
        },
      });
      console.log(`  Seeded arConfidenceFactor for firm "${firm.name}"`);
    } else {
      console.log(`  arConfidenceFactor already exists for firm "${firm.name}" — skipping`);
    }
  }
}

main()
  .then(() => { console.log('Done'); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });
