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
