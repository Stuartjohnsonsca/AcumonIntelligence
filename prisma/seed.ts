import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create Johnsons firm
  const firm = await prisma.firm.upsert({
    where: { id: 'johnsons-firm-id-0000-000000000001' },
    update: {},
    create: {
      id: 'johnsons-firm-id-0000-000000000001',
      name: 'Johnsons Financial Management',
    },
  });
  console.log('Created firm:', firm.name);

  // Create Stuart Thomson super admin
  const passwordHash = await bcrypt.hash('Stuy901!', 12);
  const stuartExpiry = new Date();
  stuartExpiry.setDate(stuartExpiry.getDate() + 60);

  const stuart = await prisma.user.upsert({
    where: { email: 'stuart.thomson@johnsonsfinancial.co.uk' },
    update: {},
    create: {
      displayId: 'ST001',
      firmId: firm.id,
      name: 'Stuart Thomson',
      email: 'stuart.thomson@johnsonsfinancial.co.uk',
      passwordHash,
      twoFactorMethod: 'email',
      isSuperAdmin: true,
      isFirmAdmin: true,
      isPortfolioOwner: true,
      expiryDate: stuartExpiry,
    },
  });
  console.log('Created user:', stuart.name);

  // Seed products
  const products = [
    {
      name: 'Financial Data Extraction',
      category: 'Statutory Audit',
      urlPrefix: 'DateExtraction',
      expiryDays: 60,
      price1: 50,
      price5: 240,
      price10: 450,
      price20: 875,
    },
    {
      name: 'Document Summary',
      category: 'Statutory Audit',
      urlPrefix: 'DocSummary',
      expiryDays: 60,
      price1: 50,
      price5: 240,
      price10: 450,
      price20: 875,
    },
    {
      name: 'Portfolio Document Extraction',
      category: 'Statutory Audit',
      urlPrefix: 'PortfolioExtraction',
      expiryDays: 60,
      price1: 50,
      price5: 240,
      price10: 450,
      price20: 875,
    },
    {
      name: 'Financial Statements Checker',
      category: 'Statutory Audit',
      urlPrefix: 'FSChecker',
      expiryDays: 30,
      price1: 75,
      price5: 350,
      price10: 625,
      price20: 1000,
    },
    {
      name: 'Sample Calculator',
      category: 'Statutory Audit',
      urlPrefix: 'Sampling',
      expiryDays: 60,
      price1: 50,
      price5: 240,
      price10: 450,
      price20: 875,
    },
    {
      name: 'Agentic AI & Governance',
      category: 'Internal Audit',
      urlPrefix: 'Governance',
      expiryDays: 30,
      price1: 50,
      price5: 240,
      price10: 450,
      price20: 875,
    },
    {
      name: 'Cybersecurity Resilience',
      category: 'Internal Audit',
      urlPrefix: 'CyberResiliance',
      expiryDays: 30,
      price1: 50,
      price5: 240,
      price10: 450,
      price20: 875,
    },
    {
      name: 'Workforce & Talent Risk',
      category: 'Internal Audit',
      urlPrefix: 'TalentRisk',
      expiryDays: 30,
      price1: 50,
      price5: 240,
      price10: 450,
      price20: 875,
    },
    {
      name: 'ESG & Sustainability Reporting',
      category: 'Internal Audit',
      urlPrefix: 'ESGSustainability',
      expiryDays: 30,
      price1: 50,
      price5: 240,
      price10: 450,
      price20: 875,
    },
    {
      name: 'Diversity Assurance',
      category: 'Internal Audit',
      urlPrefix: 'Diversity',
      expiryDays: 30,
      price1: 50,
      price5: 240,
      price10: 450,
      price20: 875,
    },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { urlPrefix: product.urlPrefix },
      update: {},
      create: product,
    });
    console.log('Created product:', product.name);
  }

  // ─── Resource Planning: Dummy Staff ─────────────────────────────────

  const staffMembers = [
    { displayId: 'EC002', name: 'Edmund Cartwright', email: 'edmund.cartwright@johnsonsfinancial.co.uk', jobTitle: 'Partner' },
    { displayId: 'JB003', name: 'Jack Borg-Delaney', email: 'jack.borgdelaney@johnsonsfinancial.co.uk', jobTitle: 'Partner' },
    { displayId: 'MC004', name: 'Mandhu Chennupati', email: 'mandhu.chennupati@johnsonsfinancial.co.uk', jobTitle: 'Audit Manager' },
    { displayId: 'RW005', name: 'Rob Wilkes', email: 'rob.wilkes@johnsonsfinancial.co.uk', jobTitle: 'Audit Manager' },
    { displayId: 'SJ006', name: 'Sarah Jenkins', email: 'sarah.jenkins@johnsonsfinancial.co.uk', jobTitle: 'Audit Senior' },
    { displayId: 'DP007', name: 'Daniel Patel', email: 'daniel.patel@johnsonsfinancial.co.uk', jobTitle: 'Audit Semi-Senior' },
    { displayId: 'LH008', name: 'Lucy Henderson', email: 'lucy.henderson@johnsonsfinancial.co.uk', jobTitle: 'Audit Trainee' },
    { displayId: 'TO009', name: 'Tom O\'Brien', email: 'tom.obrien@johnsonsfinancial.co.uk', jobTitle: 'Audit Trainee' },
  ];

  const createdStaff: Record<string, string> = {};
  createdStaff[stuart.displayId] = stuart.id;

  for (const s of staffMembers) {
    const user = await prisma.user.upsert({
      where: { email: s.email },
      update: {},
      create: {
        displayId: s.displayId,
        firmId: firm.id,
        name: s.name,
        email: s.email,
        passwordHash,
        twoFactorMethod: 'email',
        jobTitle: s.jobTitle,
        expiryDate: stuartExpiry,
      },
    });
    createdStaff[s.displayId] = user.id;
    console.log('Created user:', user.name);
  }

  // Set Stuart as Resource Admin
  await prisma.user.update({
    where: { id: stuart.id },
    data: { isResourceAdmin: true },
  });

  // Resource staff settings
  const staffSettings = [
    { displayId: 'ST001', role: 'RI', limit: 30, isRI: true, capacity: 37.5 },
    { displayId: 'EC002', role: 'RI', limit: 30, isRI: true, capacity: 37.5 },
    { displayId: 'JB003', role: 'RI', limit: 30, isRI: true, capacity: 37.5 },
    { displayId: 'MC004', role: 'Reviewer', limit: 18, isRI: false, capacity: 37.5 },
    { displayId: 'RW005', role: 'Reviewer', limit: 18, isRI: false, capacity: 37.5 },
    { displayId: 'SJ006', role: 'Preparer', limit: 3, isRI: false, capacity: 37.5 },
    { displayId: 'DP007', role: 'Preparer', limit: 3, isRI: false, capacity: 37.5 },
    { displayId: 'LH008', role: 'Preparer', limit: 3, isRI: false, capacity: 37.5 },
    { displayId: 'TO009', role: 'Preparer', limit: 3, isRI: false, capacity: 37.5 },
  ];

  for (const ss of staffSettings) {
    const userId = createdStaff[ss.displayId];
    await prisma.resourceStaffSetting.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        firmId: firm.id,
        resourceRole: ss.role,
        concurrentJobLimit: ss.limit,
        isRI: ss.isRI,
        weeklyCapacityHrs: ss.capacity,
      },
    });
  }
  console.log('Created resource staff settings');

  // ─── Resource Planning: Dummy Clients & Jobs ──────────────────────

  const dummyClients = [
    { name: 'Acme Industries Ltd', sector: 'Manufacturing' },
    { name: 'Greenfield Holdings PLC', sector: 'Financial Services' },
    { name: 'Northern Healthcare Trust', sector: 'Healthcare' },
    { name: 'TechVault Solutions Ltd', sector: 'Technology' },
    { name: 'Riverside Construction Group', sector: 'Construction' },
    { name: 'Blue Horizon Energy PLC', sector: 'Energy' },
    { name: 'Sterling Legal Partners', sector: 'Legal' },
    { name: 'Oakwood Education Trust', sector: 'Education' },
    { name: 'Harbour Retail Group', sector: 'Retail' },
    { name: 'Pinnacle Public Services', sector: 'Public Sector' },
    { name: 'Meridian Charities', sector: 'Charities & Non-Profit' },
    { name: 'Atlas Financial Services', sector: 'Financial Services' },
    { name: 'Summit Manufacturing Co', sector: 'Manufacturing' },
    { name: 'Lighthouse Healthcare', sector: 'Healthcare' },
    { name: 'Quantum Tech Innovations', sector: 'Technology' },
  ];

  const createdClientIds: string[] = [];

  for (const c of dummyClients) {
    const client = await prisma.client.upsert({
      where: { id: `resource-client-${c.name.replace(/\s+/g, '-').toLowerCase().slice(0, 30)}` },
      update: {},
      create: {
        id: `resource-client-${c.name.replace(/\s+/g, '-').toLowerCase().slice(0, 30)}`,
        firmId: firm.id,
        clientName: c.name,
        sector: c.sector,
        contactFirstName: c.name.split(' ')[0],
        contactSurname: 'Contact',
        contactEmail: `contact@${c.name.split(' ')[0].toLowerCase()}.co.uk`,
      },
    });
    createdClientIds.push(client.id);
  }
  console.log('Created dummy clients');

  // Create ResourceJob entries
  const auditTypes = ['SME', 'PIE', 'SME_CONTROLS', 'PIE_CONTROLS', 'GROUP'];
  const now = new Date();

  for (let i = 0; i < createdClientIds.length; i++) {
    const periodEnd = new Date(now.getFullYear(), ((i * 2) % 12), 0); // Stagger period ends
    if (periodEnd < now) periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    const targetCompletion = new Date(periodEnd);
    targetCompletion.setMonth(targetCompletion.getMonth() + 3);

    await prisma.resourceJob.upsert({
      where: { id: `resource-job-${i + 1}` },
      update: {},
      create: {
        id: `resource-job-${i + 1}`,
        firmId: firm.id,
        clientId: createdClientIds[i],
        auditType: auditTypes[i % auditTypes.length],
        periodEnd,
        targetCompletion,
        budgetHoursRI: 10 + (i % 5) * 5,
        budgetHoursReviewer: 20 + (i % 4) * 10,
        budgetHoursPreparer: 40 + (i % 3) * 20,
      },
    });
  }
  console.log('Created resource jobs');

  // ─── Resource Planning: Dummy Engagements & Allocations ───────────

  // Create periods and engagements for the first few clients so we can allocate
  for (let i = 0; i < 8; i++) {
    const periodEnd = new Date(now.getFullYear(), ((i * 2) % 12), 0);
    if (periodEnd < now) periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    const periodStart = new Date(periodEnd);
    periodStart.setFullYear(periodStart.getFullYear() - 1);
    periodStart.setDate(periodStart.getDate() + 1);

    const period = await prisma.clientPeriod.upsert({
      where: { id: `resource-period-${i + 1}` },
      update: {},
      create: {
        id: `resource-period-${i + 1}`,
        clientId: createdClientIds[i],
        startDate: periodStart,
        endDate: periodEnd,
      },
    });

    const engagement = await prisma.auditEngagement.upsert({
      where: { id: `resource-engagement-${i + 1}` },
      update: {},
      create: {
        id: `resource-engagement-${i + 1}`,
        clientId: createdClientIds[i],
        periodId: period.id,
        firmId: firm.id,
        auditType: auditTypes[i % auditTypes.length],
        status: 'active',
        createdById: stuart.id,
      },
    });

    // Create some allocations
    const allocationStartBase = new Date(now);
    allocationStartBase.setDate(allocationStartBase.getDate() + (i * 5) - 10);
    const allocationEnd = new Date(allocationStartBase);
    allocationEnd.setDate(allocationEnd.getDate() + 10 + (i % 4) * 5);

    // RI allocation
    const riUsers = ['ST001', 'EC002', 'JB003'];
    await prisma.resourceAllocation.upsert({
      where: { id: `resource-alloc-ri-${i + 1}` },
      update: {},
      create: {
        id: `resource-alloc-ri-${i + 1}`,
        firmId: firm.id,
        engagementId: engagement.id,
        userId: createdStaff[riUsers[i % 3]],
        role: 'RI',
        startDate: allocationStartBase,
        endDate: allocationEnd,
        hoursPerDay: 1.5,
      },
    });

    // Reviewer allocation
    const reviewerUsers = ['MC004', 'RW005'];
    await prisma.resourceAllocation.upsert({
      where: { id: `resource-alloc-rev-${i + 1}` },
      update: {},
      create: {
        id: `resource-alloc-rev-${i + 1}`,
        firmId: firm.id,
        engagementId: engagement.id,
        userId: createdStaff[reviewerUsers[i % 2]],
        role: 'Reviewer',
        startDate: allocationStartBase,
        endDate: allocationEnd,
        hoursPerDay: 3.0,
      },
    });

    // Preparer allocation
    const preparerUsers = ['SJ006', 'DP007', 'LH008', 'TO009'];
    await prisma.resourceAllocation.upsert({
      where: { id: `resource-alloc-prep-${i + 1}` },
      update: {},
      create: {
        id: `resource-alloc-prep-${i + 1}`,
        firmId: firm.id,
        engagementId: engagement.id,
        userId: createdStaff[preparerUsers[i % 4]],
        role: 'Preparer',
        startDate: allocationStartBase,
        endDate: allocationEnd,
        hoursPerDay: 7.5,
      },
    });
  }
  console.log('Created resource allocations');

  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
