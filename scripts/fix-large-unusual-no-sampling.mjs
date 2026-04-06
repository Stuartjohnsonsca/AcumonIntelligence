/**
 * Update Large & Unusual test flow — remove random sampling step.
 * The analysis ranks all transactions by unusualness score.
 * The auditor reviews the ranked list and selects items to investigate.
 *
 * Usage: npx dotenv-cli -e .env.prod -- node scripts/fix-large-unusual-no-sampling.mjs
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
      // This wait step shows the ranked results and lets the auditor select which flagged items to investigate
      id: 'n_review', type: 'wait', position: { x: 280, y: 390 },
      data: { label: 'Review Ranked Results & Select Items to Investigate', waitFor: 'sampling', triggerType: 'sampling' },
    },
    {
      id: 'n_evidence_loop', type: 'forEach', position: { x: 280, y: 510 },
      data: { label: 'Gather Evidence for Selected Items', collection: 'sample_items' },
    },
    {
      id: 'n_fetch_evidence', type: 'action', position: { x: 520, y: 510 },
      data: {
        label: 'Fetch Evidence (Xero or Portal)', assignee: 'ai', inputType: 'fetch_evidence_or_portal',
        executionDef: {
          portalFallbackTemplate: {
            subject: 'Large/Unusual Item — Evidence Required: {{reference}}',
            message: 'We have identified the following transaction as requiring further investigation:\n\nDate: {{date}}\nDescription: {{description}}\nAmount: £{{amount}}\nReference: {{reference}}\n\nPlease provide the supporting documentation (invoice, contract, board minute, or other evidence explaining the nature and business purpose of this transaction).',
          },
          evidenceTypes: ['invoice', 'contract', 'board_minute', 'correspondence', 'other'],
        },
      },
    },
    {
      id: 'n_verify', type: 'action', position: { x: 280, y: 640 },
      data: {
        label: 'Verify Evidence & Assess Items', assignee: 'ai',
        executionDef: {
          systemInstruction: 'You are a UK statutory auditor reviewing evidence for large and unusual transactions. Assess whether the evidence supports the transaction, whether it has a legitimate business purpose, and whether it is properly authorised. Use the ACTUAL data provided.',
          promptTemplate: 'Review the evidence for each selected large/unusual transaction. Assess: 1) Evidence supports the amount? 2) Legitimate business purpose? 3) Properly authorised? 4) Fraud/related party indicators? 5) Correct account and period?\n\nReturn JSON array: [{ "reference", "amount", "evidenceAdequate", "businessPurpose", "concerns", "overallResult": "pass"/"fail"/"inconclusive" }]',
          outputFormat: 'pass_fail',
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
    { id: 'e5', source: 'n_evidence_loop', target: 'n_fetch_evidence', sourceHandle: 'body' },
    { id: 'e6', source: 'n_evidence_loop', target: 'n_verify', sourceHandle: 'done' },
    { id: 'e7', source: 'n_verify', target: 'n_end' },
  ],
};

async function main() {
  const tests = await prisma.methodologyTest.findMany({ where: { name: { contains: 'Large' } } });
  for (const t of tests) {
    await prisma.methodologyTest.update({
      where: { id: t.id },
      data: { flow: FLOW },
    });
    console.log(`Updated "${t.name}"`);
  }

  // Also update the system action executionDef steps description
  const tt = await prisma.methodologyTestType.findFirst({ where: { code: 'large_unusual_items' } });
  if (tt) {
    const execDef = tt.executionDef;
    execDef.steps[1].description = 'Every transaction scored on composite unusualness: size (z-score vs population mean/stddev), timing (weekends, bank holidays), description patterns (14 categories), transaction rarity (one-offs score higher), contra entries. Ranked highest score first.';
    execDef.steps[2].description = 'Full population shown ranked by unusualness score. Flagged items highlighted at the top. Auditor reviews and selects which items need evidence — judgemental, not random.';
    await prisma.methodologyTestType.update({ where: { id: tt.id }, data: { executionDef: execDef } });
    console.log('Updated system action description');
  }

  console.log('Done');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
