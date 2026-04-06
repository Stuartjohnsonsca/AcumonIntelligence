/**
 * Fix all bank statement tests to use programmatic handlers instead of AI.
 * Also marks garbage executions as failed.
 *
 * Usage: npx dotenv-cli -e .env.prod -- node scripts/fix-bank-statement-tests.mjs
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const FIXED_FLOWS = {
  'BS Cut Off': {
    nodes: [
      { id: 'n_start', type: 'start', position: { x: 280, y: 30 }, data: { label: 'Start' } },
      { id: 'n_require', type: 'action', position: { x: 280, y: 150 }, data: { label: 'Load Bank Data', assignee: 'ai', inputType: 'require_prior_evidence', evidenceTag: 'bank_data' } },
      { id: 'n_cutoff', type: 'action', position: { x: 280, y: 300 }, data: { label: 'Analyse Cut Off', assignee: 'ai', inputType: 'analyse_cut_off' } },
      { id: 'n_end', type: 'end', position: { x: 280, y: 450 }, data: { label: 'Complete' } },
    ],
    edges: [
      { id: 'e1', source: 'n_start', target: 'n_require' },
      { id: 'e2', source: 'n_require', target: 'n_cutoff' },
      { id: 'e3', source: 'n_cutoff', target: 'n_end' },
    ],
  },
  'BS Large': {
    nodes: [
      { id: 'n_start', type: 'start', position: { x: 280, y: 30 }, data: { label: 'Start' } },
      { id: 'n_require', type: 'action', position: { x: 280, y: 150 }, data: { label: 'Load Bank Data', assignee: 'ai', inputType: 'require_prior_evidence', evidenceTag: 'bank_data' } },
      { id: 'n_analyse', type: 'action', position: { x: 280, y: 300 }, data: { label: 'Identify Large & Unusual', assignee: 'ai', inputType: 'analyse_large_unusual' } },
      { id: 'n_end', type: 'end', position: { x: 280, y: 450 }, data: { label: 'Complete' } },
    ],
    edges: [
      { id: 'e1', source: 'n_start', target: 'n_require' },
      { id: 'e2', source: 'n_require', target: 'n_analyse' },
      { id: 'e3', source: 'n_analyse', target: 'n_end' },
    ],
  },
};

async function main() {
  // Fix Cut Off tests
  const cutOffTests = await prisma.methodologyTest.findMany({
    where: { name: { contains: 'Cut Off' } },
  });
  for (const t of cutOffTests) {
    await prisma.methodologyTest.update({ where: { id: t.id }, data: { flow: FIXED_FLOWS['BS Cut Off'] } });
    console.log(`Updated "${t.name}" to programmatic cut-off handler`);
  }

  // Fix Large & Unusual tests
  const largeTests = await prisma.methodologyTest.findMany({
    where: { name: { contains: 'Large' } },
  });
  for (const t of largeTests) {
    await prisma.methodologyTest.update({ where: { id: t.id }, data: { flow: FIXED_FLOWS['BS Large'] } });
    console.log(`Updated "${t.name}" to programmatic large & unusual handler`);
  }

  // Mark garbage AI executions as failed
  const garbageIndicators = ['hypothetical', "let's assume", 'for simplicity', 'not in a usable format', 'i need to clarify'];
  const allExecs = await prisma.testExecution.findMany({
    where: { status: 'completed', testDescription: { contains: 'BS' } },
    include: { nodeRuns: true },
  });
  let fixedCount = 0;
  for (const exec of allExecs) {
    for (const nr of exec.nodeRuns) {
      const raw = (nr.output)?.raw || '';
      if (typeof raw === 'string' && garbageIndicators.some(g => raw.toLowerCase().includes(g))) {
        await prisma.testExecution.update({
          where: { id: exec.id },
          data: { status: 'failed', errorMessage: 'AI produced hypothetical output. Test reconfigured to use programmatic analysis.' },
        });
        console.log(`  Marked exec ${exec.id.slice(0, 8)} (${exec.testDescription}) as failed`);
        fixedCount++;
        break;
      }
    }
  }
  console.log(`\nFixed ${fixedCount} garbage executions`);
}

main().then(() => { console.log('Done'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
