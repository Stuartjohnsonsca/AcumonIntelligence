// One-off runner: seeds the three pipeline Tests (Year-End Accruals,
// Unrecorded Liabilities, Gross Margin Analytical Review) and the 10
// new system Actions for every active firm in the database.
//
// Mirrors what `POST /api/methodology-admin/action-definitions`
// (action: 'seed') does inside the running app, but runnable via
// Node + the prod DB creds so we don't need a logged-in super-admin
// session to bootstrap a newly-migrated database.
//
// Safe to re-run: every piece uses upsert / delete-then-recreate by
// a unique natural key.

/* eslint-disable no-console */

// Compile the TypeScript seed modules on demand. We use ts-node's
// transpile-only mode so we don't have to pre-build the whole app.
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'commonjs',
    target: 'es2020',
    esModuleInterop: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    moduleResolution: 'node',
  },
});
// Manual module resolver hook for `@/` — the Next.js path alias.
// We avoid requiring `tsconfig-paths` (not installed) by tagging the
// CJS resolver directly: any request starting with `@/` gets rewritten
// to an absolute path relative to the project root.
const Module = require('module');
const path = require('path');
const projectRoot = path.resolve(__dirname, '..');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (typeof request === 'string' && request.startsWith('@/')) {
    const rewritten = path.join(projectRoot, request.slice(2));
    return origResolve.call(this, rewritten, ...rest);
  }
  return origResolve.call(this, request, ...rest);
};

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function upsertSystemActions() {
  const { SYSTEM_ACTIONS } = require('../lib/action-seed.ts');
  let created = 0;
  let updated = 0;
  for (const def of SYSTEM_ACTIONS) {
    const existing = await prisma.actionDefinition.findFirst({
      where: { firmId: null, code: def.code, version: 1 },
    });
    if (existing) {
      const changed =
        existing.name !== def.name ||
        existing.description !== def.description ||
        existing.category !== def.category ||
        existing.handlerName !== (def.handlerName || null) ||
        existing.icon !== (def.icon || null) ||
        existing.color !== (def.color || null) ||
        JSON.stringify(existing.inputSchema) !== JSON.stringify(def.inputSchema) ||
        JSON.stringify(existing.outputSchema) !== JSON.stringify(def.outputSchema);
      if (changed) {
        await prisma.actionDefinition.update({
          where: { id: existing.id },
          data: {
            name: def.name,
            description: def.description,
            category: def.category,
            inputSchema: def.inputSchema,
            outputSchema: def.outputSchema,
            handlerName: def.handlerName || null,
            icon: def.icon || null,
            color: def.color || null,
            isActive: true,
            isSystem: true,
          },
        });
        updated++;
      }
    } else {
      await prisma.actionDefinition.create({
        data: {
          firmId: null,
          code: def.code,
          name: def.name,
          description: def.description,
          category: def.category,
          version: 1,
          inputSchema: def.inputSchema,
          outputSchema: def.outputSchema,
          handlerName: def.handlerName || null,
          icon: def.icon || null,
          color: def.color || null,
          isSystem: true,
          isActive: true,
        },
      });
      created++;
    }
  }
  return { created, updated, total: SYSTEM_ACTIONS.length };
}

async function main() {
  console.log('─── Phase 1: upsert SYSTEM_ACTIONS ─────────────────────────────');
  const actionResult = await upsertSystemActions();
  console.log(`SYSTEM_ACTIONS → total=${actionResult.total} created=${actionResult.created} updated=${actionResult.updated}`);

  console.log('\n─── Phase 2: seed pipeline Tests per firm ──────────────────────');
  const firms = await prisma.firm.findMany({ select: { id: true, name: true } });
  console.log(`Found ${firms.length} firm(s) to seed.`);

  const { seedAccrualsTest } = require('../lib/accruals-test-seed.ts');
  const { seedUnrecordedLiabilitiesTest } = require('../lib/unrecorded-liabilities-test-seed.ts');
  const { seedGrossMarginTest } = require('../lib/gross-margin-test-seed.ts');

  const seeds = [
    { name: 'Year-End Accruals Test', fn: seedAccrualsTest },
    { name: 'Unrecorded Liabilities Test', fn: seedUnrecordedLiabilitiesTest },
    { name: 'Gross Margin Analytical Review', fn: seedGrossMarginTest },
  ];

  for (const firm of firms) {
    console.log(`\nFirm: ${firm.name} (${firm.id})`);
    for (const s of seeds) {
      try {
        const r = await s.fn(firm.id);
        console.log(`  ✓ ${s.name}: ${r.created ? 'created' : 'updated'} (testId=${r.testId})`);
      } catch (err) {
        console.error(`  ✗ ${s.name} failed: ${err.message}`);
      }
    }
  }

  console.log('\nDone.');
}

main()
  .catch(err => { console.error('Seed failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
