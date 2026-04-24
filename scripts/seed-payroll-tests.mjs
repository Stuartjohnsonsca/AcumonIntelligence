#!/usr/bin/env node
/**
 * Seeds the payroll-suite MethodologyTests (and their backing Action
 * Definitions) for every firm in the DB. Equivalent to a super admin
 * hitting Methodology Admin → Action Pipeline Editor, waiting for the
 * GET-side auto-upsert, then clicking the "Seed" button.
 *
 * The seed functions and SYSTEM_ACTIONS constant live in TS files that
 * expect a compiled context. We invoke them via tsx so we don't have
 * to build the whole Next app just to re-run a seeder.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env manually — tsx doesn't inherit --env-file when run via npx.
try {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '.env');
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const poolerUrl = process.env.DATABASE_URL;
if (!poolerUrl) { console.error('DATABASE_URL missing'); process.exit(1); }
const u = new URL(poolerUrl);
u.searchParams.set('pgbouncer', 'true');
u.searchParams.set('connection_limit', '1');
const prisma = new PrismaClient({
  datasources: { db: { url: u.toString() } },
  log: ['error'],
});

try {
  // Step 1 — mirror ensureSystemActionsUpserted() from the API route.
  // We import SYSTEM_ACTIONS from the TypeScript source via tsx.
  const { SYSTEM_ACTIONS } = await import('../lib/action-seed.ts');
  console.log(`SYSTEM_ACTIONS in code: ${SYSTEM_ACTIONS.length}`);

  let created = 0; let updated = 0;
  for (const def of SYSTEM_ACTIONS) {
    const existing = await prisma.actionDefinition.findFirst({
      where: { firmId: null, code: def.code, version: 1 },
    });
    const data = {
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
    };
    if (existing) {
      await prisma.actionDefinition.update({ where: { id: existing.id }, data: { ...data, firmId: undefined, version: undefined, code: undefined } });
      updated++;
    } else {
      await prisma.actionDefinition.create({ data });
      created++;
    }
  }
  console.log(`action_definitions: ${created} created, ${updated} updated`);

  // Step 2 — seed the three payroll MethodologyTests for every firm.
  const { seedPeriodicPayrollTest } = await import('../lib/periodic-payroll-test-seed.ts');
  const { seedPayrollLeaversTest } = await import('../lib/payroll-leavers-test-seed.ts');
  const { seedPayrollJoinersTest } = await import('../lib/payroll-joiners-test-seed.ts');

  // Also seed the earlier tests the API-side seed button does.
  const { seedAccrualsTest } = await import('../lib/accruals-test-seed.ts');
  const { seedUnrecordedLiabilitiesTest } = await import('../lib/unrecorded-liabilities-test-seed.ts');
  const { seedGrossMarginTest } = await import('../lib/gross-margin-test-seed.ts');

  const firms = await prisma.firm.findMany({ select: { id: true, name: true } });
  console.log(`firms to seed: ${firms.length}`);

  for (const firm of firms) {
    console.log(`\n── ${firm.name} (${firm.id}) ──`);
    for (const [label, fn] of /** @type {[string, (id: string) => Promise<any>][]} */ ([
      ['Periodic Payroll Test',         seedPeriodicPayrollTest],
      ['Payroll Leavers Test',          seedPayrollLeaversTest],
      ['Payroll Joiners Test',          seedPayrollJoinersTest],
      ['Year-End Accruals Test',        seedAccrualsTest],
      ['Unrecorded Liabilities Test',   seedUnrecordedLiabilitiesTest],
      ['Gross Margin Test',             seedGrossMarginTest],
    ])) {
      try {
        const res = await fn(firm.id);
        console.log(`   ${res.created ? 'CREATED' : 'UPDATED'}  ${label}  (${res.testId})`);
      } catch (err) {
        console.error(`   FAILED  ${label}: ${err?.message || err}`);
      }
    }
  }
} catch (err) {
  console.error('Seed failed:', err?.message || err);
  console.error(err?.stack);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
