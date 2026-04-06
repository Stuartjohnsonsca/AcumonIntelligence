/**
 * Redesign Cut Off Test to:
 * 1. Extract transactions from Xero (or manual upload) for the cut-off window
 * 2. Show full population to user
 * 3. Let user select a sample
 * 4. Request evidence for sampled items
 * 5. Verify cut-off compliance
 *
 * Usage: npx dotenv-cli -e .env.prod -- node scripts/fix-cutoff-test-xero.mjs
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const CUTOFF_FLOW = {
  nodes: [
    { id: 'n_start', type: 'start', position: { x: 280, y: 30 }, data: { label: 'Start' } },
    {
      id: 'n_extract', type: 'action', position: { x: 280, y: 130 },
      data: {
        label: 'Extract Ledger Transactions (Cut-Off Window)',
        assignee: 'ai',
        inputType: 'accounting_extract_cutoff',
      },
    },
    {
      id: 'n_sample', type: 'wait', position: { x: 280, y: 260 },
      data: { label: 'Select Sample', waitFor: 'sampling', triggerType: 'sampling' },
    },
    {
      id: 'n_request_evidence', type: 'forEach', position: { x: 280, y: 380 },
      data: {
        label: 'Request Evidence for Sample', collection: 'sample_items',
      },
    },
    {
      id: 'n_portal_request', type: 'action', position: { x: 500, y: 380 },
      data: {
        label: 'Request Invoice/Evidence', assignee: 'client', inputType: 'portal_request',
        executionDef: {
          requestTemplate: {
            subject: 'Cut Off Test — Evidence Required: {{loop.currentItem.reference}}',
            message: 'Please provide the invoice or delivery note for transaction: {{loop.currentItem.description}} ({{loop.currentItem.reference}}) dated {{loop.currentItem.date}} for £{{loop.currentItem.amount}}.',
          },
          expectedResponse: 'file_upload',
          evidenceTypes: ['invoice', 'delivery_note', 'credit_note'],
        },
      },
    },
    {
      id: 'n_verify', type: 'action', position: { x: 280, y: 510 },
      data: {
        label: 'Verify Cut Off', assignee: 'ai',
        executionDef: {
          systemInstruction: 'You are a UK statutory auditor performing cut-off testing. For each sampled transaction, compare the invoice/delivery date to the recording date in the ledger. Determine if the transaction is recorded in the correct accounting period relative to the period end date. Be precise with dates and amounts. Use the ACTUAL data provided.',
          promptTemplate: 'Period end date: {{engagement.periodEnd}}\n\nFor each sampled transaction and its supporting evidence, verify:\n1. Is the invoice/delivery date before or after period end?\n2. Is the transaction recorded in the correct period?\n3. If recorded in the wrong period, what is the misstatement amount?\n\nReturn a JSON array: [{ "reference": "...", "recordingDate": "...", "invoiceDate": "...", "amount": 0, "correctPeriod": true/false, "misstatement": 0, "notes": "..." }]',
          outputFormat: 'pass_fail',
          requiresReview: false,
        },
      },
    },
    { id: 'n_end', type: 'end', position: { x: 280, y: 630 }, data: { label: 'Complete' } },
  ],
  edges: [
    { id: 'e1', source: 'n_start', target: 'n_extract' },
    { id: 'e2', source: 'n_extract', target: 'n_sample' },
    { id: 'e3', source: 'n_sample', target: 'n_request_evidence' },
    { id: 'e4', source: 'n_request_evidence', target: 'n_portal_request', sourceHandle: 'body' },
    { id: 'e5', source: 'n_request_evidence', target: 'n_verify', sourceHandle: 'done' },
    { id: 'e6', source: 'n_verify', target: 'n_end' },
  ],
};

async function main() {
  const tests = await prisma.methodologyTest.findMany({
    where: { name: { contains: 'Cut Off' } },
  });
  for (const t of tests) {
    await prisma.methodologyTest.update({
      where: { id: t.id },
      data: {
        flow: CUTOFF_FLOW,
        description: 'Extracts ledger transactions from the accounting system (e.g. Xero) for the cut-off window around period end. User selects a sample, requests supporting invoices, and verifies transactions are recorded in the correct accounting period.',
      },
    });
    console.log(`Updated "${t.name}" with Xero extract + sampling flow`);
  }
  console.log('Done');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
