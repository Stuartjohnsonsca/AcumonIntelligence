import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// GET: List all tests for the firm
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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

// POST: Create a new test
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { name, description, testTypeCode, assertions, framework, significantRisk, category, outputFormat, isIngest, flow } = await req.json();
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
  if (updates.flow !== undefined) data.flow = updates.flow;
  if (updates.sortOrder !== undefined) data.sortOrder = updates.sortOrder;
  if (updates.isActive !== undefined) data.isActive = updates.isActive;
  if (updates.executionMode !== undefined) data.executionMode = updates.executionMode;

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
