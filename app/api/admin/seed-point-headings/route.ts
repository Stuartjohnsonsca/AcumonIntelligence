import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

const DEFAULT_MANAGEMENT_HEADINGS = [
  'Financial Reporting',
  'Internal Controls',
  'Compliance',
  'Tax',
  'IT Systems',
  'Going Concern',
  'Fraud',
  'Related Parties',
  'Accounting Estimates',
  'Revenue Recognition',
  'Payroll',
  'Fixed Assets',
  'Stock / Inventory',
  'Debtors / Receivables',
  'Creditors / Payables',
  'Cash and Bank',
  'Other',
];

const DEFAULT_REPRESENTATION_HEADINGS = [
  'General',
  'Financial Statements',
  'Completeness of Information',
  'Fraud',
  'Laws and Regulations',
  'Related Parties',
  'Going Concern',
  'Subsequent Events',
  'Accounting Estimates',
  'Provisions and Contingencies',
  'Commitments',
  'Other',
];

/**
 * POST /api/admin/seed-point-headings
 * Seeds management and representation headings templates. Safe to re-run.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const firmId = session.user.firmId;
  let created = 0;

  for (const [type, headings] of [
    ['management_headings', DEFAULT_MANAGEMENT_HEADINGS],
    ['representation_headings', DEFAULT_REPRESENTATION_HEADINGS],
  ] as const) {
    const existing = await prisma.methodologyTemplate.findUnique({
      where: { firmId_templateType_auditType: { firmId, templateType: type, auditType: 'ALL' } },
    });
    if (!existing) {
      await prisma.methodologyTemplate.create({
        data: { firmId, templateType: type, auditType: 'ALL', items: headings },
      });
      created++;
    }
  }

  return NextResponse.json({ message: `Seeded ${created} heading template(s)`, created });
}
