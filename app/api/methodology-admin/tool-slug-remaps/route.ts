/**
 * Per-firm slug-remap registry for tool-wired schedule questions.
 *
 *   GET    → { remaps: ToolSlugRemap[] }
 *   POST   → upsert one (body shape: ToolSlugRemap)
 *   DELETE → remove one (body: { toolName, templateType, originalSlug, originalColumn? })
 *
 * Reads are open to any authenticated user on the firm — the registry
 * is consulted by every tool that needs to read a schedule answer
 * (VAT Reconciliation today; future calculators in turn). Writes are
 * gated to Methodology Admin / Super Admin so only the people who can
 * also edit the schedule itself can rewire its tools.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  parseRemaps,
  upsertRemap,
  removeRemap,
  type ToolSlugRemap,
} from '@/lib/tool-slug-remap';

async function loadRemaps(firmId: string): Promise<ToolSlugRemap[]> {
  const firm = await prisma.firm.findUnique({
    where: { id: firmId },
    select: { methodologyToolSlugRemaps: true },
  });
  return parseRemaps(firm?.methodologyToolSlugRemaps);
}

async function saveRemaps(firmId: string, remaps: ToolSlugRemap[]): Promise<void> {
  await prisma.firm.update({
    where: { id: firmId },
    data: { methodologyToolSlugRemaps: remaps as any },
  });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const firmId = session.user.firmId;
  if (!firmId) return NextResponse.json({ remaps: [] });
  const remaps = await loadRemaps(firmId);
  return NextResponse.json({ remaps });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const firmId = session.user.firmId;
  if (!firmId) return NextResponse.json({ error: 'No firm context' }, { status: 400 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
  const next: ToolSlugRemap = {
    toolName: String(body.toolName || '').trim(),
    templateType: String(body.templateType || '').trim(),
    originalSlug: String(body.originalSlug || '').trim(),
    originalColumn: typeof body.originalColumn === 'number' ? body.originalColumn : undefined,
    replacementSlug: String(body.replacementSlug || '').trim(),
    replacementColumn: typeof body.replacementColumn === 'number' ? body.replacementColumn : undefined,
  };
  if (!next.toolName || !next.templateType || !next.originalSlug || !next.replacementSlug) {
    return NextResponse.json({ error: 'toolName, templateType, originalSlug, replacementSlug are all required' }, { status: 400 });
  }

  const current = await loadRemaps(firmId);
  const updated = upsertRemap(current, next);
  await saveRemaps(firmId, updated);
  return NextResponse.json({ remaps: updated });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const firmId = session.user.firmId;
  if (!firmId) return NextResponse.json({ error: 'No firm context' }, { status: 400 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
  const match = {
    toolName: String(body.toolName || '').trim(),
    templateType: String(body.templateType || '').trim(),
    originalSlug: String(body.originalSlug || '').trim(),
    originalColumn: typeof body.originalColumn === 'number' ? body.originalColumn : undefined,
  };
  if (!match.toolName || !match.templateType || !match.originalSlug) {
    return NextResponse.json({ error: 'toolName, templateType, originalSlug are required' }, { status: 400 });
  }

  const current = await loadRemaps(firmId);
  const updated = removeRemap(current, match);
  await saveRemaps(firmId, updated);
  return NextResponse.json({ remaps: updated });
}
