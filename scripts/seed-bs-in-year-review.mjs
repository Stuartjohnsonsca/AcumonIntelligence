/**
 * Seed script: Creates the "BS In Year Review" test flow template.
 *
 * This test:
 * - Loops through each TB bank account (forEach over tb_accounts)
 * - Creates a portal request per account asking for bank statements
 *   for the engagement year plus the following 2 months
 *
 * Usage: node scripts/seed-bs-in-year-review.mjs
 *
 * Prerequisites: DATABASE_URL env var must be set.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEST_NAME = 'BS In Year Review';
const TEST_TYPE_CODE = 'BS_IYR';

const flow = {
  nodes: [
    {
      id: 'node_start',
      type: 'start',
      position: { x: 280, y: 30 },
      data: { label: 'Start Test' },
    },
    {
      id: 'node_foreach',
      type: 'forEach',
      position: { x: 280, y: 150 },
      data: {
        label: 'For Each Bank Account',
        collection: 'tb_accounts',
      },
    },
    {
      id: 'node_request',
      type: 'action',
      position: { x: 150, y: 300 },
      data: {
        label: 'Request Bank Statements',
        description: 'Request bank statements for the year and 2 months post year-end per bank account',
        assignee: 'client',
        inputType: 'portal_request',
        executionDef: {
          requestTemplate: {
            subject: 'Bank Statements — Account {{loop.currentItem.code}} {{loop.currentItem.description}}',
            message: [
              'Please provide bank statements for the following account:',
              '',
              'Account Code: {{loop.currentItem.code}}',
              'Account Name: {{loop.currentItem.description}}',
              '',
              'Statements required for the period:',
              '  From: {{engagement.periodStart}}',
              '  To: {{engagement.periodEndPlus2M}}',
              '',
              'This covers the financial year ending {{engagement.periodEnd}} plus the following 2 months.',
              '',
              'Please upload all statements as PDF files.',
            ].join('\n'),
          },
          expectedResponse: 'file_upload',
          evidenceTag: 'bank_statements',
          evidenceTypes: ['bank_statement'],
          deadline: {
            days: 7,
            escalateOnOverdue: true,
          },
          inputs: [],
        },
      },
    },
    {
      id: 'node_end',
      type: 'end',
      position: { x: 280, y: 500 },
      data: { label: 'Complete' },
    },
  ],
  edges: [
    { id: 'edge_1', source: 'node_start', target: 'node_foreach' },
    { id: 'edge_2', source: 'node_foreach', target: 'node_request', sourceHandle: 'body' },
    { id: 'edge_3', source: 'node_request', target: 'node_foreach' },
    { id: 'edge_4', source: 'node_foreach', target: 'node_end', sourceHandle: 'done' },
  ],
};

async function main() {
  // Find all firms
  const firms = await prisma.firm.findMany({ select: { id: true, name: true } });
  console.log(`Found ${firms.length} firm(s)`);

  for (const firm of firms) {
    console.log(`\nProcessing firm: ${firm.name} (${firm.id})`);

    // Check if test type exists for this firm
    let testType = await prisma.methodologyTestType.findFirst({
      where: { firmId: firm.id, code: TEST_TYPE_CODE },
    });

    if (!testType) {
      testType = await prisma.methodologyTestType.create({
        data: {
          firmId: firm.id,
          code: TEST_TYPE_CODE,
          name: TEST_NAME,
          actionType: 'client',
          executionDef: flow.nodes.find(n => n.id === 'node_request')?.data.executionDef || {},
        },
      });
      console.log(`  Created test type: ${TEST_TYPE_CODE}`);
    } else {
      console.log(`  Test type ${TEST_TYPE_CODE} already exists`);
    }

    // Check if test already exists
    const existing = await prisma.methodologyTest.findFirst({
      where: { firmId: firm.id, name: TEST_NAME },
    });

    if (existing) {
      // Update the flow
      await prisma.methodologyTest.update({
        where: { id: existing.id },
        data: { flow, testTypeCode: TEST_TYPE_CODE },
      });
      console.log(`  Updated existing test: ${TEST_NAME}`);
    } else {
      await prisma.methodologyTest.create({
        data: {
          firmId: firm.id,
          name: TEST_NAME,
          description: 'Request bank statements for the year and 2 months post year-end for each bank account. Creates one portal request per account.',
          testTypeCode: TEST_TYPE_CODE,
          assertions: [],
          framework: 'ALL',
          significantRisk: false,
          flow,
          isActive: true,
          sortOrder: 100,
        },
      });
      console.log(`  Created test: ${TEST_NAME}`);
    }

    // Allocate to "Cash and Bank" FS line if it exists
    const bankFsLine = await prisma.methodologyFsLine.findFirst({
      where: { firmId: firm.id, name: { in: ['Cash and Bank', 'Cash & Bank', 'Bank', 'Cash and Cash Equivalents'] } },
    });

    if (bankFsLine) {
      const test = await prisma.methodologyTest.findFirst({
        where: { firmId: firm.id, name: TEST_NAME },
      });
      if (test) {
        const allocationExists = await prisma.methodologyTestAllocation.findFirst({
          where: { testId: test.id, fsLineId: bankFsLine.id },
        });
        if (!allocationExists) {
          await prisma.methodologyTestAllocation.create({
            data: { testId: test.id, fsLineId: bankFsLine.id },
          });
          console.log(`  Allocated to FS line: ${bankFsLine.name}`);
        } else {
          console.log(`  Already allocated to FS line: ${bankFsLine.name}`);
        }
      }
    } else {
      console.log(`  Warning: No "Cash and Bank" FS line found — allocate manually via methodology admin`);
    }
  }

  console.log('\nDone!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
