#!/usr/bin/env node
/**
 * Diagnostic only — no writes. Inspects the DB in DATABASE_URL and
 * reports: which Portal Principal columns exist, which payroll
 * Action Definitions are present, which payroll MethodologyTests
 * exist per firm, and a few sanity counts.
 */
import { PrismaClient } from '@prisma/client';

const poolerUrl = process.env.DATABASE_URL;
if (!poolerUrl) { console.error('DATABASE_URL missing'); process.exit(1); }
const u = new URL(poolerUrl);
u.searchParams.set('pgbouncer', 'true');
u.searchParams.set('connection_limit', '1');

const prisma = new PrismaClient({
  datasources: { db: { url: u.toString() } },
  log: ['error'],
});

function section(title) { console.log(`\n── ${title} ─────────────────────────`); }

try {
  section('DB identity');
  const who = await prisma.$queryRawUnsafe(`SELECT current_database() AS db, inet_server_addr()::text AS host`);
  console.log(who);

  section('Portal Principal schema');
  const engCols = await prisma.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='audit_engagements'
      AND column_name IN (
        'portal_principal_id','portal_escalation_days_1','portal_escalation_days_2',
        'portal_escalation_days_3','portal_setup_completed_at'
      )
    ORDER BY column_name`);
  console.log('audit_engagements Portal Principal cols:', engCols.length, '/ 5 expected');

  const firmCols = await prisma.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='firms' AND column_name LIKE 'default_portal_escalation_%'`);
  console.log('firms default escalation cols:', firmCols.length, '/ 3 expected');

  const newTables = await prisma.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_name IN ('client_portal_staff_members','client_portal_work_allocations')`);
  console.log('New PP tables:', newTables.length, '/ 2 expected');

  const prCols = await prisma.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='portal_requests'
      AND column_name IN ('routing_fs_line_id','routing_tb_account_code','assigned_portal_user_id','assigned_at','escalation_level','escalation_log')`);
  console.log('portal_requests routing cols:', prCols.length, '/ 6 expected');

  section('Payroll action definitions (code-side ships 5 new ones)');
  const actions = await prisma.actionDefinition.findMany({
    where: {
      code: { in: [
        'extract_payroll_data',
        'payroll_totals_to_tb',
        'identify_payroll_movements',
        'request_portal_questions',
        'verify_payroll_movements',
      ] },
      firmId: null,
      isSystem: true,
    },
    select: { code: true, name: true, handlerName: true, updatedAt: true },
    orderBy: { code: 'asc' },
  });
  console.log(actions.length + '/5 payroll actions present in action_definitions');
  for (const a of actions) console.log(`  ${a.code.padEnd(30)} handler=${a.handlerName}`);

  section('Payroll MethodologyTests (per-firm seeded)');
  const tests = await prisma.methodologyTest.findMany({
    where: {
      name: { in: ['Periodic Payroll Test', 'Payroll Leavers Test', 'Payroll Joiners Test'] },
    },
    select: { firmId: true, name: true, executionMode: true, isDraft: true, firm: { select: { name: true } } },
    orderBy: [{ firmId: 'asc' }, { name: 'asc' }],
  });
  console.log(`${tests.length} payroll MethodologyTest rows (3 per firm if seeded)`);
  for (const t of tests) console.log(`  firm=${t.firm?.name || t.firmId} ·  ${t.name}  (${t.executionMode}${t.isDraft ? ', draft' : ''})`);

  section('Firm count / recent engagements');
  const firmCount = await prisma.firm.count();
  const engCount = await prisma.auditEngagement.count();
  console.log(`firms:         ${firmCount}`);
  console.log(`engagements:   ${engCount}`);

  section('Bulk draft test pack (534 rows from test-data CSV)');
  const draftTestCount = await prisma.methodologyTest.count({ where: { isDraft: true } });
  console.log(`draft tests:   ${draftTestCount}`);

  section('Independence gate (earlier feature)');
  const indepCount = await prisma.auditMemberIndependence.count().catch(() => 'table-missing');
  console.log(`member independence rows: ${indepCount}`);
} catch (err) {
  console.error('AUDIT FAILED:', err?.message || err);
} finally {
  await prisma.$disconnect();
}
