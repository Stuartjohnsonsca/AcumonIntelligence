/**
 * Seed a Payroll Substantive Test in the Test Bank.
 * This creates a MethodologyTest with outputFormat 'payroll_workpaper'
 * and allocates it to the Wages & Salaries FS line.
 *
 * Usage: npx dotenv-cli -e .env.prod -- node scripts/seed-payroll-test.mjs
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const firms = await prisma.firm.findMany({ select: { id: true, name: true } });

  for (const firm of firms) {
    // Check if payroll test already exists
    const existing = await prisma.methodologyTest.findFirst({
      where: { firmId: firm.id, name: { contains: 'Payroll Substantive' } },
    });

    if (existing) {
      console.log(`  Payroll test already exists for "${firm.name}" — updating outputFormat`);
      await prisma.methodologyTest.update({
        where: { id: existing.id },
        data: { outputFormat: 'payroll_workpaper', category: 'Other' },
      });
      continue;
    }

    // Create the payroll test
    const test = await prisma.methodologyTest.create({
      data: {
        firmId: firm.id,
        name: '(*) Payroll Substantive Test',
        description: 'Multi-phase payroll test: Lead schedule, Payroll reconciliation (12-month grid), HMRC reconciliation, Pensions reconciliation, Joiners & Leavers testing with termination checks.',
        testTypeCode: 'human_action',
        assertions: ['Completeness', 'Occurrence & Accuracy', 'Classification', 'Cut Off'],
        framework: 'ALL',
        significantRisk: false,
        category: 'Other',
        outputFormat: 'payroll_workpaper',
        isIngest: false,
      },
    });
    console.log(`  Created Payroll Substantive Test for "${firm.name}" (id: ${test.id})`);

    // Try to allocate to Wages & Salaries FS line
    const wagesLine = await prisma.methodologyFsLine.findFirst({
      where: {
        firmId: firm.id,
        OR: [
          { name: { contains: 'Wage' } },
          { name: { contains: 'Salary' } },
          { name: { contains: 'Salaries' } },
          { name: { contains: 'Staff Cost' } },
          { name: { contains: 'Payroll' } },
          { name: { contains: 'Employee' } },
        ],
      },
    });

    if (wagesLine) {
      // Find default industry
      const industry = await prisma.methodologyIndustry.findFirst({
        where: { firmId: firm.id, isDefault: true },
      });
      if (industry) {
        try {
          await prisma.methodologyTestAllocation.create({
            data: { testId: test.id, fsLineId: wagesLine.id, industryId: industry.id },
          });
          console.log(`  Allocated to "${wagesLine.name}" (${industry.name})`);
        } catch { /* duplicate constraint */ }
      }
    } else {
      console.log(`  No wages FS line found — test created but not allocated to an FS line`);
    }
  }
}

main()
  .then(() => { console.log('Done'); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });
