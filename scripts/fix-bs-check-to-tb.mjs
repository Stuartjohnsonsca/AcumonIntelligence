/**
 * Fix BS Check to TB test: change from AI analysis to programmatic compare_bank_to_tb handler.
 * Also mark the existing garbage execution as failed.
 *
 * Usage: npx dotenv-cli -e .env.prod -- node scripts/fix-bs-check-to-tb.mjs
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const FIXED_FLOW = {
  nodes: [
    { id: 'n_start', type: 'start', position: { x: 280, y: 30 }, data: { label: 'Start' } },
    { id: 'n_require', type: 'action', position: { x: 280, y: 150 }, data: { label: 'Load Bank Data', assignee: 'ai', inputType: 'require_prior_evidence', evidenceTag: 'bank_data' } },
    {
      id: 'n_compare', type: 'action', position: { x: 280, y: 300 },
      data: {
        label: 'Compare Bank to TB', assignee: 'ai', inputType: 'compare_bank_to_tb',
      },
    },
    { id: 'n_end', type: 'end', position: { x: 280, y: 450 }, data: { label: 'Complete' } },
  ],
  edges: [
    { id: 'e1', source: 'n_start', target: 'n_require' },
    { id: 'e2', source: 'n_require', target: 'n_compare' },
    { id: 'e3', source: 'n_compare', target: 'n_end' },
  ],
};

async function main() {
  // 1. Update all BS Check to TB MethodologyTest records
  const tests = await prisma.methodologyTest.findMany({
    where: { name: { contains: 'BS Check to TB' } },
  });
  for (const test of tests) {
    await prisma.methodologyTest.update({
      where: { id: test.id },
      data: { flow: FIXED_FLOW },
    });
    console.log(`Updated flow for test "${test.name}" (${test.id})`);
  }

  // 2. Mark existing garbage executions as failed
  const execs = await prisma.testExecution.findMany({
    where: { testDescription: { contains: 'BS Check to TB' }, status: 'completed' },
    include: { nodeRuns: { where: { label: { contains: 'Compare' } } } },
  });
  for (const exec of execs) {
    // Check if the compare node output is garbage (hypothetical data)
    const compareNode = exec.nodeRuns[0];
    if (compareNode?.output) {
      const raw = (compareNode.output).raw || '';
      if (raw.includes('hypothetical') || raw.includes('Let\'s assume') || raw.includes('For simplicity') || raw.includes('not in a usable format')) {
        await prisma.testExecution.update({
          where: { id: exec.id },
          data: { status: 'failed', errorMessage: 'AI produced hypothetical output instead of actual data comparison. Test reconfigured to use programmatic comparison.' },
        });
        console.log(`Marked execution ${exec.id.slice(0, 8)} as failed (garbage AI output)`);
      }
    }
  }

  console.log('Done');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
