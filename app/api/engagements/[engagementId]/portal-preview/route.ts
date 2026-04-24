import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { resolveEscalationDays } from '@/lib/portal-principal';

/**
 * GET /api/engagements/[engagementId]/portal-preview
 *
 * One-hop data bundle for the Portal tab in the audit tool. Returns
 * everything needed to render a read-only replica of the client
 * portal (Home tiles, Principal Dashboard, Manage Staff setup
 * screen) so an auditor can walk a client through the experience
 * during a call without needing portal credentials.
 *
 * Firm-auth'd only — this endpoint never needs a portal token
 * because it reflects the engagement's own state, which the firm
 * user already has access to via the standard engagement guard.
 */
async function verifyEngagementAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const eng = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, clientId: true },
  });
  if (!eng) return null;
  if (eng.firmId !== firmId && !isSuperAdmin) return null;
  return eng;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ engagementId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { engagementId } = await params;
  const access = await verifyEngagementAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Load everything in parallel. Catch-all on each so one missing
  // table (schema-drift) doesn't blank the whole preview.
  const [engagement, staff, allocations, tbAll, requests, firmCatalogue, principal] = await Promise.all([
    prisma.auditEngagement.findUnique({
      where: { id: engagementId },
      select: {
        id: true,
        auditType: true,
        portalPrincipalId: true,
        portalSetupCompletedAt: true,
        client: { select: { id: true, clientName: true } },
        period: { select: { startDate: true, endDate: true } },
      },
    }).catch(() => null) as any,
    prisma.clientPortalStaffMember.findMany({
      where: { engagementId, isActive: true },
      select: { id: true, name: true, email: true, role: true, accessConfirmed: true, portalUserId: true },
      orderBy: [{ accessConfirmed: 'desc' }, { name: 'asc' }],
    }).catch(() => [] as any[]),
    prisma.clientPortalWorkAllocation.findMany({
      where: { engagementId },
      select: { id: true, fsLineId: true, tbAccountCode: true, staff1UserId: true, staff2UserId: true, staff3UserId: true },
    }).catch(() => [] as any[]),
    prisma.auditTBRow.findMany({
      where: { engagementId },
      select: { accountCode: true, description: true, fsLineId: true, fsNoteLevel: true, fsLevel: true, sortOrder: true },
      orderBy: [{ fsLineId: 'asc' }, { sortOrder: 'asc' }, { accountCode: 'asc' }],
    }).catch(() => [] as any[]),
    prisma.portalRequest.findMany({
      where: { engagementId },
      select: {
        id: true,
        section: true,
        question: true,
        status: true,
        requestedAt: true,
        respondedAt: true,
        respondedByName: true,
        routingFsLineId: true,
        routingTbAccountCode: true,
        assignedPortalUserId: true,
        escalationLevel: true,
        evidenceTag: true,
        chatHistory: true,
      },
      orderBy: { requestedAt: 'desc' },
      take: 200,
    }).catch(() => [] as any[]),
    prisma.methodologyFsLine.findMany({
      where: { firmId: access.firmId!, isActive: true },
      select: { id: true, name: true, sortOrder: true },
    }).catch(() => [] as any[]),
    // Principal user details (if designated) — needs a separate
    // lookup because AuditEngagement only stores the ID.
    (async () => {
      const raw = await prisma.auditEngagement.findUnique({
        where: { id: engagementId },
        select: { portalPrincipalId: true },
      }).catch(() => null) as any;
      if (!raw?.portalPrincipalId) return null;
      return prisma.clientPortalUser.findUnique({
        where: { id: raw.portalPrincipalId },
        select: { id: true, name: true, email: true, role: true },
      }).catch(() => null);
    })(),
  ]);

  // Resolve FS Line groups the same way the real portal does —
  // canonical fsLineId → TBCYvPY fsNoteLevel, dropping blank-
  // description rows and unclassified-entirely rows.
  const fsByName = new Map<string, { id: string; name: string }>();
  for (const f of firmCatalogue) fsByName.set((f.name || '').trim().toLowerCase(), f);
  interface FsGroup {
    fsLineId: string | null;
    fsLineName: string;
    sortOrder: number;
    tbRows: Array<{ accountCode: string; description: string }>;
  }
  const grouped = new Map<string, FsGroup>();
  for (const r of tbAll) {
    const desc = (r.description || '').trim();
    if (!desc) continue;
    let resolvedId = r.fsLineId ?? null;
    if (!resolvedId && r.fsNoteLevel) resolvedId = fsByName.get(r.fsNoteLevel.trim().toLowerCase())?.id ?? null;
    if (!resolvedId && r.fsLevel)     resolvedId = fsByName.get(r.fsLevel.trim().toLowerCase())?.id ?? null;
    if (!resolvedId && !r.fsNoteLevel && !r.fsLevel) continue;
    const groupKey = resolvedId || `note:${(r.fsNoteLevel || '').trim()}`;
    const fsRow = resolvedId ? firmCatalogue.find(f => f.id === resolvedId) : null;
    const fsName = fsRow?.name ?? r.fsNoteLevel ?? 'Unclassified';
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        fsLineId: resolvedId,
        fsLineName: fsName,
        sortOrder: fsRow?.sortOrder ?? 9999,
        tbRows: [],
      });
    }
    grouped.get(groupKey)!.tbRows.push({ accountCode: r.accountCode, description: desc });
  }
  const fsLineGroups = [...grouped.values()].sort((a, b) => a.sortOrder - b.sortOrder);

  const escalationDays = await resolveEscalationDays(engagementId);

  return NextResponse.json({
    engagement,
    principal,
    staff,
    allocations,
    fsLineGroups,
    requests,
    escalationDays,
  });
}
