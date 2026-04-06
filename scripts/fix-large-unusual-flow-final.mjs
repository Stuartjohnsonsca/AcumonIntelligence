/**
 * Fix Large & Unusual flow:
 * - Remove AI "Verify Evidence" step (verification is done in the 3-pane UI)
 * - forEach body uses fetch_evidence_or_portal which:
 *   1. Checks if evidence already exists (other tests)
 *   2. Tries Xero attachment
 *   3. Falls back to portal request (pauses until client responds)
 * - After all evidence gathered, flow completes
 *
 * Usage: npx dotenv-cli -e .env.prod -- node scripts/fix-large-unusual-flow-final.mjs
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const FLOW = {
  nodes: [
    { id: 'n_start', type: 'start', position: { x: 280, y: 30 }, data: { label: 'Start' } },
    {
      id: 'n_extract', type: 'action', position: { x: 280, y: 130 },
      data: { label: 'Load Transaction Data', assignee: 'ai', inputType: 'accounting_extract_or_bank' },
    },
    {
      id: 'n_flag', type: 'action', position: { x: 280, y: 260 },
      data: { label: 'Score & Rank All Transactions', assignee: 'ai', inputType: 'analyse_large_unusual' },
    },
    {
      id: 'n_review', type: 'wait', position: { x: 280, y: 390 },
      data: { label: 'Review Ranked Results & Select Items to Investigate', waitFor: 'review_flagged', triggerType: 'review_flagged' },
    },
    {
      id: 'n_evidence_loop', type: 'forEach', position: { x: 280, y: 510 },
      data: { label: 'Gather Evidence for Selected Items', collection: 'sample_items' },
    },
    {
      id: 'n_fetch_evidence', type: 'action', position: { x: 520, y: 510 },
      data: {
        label: 'Obtain Evidence', assignee: 'ai', inputType: 'fetch_evidence_or_portal',
        executionDef: {
          portalFallbackTemplate: {
            subject: 'Evidence Required: {{reference}}',
            message: 'Please provide the supporting document for:\n\nDate: {{date}}\nDescription: {{description}}\nAmount: £{{amount}}\nReference: {{reference}}\nContact: {{contact}}\n\nPlease upload the invoice, contract, or other supporting documentation.',
          },
          evidenceTypes: ['invoice', 'contract', 'board_minute', 'correspondence', 'other'],
        },
      },
    },
    { id: 'n_end', type: 'end', position: { x: 280, y: 640 }, data: { label: 'Complete' } },
  ],
  edges: [
    { id: 'e1', source: 'n_start', target: 'n_extract' },
    { id: 'e2', source: 'n_extract', target: 'n_flag' },
    { id: 'e3', source: 'n_flag', target: 'n_review' },
    { id: 'e4', source: 'n_review', target: 'n_evidence_loop' },
    { id: 'e5', source: 'n_evidence_loop', target: 'n_fetch_evidence', sourceHandle: 'body' },
    { id: 'e6', source: 'n_evidence_loop', target: 'n_end', sourceHandle: 'done' },
  ],
};

async function main() {
  const tests = await prisma.methodologyTest.findMany({ where: { name: { contains: 'Large' } } });
  for (const t of tests) {
    await prisma.methodologyTest.update({ where: { id: t.id }, data: { flow: FLOW } });
    console.log('Updated:', t.name);
  }
  console.log('Done');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
