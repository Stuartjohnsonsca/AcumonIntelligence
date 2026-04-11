import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

// GET: Return FAR config + all fixed-asset TB rows for reconciliation
export async function GET(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { farEnabled: true, farAssetType: true, farScope: true, farCategories: true },
  });

  // Get all TB rows — those with farSchedule populated AND those classified as fixed assets (for reconciliation)
  const tbRows = await prisma.auditTBRow.findMany({
    where: { engagementId },
    select: {
      id: true,
      accountCode: true,
      description: true,
      currentYear: true,
      priorYear: true,
      fsLevel: true,
      fsNoteLevel: true,
      fsStatement: true,
      farSchedule: true,
    },
    orderBy: { sortOrder: 'asc' },
  });

  // Filter to fixed-asset-related rows for the reconciliation mapping
  const assetRows = tbRows.filter(r =>
    r.farSchedule ||
    (r.fsLevel && /fixed asset|intangible|tangible|depreciation|amortisation|amortization/i.test(r.fsLevel)) ||
    (r.fsNoteLevel && /fixed asset|intangible|tangible|depreciation|amortisation|amortization/i.test(r.fsNoteLevel))
  );

  return NextResponse.json({
    config: engagement,
    assetRows,
    allRows: tbRows, // full list for flexible category mapping
  });
}

// PUT: Save FAR config + update farSchedule on linked TB rows
export async function PUT(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  const body = await req.json();
  const { farEnabled, farAssetType, farScope, farCategories, categoryData } = body as {
    farEnabled: boolean;
    farAssetType: string;
    farScope: string;
    farCategories: { id: string; name: string; order: number; linkedTbRowIds?: string[] }[];
    categoryData: Record<string, {
      costOpening: number;
      costAdditions: number;
      costTransfers: number;
      costRevaluation: number;
      costDisposals: number;
      depOpening: number;
      depChargeForYear: number;
      depImpairment: number;
      depTransfers: number;
      depDisposals: number;
    }>;
  };

  // Update engagement FAR config
  await prisma.auditEngagement.update({
    where: { id: engagementId },
    data: {
      farEnabled,
      farAssetType: farAssetType || null,
      farScope: farScope || null,
      farCategories: farCategories as any,
    },
  });

  // Clear all existing farSchedule for this engagement
  await prisma.auditTBRow.updateMany({
    where: { engagementId, farSchedule: { not: Prisma.JsonNull } },
    data: { farSchedule: Prisma.JsonNull },
  });

  // Set farSchedule on linked TB rows
  for (const cat of farCategories) {
    const schedule = categoryData[cat.id];
    if (!schedule || !cat.linkedTbRowIds?.length) continue;

    for (const tbRowId of cat.linkedTbRowIds) {
      await prisma.auditTBRow.update({
        where: { id: tbRowId },
        data: { farSchedule: { ...schedule, farCategoryId: cat.id } as any },
      });
    }
  }

  return NextResponse.json({ ok: true });
}
