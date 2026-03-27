/**
 * One-time script: for all audit staff with resource settings,
 * enable Preparer/Reviewer/RI roles and set overtime to 20h.
 *
 * Run with: node scripts/update-audit-staff-settings.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find all audit staff who have a resource setting
  const auditStaff = await prisma.user.findMany({
    where: { isAuditStaff: true, resourceStaffSetting: { isNot: null } },
    select: { id: true, name: true },
  });

  console.log(`Updating ${auditStaff.length} audit staff members...`);

  for (const user of auditStaff) {
    await prisma.resourceStaffSetting.update({
      where: { userId: user.id },
      data: {
        preparerJobLimit: 99,
        reviewerJobLimit: 99,
        riJobLimit: 99,
        isRI: true,
        overtimeHrs: 20,
      },
    });
    console.log(`  ✓ ${user.name}`);
  }

  console.log('Done.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
