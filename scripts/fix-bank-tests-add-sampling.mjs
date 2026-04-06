/**
 * Update bank statement test flows to include a sampling step between
 * data load and analysis. The user sees the full population, selects
 * a sample, then the analysis runs on the sampled items.
 *
 * Flow: Start → Load Bank Data → Select Sample (pause) → Analyse → Complete
 *
 * Usage: npx dotenv-cli -e .env.prod -- node scripts/fix-bank-tests-add-sampling.mjs
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const FLOWS = {
  'BS Check to TB': {
    nodes: [
      { id: 'n_start', type: 'start', position: { x: 280, y: 30 }, data: { label: 'Start' } },
      { id: 'n_require', type: 'action', position: { x: 280, y: 130 }, data: { label: 'Load Bank Data', assignee: 'ai', inputType: 'require_prior_evidence', evidenceTag: 'bank_data' } },
      { id: 'n_compare', type: 'action', position: { x: 280, y: 280 }, data: { label: 'Compare Bank to TB', assignee: 'ai', inputType: 'compare_bank_to_tb' } },
      { id: 'n_end', type: 'end', position: { x: 280, y: 400 }, data: { label: 'Complete' } },
    ],
    edges: [
      { id: 'e1', source: 'n_start', target: 'n_require' },
      { id: 'e2', source: 'n_require', target: 'n_compare' },
      { id: 'e3', source: 'n_compare', target: 'n_end' },
    ],
  },
  'BS Cut Off': {
    nodes: [
      { id: 'n_start', type: 'start', position: { x: 280, y: 30 }, data: { label: 'Start' } },
      { id: 'n_require', type: 'action', position: { x: 280, y: 130 }, data: { label: 'Load Bank Data', assignee: 'ai', inputType: 'require_prior_evidence', evidenceTag: 'bank_data' } },
      { id: 'n_sample', type: 'wait', position: { x: 280, y: 250 }, data: { label: 'Select Sample', waitFor: 'sampling', triggerType: 'sampling' } },
      { id: 'n_cutoff', type: 'action', position: { x: 280, y: 380 }, data: { label: 'Analyse Cut Off', assignee: 'ai', inputType: 'analyse_cut_off' } },
      { id: 'n_end', type: 'end', position: { x: 280, y: 500 }, data: { label: 'Complete' } },
    ],
    edges: [
      { id: 'e1', source: 'n_start', target: 'n_require' },
      { id: 'e2', source: 'n_require', target: 'n_sample' },
      { id: 'e3', source: 'n_sample', target: 'n_cutoff' },
      { id: 'e4', source: 'n_cutoff', target: 'n_end' },
    ],
  },
  'BS Large': {
    nodes: [
      { id: 'n_start', type: 'start', position: { x: 280, y: 30 }, data: { label: 'Start' } },
      { id: 'n_require', type: 'action', position: { x: 280, y: 130 }, data: { label: 'Load Bank Data', assignee: 'ai', inputType: 'require_prior_evidence', evidenceTag: 'bank_data' } },
      { id: 'n_sample', type: 'wait', position: { x: 280, y: 250 }, data: { label: 'Select Sample', waitFor: 'sampling', triggerType: 'sampling' } },
      { id: 'n_analyse', type: 'action', position: { x: 280, y: 380 }, data: { label: 'Identify Large & Unusual', assignee: 'ai', inputType: 'analyse_large_unusual' } },
      { id: 'n_end', type: 'end', position: { x: 280, y: 500 }, data: { label: 'Complete' } },
    ],
    edges: [
      { id: 'e1', source: 'n_start', target: 'n_require' },
      { id: 'e2', source: 'n_require', target: 'n_sample' },
      { id: 'e3', source: 'n_sample', target: 'n_analyse' },
      { id: 'e4', source: 'n_analyse', target: 'n_end' },
    ],
  },
};

async function main() {
  for (const [pattern, flow] of Object.entries(FLOWS)) {
    const tests = await prisma.methodologyTest.findMany({
      where: { name: { contains: pattern } },
    });
    for (const t of tests) {
      await prisma.methodologyTest.update({ where: { id: t.id }, data: { flow } });
      console.log(`Updated "${t.name}" with sampling step`);
    }
  }
  console.log('Done');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
