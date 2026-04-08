import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { SYSTEM_ACTIONS } from '@/lib/action-seed';

// GET: List all action definitions (system + firm-specific)
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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
    return NextResponse.json({ ok: true, created, updated });
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
