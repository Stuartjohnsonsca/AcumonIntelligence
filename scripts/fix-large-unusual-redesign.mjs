/**
 * Redesign Large & Unusual Items test:
 * 1. Extract ALL transactions from Xero for the full period
 * 2. System flags large/unusual items — user sees FULL dataset with flags highlighted
 * 3. User reviews and selects which items to investigate (judgemental, not statistical)
 * 4. Request evidence for selected items via portal
 * 5. AI verifies the evidence
 * 6. Complete
 *
 * Usage: npx dotenv-cli -e .env.prod -- node scripts/fix-large-unusual-redesign.mjs
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const FLOW = {
  nodes: [
    { id: 'n_start', type: 'start', position: { x: 280, y: 30 }, data: { label: 'Start' } },
    {
      id: 'n_extract', type: 'action', position: { x: 280, y: 130 },
      data: {
        label: 'Load Transaction Data',
        assignee: 'ai',
        inputType: 'accounting_extract_or_bank', // Try Xero first, fall back to bank statement data
      },
    },
    {
      id: 'n_flag', type: 'action', position: { x: 280, y: 260 },
      data: {
        label: 'Identify Large & Unusual Items',
        assignee: 'ai',
        inputType: 'analyse_large_unusual',
      },
    },
    {
      id: 'n_review', type: 'wait', position: { x: 280, y: 390 },
      data: {
        label: 'Review Flagged Items & Select for Investigation',
        waitFor: 'sampling',
        triggerType: 'sampling',
      },
    },
    {
      id: 'n_evidence_loop', type: 'forEach', position: { x: 280, y: 510 },
      data: {
        label: 'Request Evidence for Selected Items',
        collection: 'sample_items',
      },
    },
    {
      id: 'n_portal', type: 'action', position: { x: 520, y: 510 },
      data: {
        label: 'Request Supporting Evidence',
        assignee: 'client',
        inputType: 'portal_request',
        executionDef: {
          requestTemplate: {
            subject: 'Large/Unusual Item — Evidence Required: {{loop.currentItem.reference}}',
            message: 'We have identified the following transaction as requiring further investigation:\n\nDate: {{loop.currentItem.date}}\nDescription: {{loop.currentItem.description}}\nAmount: £{{loop.currentItem.amount}}\nReference: {{loop.currentItem.reference}}\n\nPlease provide the supporting documentation (invoice, contract, board minute, or other evidence explaining the nature and business purpose of this transaction).',
          },
          expectedResponse: 'file_upload',
          evidenceTypes: ['invoice', 'contract', 'board_minute', 'correspondence', 'other'],
        },
      },
    },
    {
      id: 'n_verify', type: 'action', position: { x: 280, y: 640 },
      data: {
        label: 'Verify Evidence & Assess Items',
        assignee: 'ai',
        executionDef: {
          systemInstruction: 'You are a UK statutory auditor reviewing evidence for large and unusual transactions. For each item, assess whether the evidence supports the transaction, whether it has a legitimate business purpose, and whether it is properly authorised and recorded. Flag any items that indicate potential fraud, related party transactions, or misstatement. Use the ACTUAL data provided.',
          promptTemplate: 'Review the evidence provided for each flagged large or unusual transaction.\n\nFor each item assess:\n1. Does the evidence support the transaction amount and description?\n2. Is there a legitimate business purpose?\n3. Is the transaction properly authorised?\n4. Any indicators of fraud, related party involvement, or misclassification?\n5. Is it recorded in the correct account and period?\n\nReturn a JSON array: [{ "reference": "...", "amount": 0, "evidenceAdequate": true/false, "businessPurpose": "...", "concerns": "...", "overallResult": "pass"/"fail"/"inconclusive" }]',
          outputFormat: 'pass_fail',
          requiresReview: false,
        },
      },
    },
    { id: 'n_end', type: 'end', position: { x: 280, y: 760 }, data: { label: 'Complete' } },
  ],
  edges: [
    { id: 'e1', source: 'n_start', target: 'n_extract' },
    { id: 'e2', source: 'n_extract', target: 'n_flag' },
    { id: 'e3', source: 'n_flag', target: 'n_review' },
    { id: 'e4', source: 'n_review', target: 'n_evidence_loop' },
    { id: 'e5', source: 'n_evidence_loop', target: 'n_portal', sourceHandle: 'body' },
    { id: 'e6', source: 'n_evidence_loop', target: 'n_verify', sourceHandle: 'done' },
    { id: 'e7', source: 'n_verify', target: 'n_end' },
  ],
};

async function main() {
  const tests = await prisma.methodologyTest.findMany({
    where: { name: { contains: 'Large' } },
  });
  for (const t of tests) {
    await prisma.methodologyTest.update({
      where: { id: t.id },
      data: {
        flow: FLOW,
        name: t.name.replace('BS ', ''), // Remove "BS" prefix if present
        description: 'Extracts all transactions from the accounting system for the audit period. Automatically flags large items (above PM) and unusual items (related party, round numbers, reversals, etc.). The auditor reviews the full dataset with flags highlighted, selects items to investigate, requests evidence, and verifies each item.',
      },
    });
    console.log(`Updated "${t.name}" → ledger-based with evidence gathering`);
  }

  // Cancel old executions
  const execs = await prisma.testExecution.findMany({
    where: { testDescription: { contains: 'Large' }, status: { in: ['completed', 'failed', 'running'] } },
  });
  for (const e of execs) {
    if (e.status !== 'cancelled') {
      await prisma.testExecution.update({
        where: { id: e.id },
        data: { status: 'cancelled', errorMessage: 'Test redesigned to extract from accounting system with evidence gathering.' },
      });
      console.log(`  Cancelled execution ${e.id.slice(0, 8)}`);
    }
  }

  console.log('Done');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
