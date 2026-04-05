/**
 * Seed script: Creates all Bank Statement related Tests and Actions.
 *
 * Creates:
 * 1. BS In Year Review — requests bank statements per account from client
 * 2. Extract Bank Statement Data — parses PDFs, processes, stores
 * 3. BS Check to TB — compares bank data to trial balance
 * 4. BS Cut Off Test — checks transactions around period end
 * 5. BS Large & Unusual — identifies large/unusual transactions
 *
 * All tests are allocated to the "Cash and Bank" FS line (or similar).
 * The admin can customise the flows and AI prompts after seeding.
 *
 * Usage: node scripts/seed-bank-statement-tests.mjs
 * Requires: DATABASE_URL environment variable
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// ─── Test Definitions ────────────────────────────────────────────────────────

const tests = [
  {
    name: 'BS In Year Review',
    description: 'Request bank statements for the year plus 2 months post year-end. Creates one portal request per bank account.',
    testTypeCode: 'BS_IYR',
    testTypeName: 'BS In Year Review',
    actionType: 'client',
    significantRisk: false,
    flow: {
      nodes: [
        { id: 'n_start', type: 'start', position: { x: 280, y: 30 }, data: { label: 'Start' } },
        { id: 'n_foreach', type: 'forEach', position: { x: 280, y: 150 }, data: { label: 'For Each Bank Account', collection: 'tb_accounts' } },
        {
          id: 'n_request', type: 'action', position: { x: 150, y: 300 },
          data: {
            label: 'Request Bank Statements', assignee: 'client', inputType: 'portal_request',
            evidenceTag: 'bank_statements',
            executionDef: {
              evidenceTag: 'bank_statements',
              requestTemplate: {
                subject: 'Bank Statements — Account {{loop.currentItem.code}} {{loop.currentItem.description}}',
                message: 'Please provide bank statements for the following account:\n\nAccount Code: {{loop.currentItem.code}}\nAccount Name: {{loop.currentItem.description}}\n\nStatements required for the period:\n  From: {{engagement.periodStart}}\n  To: {{engagement.periodEndPlus2M}}\n\nThis covers the financial year ending {{engagement.periodEnd}} plus the following 2 months.\n\nPlease upload all statements as PDF files.',
              },
              expectedResponse: 'file_upload', evidenceTypes: ['bank_statement'],
              deadline: { days: 7, escalateOnOverdue: true }, inputs: [],
            },
          },
        },
        { id: 'n_end', type: 'end', position: { x: 280, y: 450 }, data: { label: 'Complete' } },
      ],
      edges: [
        { id: 'e1', source: 'n_start', target: 'n_foreach' },
        { id: 'e2', source: 'n_foreach', target: 'n_request', sourceHandle: 'body' },
        { id: 'e3', source: 'n_request', target: 'n_foreach' },
        { id: 'e4', source: 'n_foreach', target: 'n_end', sourceHandle: 'done' },
      ],
    },
  },
  {
    name: 'Extract Bank Statement Data',
    description: 'Parses uploaded PDF bank statements via AI, merges pages, trims to period, translates FX, and stores the extracted data for use by other tests.',
    testTypeCode: 'BS_EXTRACT',
    testTypeName: 'Extract Bank Statement Data',
    actionType: 'ai',
    significantRisk: false,
    flow: {
      nodes: [
        { id: 'n_start', type: 'start', position: { x: 280, y: 30 }, data: { label: 'Start' } },
        { id: 'n_evidence', type: 'action', position: { x: 280, y: 150 }, data: { label: 'Find Bank Statements', assignee: 'ai', inputType: 'use_prior_evidence', evidenceTag: 'bank_statements' } },
        { id: 'n_extract', type: 'action', position: { x: 280, y: 280 }, data: { label: 'Extract PDF Data', assignee: 'ai', inputType: 'bank_statement_extract' } },
        { id: 'n_process', type: 'action', position: { x: 280, y: 410 }, data: { label: 'Process & FX Translate', assignee: 'ai', inputType: 'process_bank_data' } },
        { id: 'n_store', type: 'action', position: { x: 280, y: 540 }, data: { label: 'Store Extracted Data', assignee: 'ai', inputType: 'store_extracted_bank_data', evidenceTag: 'bank_data' } },
        { id: 'n_end', type: 'end', position: { x: 280, y: 670 }, data: { label: 'Complete' } },
      ],
      edges: [
        { id: 'e1', source: 'n_start', target: 'n_evidence' },
        { id: 'e2', source: 'n_evidence', target: 'n_extract' },
        { id: 'e3', source: 'n_extract', target: 'n_process' },
        { id: 'e4', source: 'n_process', target: 'n_store' },
        { id: 'e5', source: 'n_store', target: 'n_end' },
      ],
    },
  },
  {
    name: 'BS Check to TB',
    description: 'Compares extracted bank statement closing balances to trial balance figures. Requires bank data to be extracted first.',
    testTypeCode: 'BS_CHECK_TB',
    testTypeName: 'BS Check to TB',
    actionType: 'ai',
    significantRisk: false,
    flow: {
      nodes: [
        { id: 'n_start', type: 'start', position: { x: 280, y: 30 }, data: { label: 'Start' } },
        { id: 'n_require', type: 'action', position: { x: 280, y: 150 }, data: { label: 'Load Bank Data', assignee: 'ai', inputType: 'require_prior_evidence', evidenceTag: 'bank_data' } },
        {
          id: 'n_compare', type: 'action', position: { x: 280, y: 300 },
          data: {
            label: 'Compare to TB', assignee: 'ai', inputType: 'ai_analysis',
            executionDef: {
              promptTemplate: 'Compare the extracted bank statement closing balances to the trial balance figures.\n\nBank statement data:\n{{nodes.n_require.dataTable}}\n\nTrial balance accounts:\n{{tb.accounts}}\n\nFor each bank account:\n1. Identify the closing balance from the bank statement\n2. Compare to the TB balance for the same account code\n3. Calculate and report any differences\n4. Flag any accounts where the difference exceeds {{engagement.clearlyTrivial}}\n\nReturn a JSON array with: { accountCode, bankBalance, tbBalance, difference, status: "matched" | "difference" | "missing" }',
              outputFormat: 'structured_data',
            },
          },
        },
        { id: 'n_end', type: 'end', position: { x: 280, y: 450 }, data: { label: 'Complete' } },
      ],
      edges: [
        { id: 'e1', source: 'n_start', target: 'n_require' },
        { id: 'e2', source: 'n_require', target: 'n_compare' },
        { id: 'e3', source: 'n_compare', target: 'n_end' },
      ],
    },
  },
  {
    name: 'BS Cut Off Test',
    description: 'Checks transactions around period end date to verify correct cut-off. Requires bank data to be extracted first.',
    testTypeCode: 'BS_CUTOFF',
    testTypeName: 'BS Cut Off Test',
    actionType: 'ai',
    significantRisk: false,
    flow: {
      nodes: [
        { id: 'n_start', type: 'start', position: { x: 280, y: 30 }, data: { label: 'Start' } },
        { id: 'n_require', type: 'action', position: { x: 280, y: 150 }, data: { label: 'Load Bank Data', assignee: 'ai', inputType: 'require_prior_evidence', evidenceTag: 'bank_data' } },
        {
          id: 'n_cutoff', type: 'action', position: { x: 280, y: 300 },
          data: {
            label: 'Analyse Cut Off', assignee: 'ai', inputType: 'ai_analysis',
            executionDef: {
              promptTemplate: 'Analyse bank transactions around the period end date ({{engagement.periodEnd}}) for cut-off testing.\n\nBank statement data:\n{{nodes.n_require.dataTable}}\n\nFor the last 5 business days before period end and first 5 business days after:\n1. List all transactions with date, description, amount\n2. Identify any that may be in the wrong period\n3. Flag receipts recorded before period end that relate to the next period\n4. Flag payments recorded after period end that relate to the current period\n5. Note any large or unusual items near the cut-off date\n\nReturn a JSON object with: { cutOffDate, transactionsBefore: [...], transactionsAfter: [...], flaggedItems: [...], conclusion: "satisfactory" | "issues_found" }',
              outputFormat: 'structured_data',
            },
          },
        },
        { id: 'n_end', type: 'end', position: { x: 280, y: 450 }, data: { label: 'Complete' } },
      ],
      edges: [
        { id: 'e1', source: 'n_start', target: 'n_require' },
        { id: 'e2', source: 'n_require', target: 'n_cutoff' },
        { id: 'e3', source: 'n_cutoff', target: 'n_end' },
      ],
    },
  },
  {
    name: 'BS Large & Unusual Transactions',
    description: 'Identifies large and unusual bank transactions for further investigation. Requires bank data to be extracted first.',
    testTypeCode: 'BS_LARGE_UNUSUAL',
    testTypeName: 'BS Large & Unusual',
    actionType: 'ai',
    significantRisk: false,
    flow: {
      nodes: [
        { id: 'n_start', type: 'start', position: { x: 280, y: 30 }, data: { label: 'Start' } },
        { id: 'n_require', type: 'action', position: { x: 280, y: 150 }, data: { label: 'Load Bank Data', assignee: 'ai', inputType: 'require_prior_evidence', evidenceTag: 'bank_data' } },
        {
          id: 'n_analyse', type: 'action', position: { x: 280, y: 300 },
          data: {
            label: 'Identify Large & Unusual', assignee: 'ai', inputType: 'ai_analysis',
            executionDef: {
              promptTemplate: 'Analyse bank transactions to identify large and unusual items.\n\nBank statement data:\n{{nodes.n_require.dataTable}}\n\nMateriality: {{engagement.materiality}}\nPerformance Materiality: {{engagement.performanceMateriality}}\nClearly Trivial: {{engagement.clearlyTrivial}}\n\nIdentify:\n1. All transactions above Performance Materiality (individually significant)\n2. Unusual patterns: round numbers, related party indicators, weekend transactions\n3. Transactions with unusual descriptions or references\n4. Large credits followed by similar debits (potential teeming and lading)\n5. Transactions near period end that seem unusual\n\nFor each flagged item provide: date, description, amount (debitFC or creditFC), accountNumber, reason for flagging, risk level (high/medium/low)\n\nReturn a JSON object with: { flaggedItems: [...], summary: { totalFlagged, highRisk, mediumRisk, lowRisk, totalValueFlagged }, conclusion: "satisfactory" | "items_for_investigation" }',
              outputFormat: 'structured_data',
            },
          },
        },
        { id: 'n_end', type: 'end', position: { x: 280, y: 450 }, data: { label: 'Complete' } },
      ],
      edges: [
        { id: 'e1', source: 'n_start', target: 'n_require' },
        { id: 'e2', source: 'n_require', target: 'n_analyse' },
        { id: 'e3', source: 'n_analyse', target: 'n_end' },
      ],
    },
  },
];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const firms = await prisma.firm.findMany({ select: { id: true, name: true } });
  console.log(`Found ${firms.length} firm(s)\n`);

  for (const firm of firms) {
    console.log(`=== ${firm.name} (${firm.id}) ===`);

    // Find "Cash and Bank" FS line for allocation
    const bankFsLine = await prisma.methodologyFsLine.findFirst({
      where: { firmId: firm.id, name: { in: ['Cash and Bank', 'Cash & Bank', 'Bank', 'Cash and Cash Equivalents'] } },
    });
    if (bankFsLine) {
      console.log(`  FS Line: ${bankFsLine.name} (${bankFsLine.id})`);
    } else {
      console.log(`  Warning: No "Cash and Bank" FS line found — tests will be created but not allocated`);
    }

    for (const testDef of tests) {
      // Upsert test type
      let testType = await prisma.methodologyTestType.findFirst({
        where: { firmId: firm.id, code: testDef.testTypeCode },
      });
      if (!testType) {
        testType = await prisma.methodologyTestType.create({
          data: {
            firmId: firm.id,
            code: testDef.testTypeCode,
            name: testDef.testTypeName,
            actionType: testDef.actionType,
            executionDef: {},
          },
        });
        console.log(`  + Test type: ${testDef.testTypeCode}`);
      } else {
        console.log(`  = Test type: ${testDef.testTypeCode} (exists)`);
      }

      // Upsert test
      let test = await prisma.methodologyTest.findFirst({
        where: { firmId: firm.id, name: testDef.name },
      });
      if (test) {
        await prisma.methodologyTest.update({
          where: { id: test.id },
          data: { flow: testDef.flow, testTypeCode: testDef.testTypeCode, description: testDef.description },
        });
        console.log(`  ~ Updated test: ${testDef.name}`);
      } else {
        test = await prisma.methodologyTest.create({
          data: {
            firmId: firm.id,
            name: testDef.name,
            description: testDef.description,
            testTypeCode: testDef.testTypeCode,
            assertions: [],
            framework: 'ALL',
            significantRisk: testDef.significantRisk,
            flow: testDef.flow,
            isActive: true,
            sortOrder: 100,
          },
        });
        console.log(`  + Created test: ${testDef.name}`);
      }

      // Allocate to FS line
      if (bankFsLine && test) {
        const exists = await prisma.methodologyTestAllocation.findFirst({
          where: { testId: test.id, fsLineId: bankFsLine.id },
        });
        if (!exists) {
          await prisma.methodologyTestAllocation.create({
            data: { testId: test.id, fsLineId: bankFsLine.id },
          });
          console.log(`    → Allocated to ${bankFsLine.name}`);
        }
      }
    }

    console.log('');
  }

  console.log('Done!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
