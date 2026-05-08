// GET /api/internal/handoff/[sessionId]/recipe?clientReference=...
//   → returns the saved navigation recipe for this (firm, vendor, client),
//     or null if first-time. Orchestrator uses it to skip the discovery
//     phase on subsequent imports.
//
// PUT /api/internal/handoff/[sessionId]/recipe
//   Body: { clientReference, recipe }
//   Saves / updates the recipe after a successful import.

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db';
import { verifyOrchestratorSecret } from '@/lib/import-options/internal-auth';

function vendorKeyFromLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  if (!verifyOrchestratorSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { sessionId } = await params;
  const url = new URL(req.url);
  const clientReference = (url.searchParams.get('clientReference') || '').trim();
  if (!clientReference) return NextResponse.json({ error: 'clientReference required' }, { status: 400 });

  const handoff = await prisma.importHandoffSession.findUnique({ where: { id: sessionId } });
  if (!handoff) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const recipe = await prisma.vendorRecipe.findUnique({
    where: {
      firmId_vendorKey_clientReference: {
        firmId: handoff.firmId,
        vendorKey: vendorKeyFromLabel(handoff.vendorLabel),
        clientReference,
      },
    },
  });
  if (!recipe) return NextResponse.json({ recipe: null });

  // Bump usage so we can reason about which recipes are still in active use.
  await prisma.vendorRecipe.update({
    where: { id: recipe.id },
    data: { lastUsedAt: new Date() },
  });

  return NextResponse.json({
    recipe: {
      id: recipe.id,
      version: recipe.version,
      successCount: recipe.successCount,
      data: recipe.recipe,
    },
  });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  if (!verifyOrchestratorSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { sessionId } = await params;
  const body = await req.json().catch(() => ({})) as {
    clientReference?: string;
    recipe?: object;
  };
  if (!body.clientReference || !body.recipe) {
    return NextResponse.json({ error: 'clientReference and recipe required' }, { status: 400 });
  }

  const handoff = await prisma.importHandoffSession.findUnique({ where: { id: sessionId } });
  if (!handoff) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const vendorKey = vendorKeyFromLabel(handoff.vendorLabel);
  const existing = await prisma.vendorRecipe.findUnique({
    where: {
      firmId_vendorKey_clientReference: {
        firmId: handoff.firmId,
        vendorKey,
        clientReference: body.clientReference,
      },
    },
  });

  if (existing) {
    await prisma.vendorRecipe.update({
      where: { id: existing.id },
      data: {
        recipe: body.recipe,
        version: existing.version + 1,
        successCount: existing.successCount + 1,
        lastUsedAt: new Date(),
      },
    });
  } else {
    await prisma.vendorRecipe.create({
      data: {
        id: randomUUID(),
        firmId: handoff.firmId,
        vendorKey,
        clientReference: body.clientReference,
        recipe: body.recipe,
        version: 1,
        successCount: 1,
        lastUsedAt: new Date(),
      },
    });
  }

  return NextResponse.json({ ok: true });
}
