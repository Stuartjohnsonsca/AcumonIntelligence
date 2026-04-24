import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { SYSTEM_ACTIONS } from '@/lib/action-seed';
import { seedAccrualsTest } from '@/lib/accruals-test-seed';
import { seedUnrecordedLiabilitiesTest } from '@/lib/unrecorded-liabilities-test-seed';
import { seedGrossMarginTest } from '@/lib/gross-margin-test-seed';
import { seedPeriodicPayrollTest } from '@/lib/periodic-payroll-test-seed';
import { seedPayrollLeaversTest } from '@/lib/payroll-leavers-test-seed';
import { seedPayrollJoinersTest } from '@/lib/payroll-joiners-test-seed';
import { seedBulkDraftTests, type BulkSeedResult } from '@/lib/bulk-draft-test-seed';

/**
 * Idempotent upsert of SYSTEM_ACTIONS into action_definitions. Runs on
 * every GET so new actions we ship in code appear in the Methodology
 * Admin's Action Pipeline Editor catalog without anyone having to click
 * a "seed" button first. Steady-state cost is one findFirst per system
 * action; we only write when something is missing or a handlerName has
 * changed. Failures are swallowed so a seed error never hides the
 * existing catalog from the user.
 */
async function ensureSystemActionsUpserted() {
  try {
    for (const def of SYSTEM_ACTIONS) {
      const existing = await prisma.actionDefinition.findFirst({
        where: { firmId: null, code: def.code, version: 1 },
      });
      if (!existing) {
        await prisma.actionDefinition.create({
          data: {
            firmId: null,
            code: def.code,
            name: def.name,
            description: def.description,
            category: def.category,
            version: 1,
            inputSchema: def.inputSchema as any,
            outputSchema: def.outputSchema as any,
            handlerName: def.handlerName || null,
            icon: def.icon || null,
            color: def.color || null,
            isSystem: true,
            isActive: true,
          },
        });
        continue;
      }
      // Refresh schema/handler fields if the code-side definition has
      // drifted. This lets us ship action updates without forcing a
      // manual re-seed each time.
      const needsUpdate =
        existing.name !== def.name ||
        existing.description !== def.description ||
        existing.category !== def.category ||
        existing.handlerName !== (def.handlerName || null) ||
        existing.icon !== (def.icon || null) ||
        existing.color !== (def.color || null) ||
        JSON.stringify(existing.inputSchema) !== JSON.stringify(def.inputSchema) ||
        JSON.stringify(existing.outputSchema) !== JSON.stringify(def.outputSchema);
      if (needsUpdate) {
        await prisma.actionDefinition.update({
          where: { id: existing.id },
          data: {
            name: def.name,
            description: def.description,
            category: def.category,
            inputSchema: def.inputSchema as any,
            outputSchema: def.outputSchema as any,
            handlerName: def.handlerName || null,
            icon: def.icon || null,
            color: def.color || null,
            isActive: true,
          },
        });
      }
    }
  } catch (err) {
    console.error('[action-definitions] system action upsert failed:', err);
  }
}

// GET: List all action definitions (system + firm-specific)
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Auto-upsert SYSTEM_ACTIONS before listing so new code-side actions
  // (e.g. Verify UK Property Assets) show up in the catalog automatically.
  await ensureSystemActionsUpserted();

  const actions = await prisma.actionDefinition.findMany({
    where: {
      OR: [
        { firmId: null, isSystem: true },
        { firmId: session.user.firmId },
      ],
      isActive: true,
    },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });

  return NextResponse.json({ actions });
}

// POST: Create a new action definition OR seed system actions
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();

  // Seed mode: create/update all system actions
  if (body.action === 'seed') {
    if (!session.user.isSuperAdmin) {
      return NextResponse.json({ error: 'Only super admins can seed system actions' }, { status: 403 });
    }
    let created = 0;
    let updated = 0;
    // Also seed the Year-End Accruals Test for this firm after action
    // definitions are in place. Runs in a try so a seed error doesn't
    // block the action-definition upsert the admin is actually asking for.
    let accrualsTestResult: { testId: string; created: boolean } | { error: string } | null = null;
    let unrecordedLiabilitiesTestResult: { testId: string; created: boolean } | { error: string } | null = null;
    let grossMarginTestResult: { testId: string; created: boolean } | { error: string } | null = null;
    let periodicPayrollTestResult: { testId: string; created: boolean } | { error: string } | null = null;
    let payrollLeaversTestResult: { testId: string; created: boolean } | { error: string } | null = null;
    let payrollJoinersTestResult: { testId: string; created: boolean } | { error: string } | null = null;
    let bulkDraftTestsResult: BulkSeedResult | { error: string } | null = null;
    for (const def of SYSTEM_ACTIONS) {
      const existing = await prisma.actionDefinition.findFirst({
        where: { firmId: null, code: def.code, version: 1 },
      });
      if (existing) {
        await prisma.actionDefinition.update({
          where: { id: existing.id },
          data: {
            name: def.name,
            description: def.description,
            category: def.category,
            inputSchema: def.inputSchema as any,
            outputSchema: def.outputSchema as any,
            handlerName: def.handlerName || null,
            icon: def.icon || null,
            color: def.color || null,
            isSystem: true,
          },
        });
        updated++;
      } else {
        await prisma.actionDefinition.create({
          data: {
            firmId: null,
            code: def.code,
            name: def.name,
            description: def.description,
            category: def.category,
            version: 1,
            inputSchema: def.inputSchema as any,
            outputSchema: def.outputSchema as any,
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
    try {
      accrualsTestResult = await seedAccrualsTest(session.user.firmId);
    } catch (err: any) {
      console.error('[seed] seedAccrualsTest failed:', err);
      accrualsTestResult = { error: err?.message || 'Accruals test seed failed' };
    }
    try {
      unrecordedLiabilitiesTestResult = await seedUnrecordedLiabilitiesTest(session.user.firmId);
    } catch (err: any) {
      console.error('[seed] seedUnrecordedLiabilitiesTest failed:', err);
      unrecordedLiabilitiesTestResult = { error: err?.message || 'Unrecorded liabilities test seed failed' };
    }
    try {
      grossMarginTestResult = await seedGrossMarginTest(session.user.firmId);
    } catch (err: any) {
      console.error('[seed] seedGrossMarginTest failed:', err);
      grossMarginTestResult = { error: err?.message || 'Gross margin test seed failed' };
    }
    try {
      periodicPayrollTestResult = await seedPeriodicPayrollTest(session.user.firmId);
    } catch (err: any) {
      console.error('[seed] seedPeriodicPayrollTest failed:', err);
      periodicPayrollTestResult = { error: err?.message || 'Periodic payroll test seed failed' };
    }
    try {
      payrollLeaversTestResult = await seedPayrollLeaversTest(session.user.firmId);
    } catch (err: any) {
      console.error('[seed] seedPayrollLeaversTest failed:', err);
      payrollLeaversTestResult = { error: err?.message || 'Payroll leavers test seed failed' };
    }
    try {
      payrollJoinersTestResult = await seedPayrollJoinersTest(session.user.firmId);
    } catch (err: any) {
      console.error('[seed] seedPayrollJoinersTest failed:', err);
      payrollJoinersTestResult = { error: err?.message || 'Payroll joiners test seed failed' };
    }
    // Bulk draft-test pack — 534 rows from lib/test-data/draft-test-bank.csv.
    // All rows land as isDraft: true, so they're hidden from engagement plans
    // until the Methodology Admin reviews and publishes them.
    if (body.includeBulkDrafts === true) {
      try {
        bulkDraftTestsResult = await seedBulkDraftTests(session.user.firmId);
      } catch (err: any) {
        console.error('[seed] seedBulkDraftTests failed:', err);
        bulkDraftTestsResult = { error: err?.message || 'Bulk draft tests seed failed' };
      }
    }
    return NextResponse.json({
      ok: true,
      created,
      updated,
      accrualsTest: accrualsTestResult,
      unrecordedLiabilitiesTest: unrecordedLiabilitiesTestResult,
      grossMarginTest: grossMarginTestResult,
      periodicPayrollTest: periodicPayrollTestResult,
      payrollLeaversTest: payrollLeaversTestResult,
      payrollJoinersTest: payrollJoinersTestResult,
      bulkDraftTests: bulkDraftTestsResult,
    });
  }

  // Normal create: firm-specific action
  const { code, name, description, category, inputSchema, outputSchema, icon, color, internalFlow } = body;
  if (!code?.trim() || !name?.trim()) {
    return NextResponse.json({ error: 'Code and name are required' }, { status: 400 });
  }

  const action = await prisma.actionDefinition.create({
    data: {
      firmId: session.user.firmId,
      code: code.trim(),
      name: name.trim(),
      description: description?.trim() || null,
      category: category || 'general',
      version: 1,
      inputSchema: inputSchema || [],
      outputSchema: outputSchema || [],
      internalFlow: internalFlow || null,
      icon: icon || null,
      color: color || null,
      isSystem: false,
      isActive: true,
    },
  });

  return NextResponse.json({ action }, { status: 201 });
}

// PATCH: Update an action definition
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id, ...updates } = await req.json();
  if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });

  const existing = await prisma.actionDefinition.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.isSystem && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Cannot modify system actions' }, { status: 403 });
  }
  if (existing.firmId && existing.firmId !== session.user.firmId && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const action = await prisma.actionDefinition.update({
    where: { id },
    data: {
      ...(updates.name !== undefined && { name: updates.name }),
      ...(updates.description !== undefined && { description: updates.description }),
      ...(updates.category !== undefined && { category: updates.category }),
      ...(updates.inputSchema !== undefined && { inputSchema: updates.inputSchema }),
      ...(updates.outputSchema !== undefined && { outputSchema: updates.outputSchema }),
      ...(updates.icon !== undefined && { icon: updates.icon }),
      ...(updates.color !== undefined && { color: updates.color }),
      ...(updates.internalFlow !== undefined && { internalFlow: updates.internalFlow }),
      ...(updates.isActive !== undefined && { isActive: updates.isActive }),
    },
  });

  return NextResponse.json({ action });
}

// DELETE: Soft-delete an action definition
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });

  const existing = await prisma.actionDefinition.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.isSystem) return NextResponse.json({ error: 'Cannot delete system actions' }, { status: 403 });
  if (existing.firmId && existing.firmId !== session.user.firmId && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await prisma.actionDefinition.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
