import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';

// One-time database setup endpoint - creates tables and seeds data
// Protected by a secret query param
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');

  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Test connection
    await prisma.$queryRaw`SELECT 1`;

    // Check if data already exists
    const existingUsers = await prisma.user.count();
    if (existingUsers > 0) {
      return Response.json({ message: 'Database already seeded', userCount: existingUsers });
    }

    // Seed data
    const firm = await prisma.firm.upsert({
      where: { id: 'johnsons-firm-id-0000-000000000001' },
      update: {},
      create: {
        id: 'johnsons-firm-id-0000-000000000001',
        name: 'Johnsons Financial Management',
      },
    });

    const passwordHash = await bcrypt.hash('Stuy901!', 12);
    const stuartExpiry = new Date();
    stuartExpiry.setDate(stuartExpiry.getDate() + 60);

    const stuart = await prisma.user.upsert({
      where: { email: 'stuart@acumon.com' },
      update: {},
      create: {
        displayId: 'ST001',
        firmId: firm.id,
        name: 'Stuart Thomson',
        email: 'stuart@acumon.com',
        passwordHash,
        twoFactorMethod: 'email',
        isSuperAdmin: true,
        isFirmAdmin: true,
        isPortfolioOwner: true,
        isResourceAdmin: true,
        expiryDate: stuartExpiry,
      },
    });

    // Create staff
    const staffMembers = [
      { displayId: 'EC002', name: 'Edmund Cartwright', email: 'edmund.cartwright@johnsonsfinancial.co.uk', jobTitle: 'Partner' },
      { displayId: 'JB003', name: 'Jack Borg-Delaney', email: 'jack.borgdelaney@johnsonsfinancial.co.uk', jobTitle: 'Partner' },
      { displayId: 'MC004', name: 'Mandhu Chennupati', email: 'mandhu.chennupati@johnsonsfinancial.co.uk', jobTitle: 'Audit Manager' },
      { displayId: 'RW005', name: 'Rob Wilkes', email: 'rob.wilkes@johnsonsfinancial.co.uk', jobTitle: 'Audit Manager' },
      { displayId: 'SJ006', name: 'Sarah Jenkins', email: 'sarah.jenkins@johnsonsfinancial.co.uk', jobTitle: 'Audit Senior' },
      { displayId: 'DP007', name: 'Daniel Patel', email: 'daniel.patel@johnsonsfinancial.co.uk', jobTitle: 'Audit Semi-Senior' },
      { displayId: 'LH008', name: 'Lucy Henderson', email: 'lucy.henderson@johnsonsfinancial.co.uk', jobTitle: 'Audit Trainee' },
      { displayId: 'TO009', name: "Tom O'Brien", email: 'tom.obrien@johnsonsfinancial.co.uk', jobTitle: 'Audit Trainee' },
    ];

    const createdStaff: Record<string, string> = {};
    createdStaff['ST001'] = stuart.id;

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
    }

    // Resource staff settings
    const staffSettings = [
      { displayId: 'ST001', role: 'RI', limit: 30, isRI: true },
      { displayId: 'EC002', role: 'RI', limit: 30, isRI: true },
      { displayId: 'JB003', role: 'RI', limit: 30, isRI: true },
      { displayId: 'MC004', role: 'Reviewer', limit: 18, isRI: false },
      { displayId: 'RW005', role: 'Reviewer', limit: 18, isRI: false },
      { displayId: 'SJ006', role: 'Preparer', limit: 3, isRI: false },
      { displayId: 'DP007', role: 'Preparer', limit: 3, isRI: false },
      { displayId: 'LH008', role: 'Preparer', limit: 3, isRI: false },
      { displayId: 'TO009', role: 'Preparer', limit: 3, isRI: false },
    ];

    for (const ss of staffSettings) {
      await prisma.resourceStaffSetting.upsert({
        where: { userId: createdStaff[ss.displayId] },
        update: {},
        create: {
          userId: createdStaff[ss.displayId],
          firmId: firm.id,
          resourceRole: ss.role,
          concurrentJobLimit: ss.limit,
          isRI: ss.isRI,
          weeklyCapacityHrs: 37.5,
        },
      });
    }

    // Dummy clients
    const dummyClients = [
      'Acme Industries Ltd', 'Greenfield Holdings PLC', 'Northern Healthcare Trust',
      'TechVault Solutions Ltd', 'Riverside Construction Group', 'Blue Horizon Energy PLC',
      'Sterling Legal Partners', 'Oakwood Education Trust', 'Harbour Retail Group',
      'Pinnacle Public Services', 'Meridian Charities', 'Atlas Financial Services',
      'Summit Manufacturing Co', 'Lighthouse Healthcare', 'Quantum Tech Innovations',
    ];

    const sectors = ['Manufacturing', 'Financial Services', 'Healthcare', 'Technology',
      'Construction', 'Energy', 'Legal', 'Education', 'Retail', 'Public Sector',
      'Charities & Non-Profit', 'Financial Services', 'Manufacturing', 'Healthcare', 'Technology'];

    const createdClientIds: string[] = [];
    for (let i = 0; i < dummyClients.length; i++) {
      const clientId = `resource-client-${i + 1}`;
      const client = await prisma.client.upsert({
        where: { id: clientId },
        update: {},
        create: { id: clientId, firmId: firm.id, clientName: dummyClients[i], sector: sectors[i] },
      });
      createdClientIds.push(client.id);
    }

    // Resource jobs
    const auditTypes = ['SME', 'PIE', 'SME_CONTROLS', 'PIE_CONTROLS', 'GROUP'];
    const now = new Date();

    for (let i = 0; i < createdClientIds.length; i++) {
      const periodEnd = new Date(now.getFullYear(), ((i * 2) % 12), 0);
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

    // Engagements and allocations for first 8 clients
    for (let i = 0; i < 8; i++) {
      const periodEnd = new Date(now.getFullYear(), ((i * 2) % 12), 0);
      if (periodEnd < now) periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      const periodStart = new Date(periodEnd);
      periodStart.setFullYear(periodStart.getFullYear() - 1);
      periodStart.setDate(periodStart.getDate() + 1);

      const period = await prisma.clientPeriod.upsert({
        where: { id: `resource-period-${i + 1}` },
        update: {},
        create: { id: `resource-period-${i + 1}`, clientId: createdClientIds[i], startDate: periodStart, endDate: periodEnd },
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

      const allocStart = new Date(now);
      allocStart.setDate(allocStart.getDate() + (i * 5) - 10);
      const allocEnd = new Date(allocStart);
      allocEnd.setDate(allocEnd.getDate() + 10 + (i % 4) * 5);

      const riUsers = ['ST001', 'EC002', 'JB003'];
      const reviewerUsers = ['MC004', 'RW005'];
      const preparerUsers = ['SJ006', 'DP007', 'LH008', 'TO009'];

      await prisma.resourceAllocation.createMany({
        data: [
          { id: `resource-alloc-ri-${i + 1}`, firmId: firm.id, engagementId: engagement.id, userId: createdStaff[riUsers[i % 3]], role: 'RI', startDate: allocStart, endDate: allocEnd, hoursPerDay: 1.5 },
          { id: `resource-alloc-rev-${i + 1}`, firmId: firm.id, engagementId: engagement.id, userId: createdStaff[reviewerUsers[i % 2]], role: 'Reviewer', startDate: allocStart, endDate: allocEnd, hoursPerDay: 3.0 },
          { id: `resource-alloc-prep-${i + 1}`, firmId: firm.id, engagementId: engagement.id, userId: createdStaff[preparerUsers[i % 4]], role: 'Preparer', startDate: allocStart, endDate: allocEnd, hoursPerDay: 7.5 },
        ],
        skipDuplicates: true,
      });
    }

    // Seed products
    const products = [
      { name: 'Financial Data Extraction', category: 'Statutory Audit', urlPrefix: 'DateExtraction', expiryDays: 60, price1: 50, price5: 240, price10: 450, price20: 875 },
      { name: 'Document Summary', category: 'Statutory Audit', urlPrefix: 'DocSummary', expiryDays: 60, price1: 50, price5: 240, price10: 450, price20: 875 },
      { name: 'Sample Calculator', category: 'Statutory Audit', urlPrefix: 'Sampling', expiryDays: 60, price1: 50, price5: 240, price10: 450, price20: 875 },
    ];

    for (const p of products) {
      await prisma.product.upsert({ where: { urlPrefix: p.urlPrefix }, update: {}, create: p });
    }

    return Response.json({ message: 'Database seeded successfully', users: Object.keys(createdStaff).length + 1, clients: createdClientIds.length });
  } catch (error: any) {
    return Response.json({ error: error.message, stack: error.stack?.split('\n').slice(0, 5) }, { status: 500 });
  }
}
