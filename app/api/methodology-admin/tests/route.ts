import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// GET: List all tests for the firm, or single test with steps
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const testId = url.searchParams.get('id');
  const includeSteps = url.searchParams.get('includeSteps') === 'true';

  // Single test with action steps
  if (testId && includeSteps) {
    const test = await prisma.methodologyTest.findFirst({
      where: { id: testId, firmId: session.user.firmId },
      include: {
        actionSteps: {
          include: { actionDefinition: true },
          orderBy: { stepOrder: 'asc' },
        },
      },
    });
    if (!test) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ test });
  }

  const tests = await prisma.methodologyTest.findMany({
    where: { firmId: session.user.firmId, isActive: true },
    include: {
      allocations: {
        include: {
          fsLine: { select: { id: true, name: true, lineType: true, fsCategory: true } },
          industry: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  return NextResponse.json({ tests });
}

// POST: Create a new test (or duplicate an existing one with its full
// pipeline). When `duplicateFromId` is supplied, the new test is
// created as a deep copy of the source: every metadata field, the
// action-pipeline steps (with their inputBindings + branchRules),
// the per-test editorConfig, the pipelineConfigSchema, and the
// legacy `flow` JSON for tests still on the FlowChart execution
// mode. The new row defaults to draft + a "(Copy)" suffix unless
// the caller overrides them.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { duplicateFromId } = body;

  if (duplicateFromId) {
    const source = await prisma.methodologyTest.findFirst({
      where: { id: duplicateFromId, firmId: session.user.firmId },
      include: { actionSteps: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!source) return NextResponse.json({ error: 'Source test not found' }, { status: 404 });

    // Find a name that doesn't collide with an existing test for the
    // firm — Methodology Admins can copy a test repeatedly while
    // they iterate on a variant. Suffixes are " (Copy)", " (Copy 2)",
    // " (Copy 3)" and so on.
    const desiredBase = (body.name || `${source.name} (Copy)`).trim();
    let finalName = desiredBase;
    for (let i = 2; i < 50; i++) {
      const exists = await prisma.methodologyTest.findFirst({
        where: { firmId: session.user.firmId, name: finalName },
        select: { id: true },
      });
      if (!exists) break;
      finalName = `${desiredBase.replace(/\s*\(Copy(?:\s+\d+)?\)\s*$/, '')} (Copy ${i})`;
    }

    const created = await prisma.$transaction(async tx => {
      const newTest = await tx.methodologyTest.create({
        data: {
          firmId: session.user.firmId,
          name: finalName,
          description: source.description,
          testTypeCode: source.testTypeCode,
          assertions: (source.assertions as any) ?? [],
          framework: source.framework,
          significantRisk: source.significantRisk,
          category: source.category,
          outputFormat: source.outputFormat,
          isIngest: source.isIngest,
          // Duplicates always start as drafts so they don't accidentally
          // ship copies of an in-use test before the Methodology Admin
          // has reviewed them.
          isDraft: true,
          executionMode: source.executionMode,
          flow: (source.flow as any) ?? null,
          pipelineConfigSchema: (source.pipelineConfigSchema as any) ?? null,
          editorConfig: (source.editorConfig as any) ?? null,
          sortOrder: source.sortOrder,
        },
      });
      if (source.actionSteps.length > 0) {
        await tx.testActionStep.createMany({
          data: source.actionSteps.map(s => ({
            testId: newTest.id,
            actionDefinitionId: s.actionDefinitionId,
            stepOrder: s.stepOrder,
            inputBindings: (s.inputBindings as any) ?? {},
            configOverrides: (s.configOverrides as any) ?? null,
            branchRules: (s.branchRules as any) ?? null,
            isActive: s.isActive,
          })),
        });
      }
      return tx.methodologyTest.findUnique({
        where: { id: newTest.id },
        include: {
          allocations: { include: { fsLine: true, industry: true } },
          actionSteps: { include: { actionDefinition: true }, orderBy: { stepOrder: 'asc' } },
        },
      });
    });

    return NextResponse.json({ test: created });
  }

  const { name, description, testTypeCode, assertions, framework, significantRisk, category, outputFormat, isIngest, isDraft, flow } = body;
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  // Resolve category: prefer explicit category, fall back to significantRisk boolean for backward compat
  const resolvedCategory = category || (significantRisk ? 'Significant Risk' : 'Other');

  const test = await prisma.methodologyTest.create({
    data: {
      firmId: session.user.firmId,
      name: name.trim(),
      description: description?.trim() || null,
      testTypeCode: testTypeCode || '',
      assertions: assertions || [],
      framework: framework || 'ALL',
      significantRisk: resolvedCategory === 'Significant Risk', // Keep in sync for backward compat
      category: resolvedCategory,
      outputFormat: outputFormat || 'three_section_no_sampling',
      isIngest: isIngest || false,
      // New tests default to draft so they don't appear in any engagement's
      // audit plan until the Methodology Admin has finished building them
      // and explicitly toggles the Draft flag off.
      isDraft: isDraft !== undefined ? !!isDraft : true,
      // All new tests default to the Action Pipeline execution mode. The
      // legacy Flow Chart mode is still executable for existing tests (as
      // a fallback) but no new flow tests should be created. Callers can
      // still pass a non-null `flow` if they explicitly need a legacy
      // flow test, but the default path always yields a pipeline test.
      executionMode: 'action_pipeline',
      flow: flow || null,
    },
  });

  return NextResponse.json({ test });
}

// PATCH: Update a test
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id, ...updates } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const data: Record<string, any> = {};
  if (updates.name !== undefined) data.name = updates.name.trim();
  if (updates.description !== undefined) data.description = updates.description;
  if (updates.testTypeCode !== undefined) data.testTypeCode = updates.testTypeCode;
  if (updates.assertions !== undefined) data.assertions = updates.assertions;
  if (updates.framework !== undefined) data.framework = updates.framework;
  if (updates.significantRisk !== undefined) data.significantRisk = updates.significantRisk;
  if (updates.category !== undefined) {
    data.category = updates.category;
    data.significantRisk = updates.category === 'Significant Risk'; // Keep in sync
  }
  if (updates.outputFormat !== undefined) data.outputFormat = updates.outputFormat || 'three_section_no_sampling';
  if (updates.isIngest !== undefined) data.isIngest = updates.isIngest;
  if (updates.isDraft !== undefined) data.isDraft = !!updates.isDraft;
  if (updates.flow !== undefined) data.flow = updates.flow;
  if (updates.sortOrder !== undefined) data.sortOrder = updates.sortOrder;
  if (updates.isActive !== undefined) data.isActive = updates.isActive;
  if (updates.executionMode !== undefined) data.executionMode = updates.executionMode;
  if (updates.editorConfig !== undefined) data.editorConfig = updates.editorConfig;

  // Handle action pipeline steps
  if (updates.actionSteps !== undefined) {
    // Delete existing steps and recreate
    await prisma.testActionStep.deleteMany({ where: { testId: id } });
    if (Array.isArray(updates.actionSteps) && updates.actionSteps.length > 0) {
      await prisma.testActionStep.createMany({
        data: updates.actionSteps.map((step: any, i: number) => ({
          testId: id,
          actionDefinitionId: step.actionDefinitionId,
          stepOrder: step.stepOrder ?? i,
          inputBindings: step.inputBindings || {},
          branchRules: step.branchRules ?? null,
        })),
      });
    }
  }

  const test = await prisma.methodologyTest.update({
    where: { id },
    data,
    include: {
      allocations: { include: { fsLine: true, industry: true } },
      actionSteps: { include: { actionDefinition: true }, orderBy: { stepOrder: 'asc' } },
    },
  });

  return NextResponse.json({ test });
}

// DELETE: Delete a test
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await req.json();
  await prisma.methodologyTest.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
