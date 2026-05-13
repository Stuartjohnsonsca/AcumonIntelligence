import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { logEngagementAction, resolveActor } from '@/lib/engagement-action-log';
import {
  AUDIT_POINT_SAFE_SELECT,
  AUDIT_POINT_MINIMAL_SELECT,
  isMissingMigrationColumn,
  stripMigrationFields,
} from '@/lib/audit-points-select';

// Run a write with the FULL safe-select; on missing-column error, drop
// migration-only fields from both data and projection and retry. Logs
// once so the missing migration is visible in Vercel logs.
async function writeWithFallback<T>(
  full: () => Promise<T>,
  minimal: () => Promise<T>,
  ctx: string,
): Promise<T> {
  try {
    return await full();
  } catch (err: any) {
    if (!isMissingMigrationColumn(err)) throw err;
    console.warn(`[audit-points] ${ctx}: missing migration columns — retrying with minimal projection. Run prisma/migrations/manual/2026-04-22-audit-points-colour-links.sql in Supabase to silence this.`);
    return minimal();
  }
}

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

// Role hierarchy used by the authority gate on
// commit/cancel/reject of management & representation points. A user
// can only override another user's commit/reject decision if their
// rank is >= the original decider's rank. Super admins bypass.
const ROLE_RANK: Record<string, number> = {
  Junior: 0,
  Manager: 1,
  RI: 2,
  Reviewer: 2,
  Partner: 3,
  EQR: 4,
};

// Resolve a team member's role on the engagement, defaulting to 'Junior'
// (lowest) when they aren't a member. Used by the management/rep
// status flows to stamp closedByName with the role and to enforce the
// authority gate on later overrides.
async function resolveTeamRole(engagementId: string, userId: string): Promise<string> {
  const member = await prisma.auditTeamMember.findFirst({
    where: { engagementId, userId },
    select: { role: true },
  });
  return member?.role || 'Junior';
}

// Parse the role suffix from a stamped closedByName string like
// "Jane Smith (Partner)". Returns null when the pattern isn't found —
// older entries without the suffix end up here, which the authority
// gate treats as "unknown rank, allow override" so legacy data can
// always be edited.
function parseRoleFromStampedName(name: string | null | undefined): string | null {
  if (!name) return null;
  const match = name.match(/\(([^)]+)\)\s*$/);
  return match ? match[1].trim() : null;
}

// True when caller has authority >= the rank of the user who set the
// existing status. Super admin always wins. If we can't parse the
// previous decider's role (legacy data), allow.
function hasAuthorityToOverride(callerRole: string, isSuperAdmin: boolean, previousCloserName: string | null | undefined): boolean {
  if (isSuperAdmin) return true;
  const previousRole = parseRoleFromStampedName(previousCloserName);
  if (!previousRole) return true; // unknown → permissive
  const callerRank = ROLE_RANK[callerRole] ?? 0;
  const previousRank = ROLE_RANK[previousRole] ?? 0;
  return callerRank >= previousRank;
}

// GET: List audit points by type
export async function GET(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(req.url);
  const pointType = url.searchParams.get('type');
  const status = url.searchParams.get('status');

  const where: any = { engagementId };
  if (pointType) where.pointType = pointType;
  if (status) where.status = status;

  // Explicit select because production Supabase may be missing the
  // colour / linked_from_* columns from the 2026-04-22 migration.
  // writeWithFallback retries with the minimal projection if the full
  // one trips a missing-column error. The outer try/catch is a final
  // safety net for any other unexpected drift — better an empty panel
  // than a 500 that hides the rest of the page.
  // Newest activity first: most recently updated wins. updatedAt ticks
  // on every response/close/colour change so an item that got a new
  // reply this morning rises above a quieter one. Closed items still
  // appear but sink to the bottom via the status sort.
  let points: any[] = [];
  try {
    points = await writeWithFallback(
      () => prisma.auditPoint.findMany({ where, orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }], select: AUDIT_POINT_SAFE_SELECT }),
      () => prisma.auditPoint.findMany({ where, orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }], select: AUDIT_POINT_MINIMAL_SELECT }),
      'GET findMany',
    );
  } catch (err: any) {
    console.error('[audit-points] findMany failed — returning empty list:', err?.message || err);
    points = [];
  }

  return NextResponse.json({ points });
}

// POST: Create new audit point
export async function POST(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  // EQR users are allowed into this route but only for review_point pointType.
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session, { allowEQR: true });
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { pointType, description, heading, body: bodyText, reference, attachments, assignedToUserId } = body;

  if (!pointType || !description?.trim()) {
    return NextResponse.json({ error: 'pointType and description required' }, { status: 400 });
  }

  // Additional EQR restriction: they can only create review points.
  if (__eqrGuard.role === 'EQR' && pointType !== 'review_point') {
    return NextResponse.json({ error: 'EQR users can only raise review points' }, { status: 403 });
  }

  // Auto-assign chat number (max + 1 for this type in this engagement)
  const maxChat = await prisma.auditPoint.aggregate({
    where: { engagementId, pointType },
    _max: { chatNumber: true },
  });
  const chatNumber = (maxChat._max.chatNumber || 0) + 1;

  // Resolve the assignee at create time when supplied — same lookup
  // the 'assign' PATCH action uses so the role cache stays in sync.
  let assignee: { id?: string; name?: string; role?: string } = {};
  if (assignedToUserId) {
    const member = await prisma.auditTeamMember.findFirst({
      where: { engagementId, userId: String(assignedToUserId) },
      select: { userId: true, role: true, user: { select: { name: true, email: true } } },
    });
    if (member) {
      assignee = {
        id: member.userId,
        name: member.user?.name || member.user?.email || undefined,
        role: member.role,
      };
    }
  }

  // Explicit select on writes for the same reason as the GET handler:
  // production Supabase may be missing migration-only columns
  // (colour / linked_from_* / assignee fields / status_history).
  // writeWithFallback retries with the minimal projection if any of
  // those columns are missing, so the create still succeeds.
  const createData: any = {
    engagementId,
    pointType,
    chatNumber,
    // Default new points to the open workflow status. Legacy 'new'
    // is retained for review_point / ri_matter back-compat but the
    // management/representation flow starts with 'open' so the
    // status dropdown matches the user-facing labels.
    status: pointType === 'management' || pointType === 'representation' ? 'open' : 'new',
    description: description.trim(),
    heading: heading || null,
    body: bodyText || null,
    reference: reference || null,
    attachments: attachments || null,
    createdById: session.user.id,
    createdByName: session.user.name || session.user.email || '',
    assignedToUserId: assignee.id || null,
    assignedToName: assignee.name || null,
    assignedToRole: assignee.role || null,
  };
  const point = await writeWithFallback(
    () => prisma.auditPoint.create({ data: createData, select: AUDIT_POINT_SAFE_SELECT }),
    () => prisma.auditPoint.create({ data: stripMigrationFields(createData), select: AUDIT_POINT_MINIMAL_SELECT }),
    'POST create',
  );

  return NextResponse.json({ point });
}

// PATCH: Update point (add response, close, commit, cancel)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  // EQR users may respond/close/update on review_point points only.
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session, { allowEQR: true });
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { id, action } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // Same drift safety as the writes below — production may be missing
  // `colour` / `linked_from_*`. Read with full projection and fall back
  // to minimal if those columns aren't there.
  const existing = await writeWithFallback(
    () => prisma.auditPoint.findUnique({ where: { id }, select: AUDIT_POINT_SAFE_SELECT }),
    () => prisma.auditPoint.findUnique({ where: { id }, select: AUDIT_POINT_MINIMAL_SELECT }),
    'PATCH findUnique',
  );
  if (!existing || existing.engagementId !== engagementId) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (__eqrGuard.role === 'EQR' && existing.pointType !== 'review_point') {
    return NextResponse.json({ error: 'EQR users can only act on review points' }, { status: 403 });
  }

  // Add response to thread
  if (action === 'respond') {
    const { message, attachments: respAttachments } = body;
    const responses = (existing.responses as any[]) || [];
    responses.push({
      id: crypto.randomUUID(),
      userId: session.user.id,
      userName: session.user.name || session.user.email || '',
      message: message || '',
      attachments: respAttachments || [],
      createdAt: new Date().toISOString(),
    });
    // Matter becomes "open" on first reply — anything with a thread
    // is no longer "new". Preserves closed/committed/cancelled.
    const data: any = { responses };
    if (existing.status === 'new') data.status = 'open';
    const point = await writeWithFallback(
      () => prisma.auditPoint.update({ where: { id }, data, select: AUDIT_POINT_SAFE_SELECT }),
      () => prisma.auditPoint.update({ where: { id }, data, select: AUDIT_POINT_MINIMAL_SELECT }),
      'PATCH respond',
    );
    return NextResponse.json({ point });
  }

  // Set the traffic-light colour. Kept separate from `update` so the
  // UI can fire it on a single click without sending the rest of the
  // record back. Any user can recolour.
  if (action === 'colour') {
    const { colour } = body;
    // Accept null/empty to clear, plus a small set of canonical tones.
    // New values can be whitelisted here later without a migration.
    const allowed = new Set(['green', 'amber', 'red', null, '']);
    const next = colour === '' ? null : colour;
    if (!allowed.has(next)) {
      return NextResponse.json({ error: 'Invalid colour' }, { status: 400 });
    }
    // The `colour` column itself is from the 2026-04-22 migration, so
    // if it's missing we can't satisfy this action at all. Tell the
    // caller plainly rather than 500ing.
    try {
      const point = await prisma.auditPoint.update({
        where: { id },
        data: { colour: next },
        select: AUDIT_POINT_SAFE_SELECT,
      });
      return NextResponse.json({ point });
    } catch (err: any) {
      if (isMissingMigrationColumn(err)) {
        return NextResponse.json({
          error: 'Traffic-light colour requires a database migration. Run prisma/migrations/manual/2026-04-22-audit-points-colour-links.sql in Supabase.',
        }, { status: 422 });
      }
      throw err;
    }
  }

  // Assign point to a team member. The caller may pass null/empty to
  // unassign. Role is cached at assignment time so the status-change
  // gate can compare ranks without a second hop. Anyone on the team
  // can change the assignee — assignment is not a senior-only action.
  if (action === 'assign') {
    const { assignedToUserId, assignedToName } = body;
    let role: string | null = null;
    let resolvedName: string | null = assignedToName ? String(assignedToName).trim() : null;
    if (assignedToUserId) {
      const member = await prisma.auditTeamMember.findFirst({
        where: { engagementId, userId: String(assignedToUserId) },
        select: { role: true, userId: true, user: { select: { name: true, email: true } } },
      });
      if (!member) {
        return NextResponse.json({ error: 'Assignee is not a member of this engagement team' }, { status: 400 });
      }
      role = member.role;
      // Fill the name from the team-member record if the caller
      // didn't supply one — saves the client a lookup.
      if (!resolvedName) {
        resolvedName = member.user?.name || member.user?.email || null;
      }
    }
    const data = {
      assignedToUserId: assignedToUserId ? String(assignedToUserId) : null,
      assignedToName: resolvedName,
      assignedToRole: role,
    };
    try {
      const point = await prisma.auditPoint.update({
        where: { id }, data, select: AUDIT_POINT_SAFE_SELECT,
      });
      return NextResponse.json({ point });
    } catch (err: any) {
      if (isMissingMigrationColumn(err)) {
        return NextResponse.json({
          error: 'Assignee requires a database migration. Run scripts/sql/audit-points-assignee-status-history.sql in Supabase.',
        }, { status: 422 });
      }
      throw err;
    }
  }

  // Status workflow — Open / Addressed / Reviewed / Closed.
  //
  // Each transition stamps the user + their role and appends an entry
  // to status_history so the per-point timeline can render every
  // change. The role-rank gate prevents a more-junior user from
  // overriding a status set by a more senior team member: we look at
  // the most recent status_history entry and require the caller's
  // rank to be >= the previous setter's rank.
  if (action === 'status') {
    const { status: nextStatus } = body;
    const allowed = new Set(['open', 'addressed', 'reviewed', 'closed']);
    if (!nextStatus || !allowed.has(String(nextStatus))) {
      return NextResponse.json({ error: 'Invalid status — use open | addressed | reviewed | closed' }, { status: 400 });
    }
    const callerRole = await resolveTeamRole(engagementId, session.user.id);
    const callerRank = ROLE_RANK[callerRole] ?? 0;

    // Look up the most recent status_history entry to compare ranks.
    // Status history may be missing on legacy rows — treat as
    // "no senior has set this", i.e. allow the change.
    const history: Array<{ status?: string; byRole?: string; byId?: string; byName?: string; at?: string }> =
      Array.isArray((existing as any).statusHistory) ? (existing as any).statusHistory : [];
    const previous = history.length > 0 ? history[history.length - 1] : null;
    const previousRank = previous?.byRole ? (ROLE_RANK[previous.byRole] ?? 0) : 0;
    if (!session.user.isSuperAdmin && previous && callerRank < previousRank) {
      return NextResponse.json({
        error: `Status was last set to "${previous.status}" by ${previous.byName || 'a senior reviewer'} (${previous.byRole}). You need at least their authority to change it.`,
      }, { status: 403 });
    }

    const stampedName = (session.user.name || session.user.email || 'Unknown') + ` (${callerRole})`;
    const entry = {
      status: nextStatus,
      byId: session.user.id,
      byName: session.user.name || session.user.email || 'Unknown',
      byRole: callerRole,
      at: new Date().toISOString(),
    };
    const nextHistory = [...history, entry];

    // When the status is 'closed' we also stamp the legacy closedBy*
    // fields so existing read paths (which only know about those
    // columns) still surface "closed by X". For non-closed statuses
    // we clear the legacy stamp so the row doesn't read as closed
    // when it isn't.
    const closeFields = nextStatus === 'closed'
      ? { closedById: session.user.id, closedByName: stampedName, closedAt: new Date() }
      : { closedById: null, closedByName: null, closedAt: null };

    const data = {
      status: nextStatus,
      statusHistory: nextHistory as any,
      ...closeFields,
    };
    let point;
    try {
      point = await prisma.auditPoint.update({
        where: { id }, data, select: AUDIT_POINT_SAFE_SELECT,
      });
    } catch (err: any) {
      if (isMissingMigrationColumn(err)) {
        return NextResponse.json({
          error: 'Status workflow requires a database migration. Run scripts/sql/audit-points-assignee-status-history.sql in Supabase.',
        }, { status: 422 });
      }
      throw err;
    }
    // Audit-trail entry so the per-point history popover and the
    // engagement-wide log both pick up the change.
    const actor = await resolveActor(engagementId, session);
    if (actor) {
      await logEngagementAction({
        engagementId,
        firmId: actor.firmId,
        actorUserId: actor.actorUserId,
        actorName: stampedName,
        action: `audit-point.status-${nextStatus}`,
        summary: `Set ${existing.pointType.replace(/_/g, ' ')} #${existing.chatNumber} status to ${nextStatus}: ${(existing.description || '').slice(0, 120)}${(existing.description || '').length > 120 ? '…' : ''}`,
        targetType: 'audit_point',
        targetId: id,
        metadata: { pointType: existing.pointType, chatNumber: existing.chatNumber, role: callerRole, previousStatus: existing.status },
      });
    }
    return NextResponse.json({ point });
  }

  // Close point — RI only for ri_matter (user requirement). Other
  // point types keep their existing permissions; EQR already checked
  // at the top of the handler for review_point scope.
  if (action === 'close') {
    if (existing.pointType === 'ri_matter' || existing.pointType === 'review_point') {
      // Look up the caller's team membership to confirm they're the RI
      // (or a Partner). Anyone else gets 403 even if they're on the
      // engagement. Spec says "Only RI can close an item" — Review
      // Points mirror RI Matters (per user instruction to replicate
      // the same functionality), so the same gate applies to both.
      const member = await prisma.auditTeamMember.findFirst({
        where: { engagementId, userId: session.user.id },
        select: { role: true },
      });
      const isRI = member?.role === 'RI' || member?.role === 'Partner' || session.user.isSuperAdmin;
      if (!isRI) {
        const noun = existing.pointType === 'review_point' ? 'review point' : 'RI matter';
        return NextResponse.json({ error: `Only the RI can close a ${noun}` }, { status: 403 });
      }
    }
    const closeData = { status: 'closed', closedById: session.user.id, closedByName: session.user.name || '', closedAt: new Date() };
    const point = await writeWithFallback(
      () => prisma.auditPoint.update({ where: { id }, data: closeData, select: AUDIT_POINT_SAFE_SELECT }),
      () => prisma.auditPoint.update({ where: { id }, data: closeData, select: AUDIT_POINT_MINIMAL_SELECT }),
      'PATCH close',
    );
    // Audit trail — closing is a decision worth logging separately
    // from generic PATCH updates. Actor + matter id land in the
    // Outstanding tab's audit panel.
    const actor = await resolveActor(engagementId, session);
    if (actor) {
      await logEngagementAction({
        engagementId,
        firmId: actor.firmId,
        actorUserId: actor.actorUserId,
        actorName: actor.actorName,
        action: 'audit-point.close',
        summary: `Closed ${existing.pointType.replace(/_/g, ' ')} #${existing.chatNumber}: ${(existing.description || '').slice(0, 120)}${(existing.description || '').length > 120 ? '…' : ''}`,
        targetType: 'audit_point',
        targetId: id,
        metadata: { pointType: existing.pointType, chatNumber: existing.chatNumber },
      });
    }
    return NextResponse.json({ point });
  }

  // Commit & reject (management / representation flows). 'cancel'
  // accepted as legacy alias for 'reject'. Both run through the same
  // path: stamp closedByName with role suffix so later overrides can
  // honour the authority gate; enforce that gate against the existing
  // closedByName; log an action-log entry so the history popover has
  // an entry to show.
  if (action === 'commit' || action === 'reject' || action === 'cancel') {
    const isCommit = action === 'commit';
    const callerRole = await resolveTeamRole(engagementId, session.user.id);
    if (!hasAuthorityToOverride(callerRole, !!session.user.isSuperAdmin, existing.closedByName)) {
      const previousRole = parseRoleFromStampedName(existing.closedByName);
      return NextResponse.json({
        error: `This point's current status was set by ${existing.closedByName || 'a senior reviewer'}${previousRole ? ` (${previousRole})` : ''}. You need at least ${previousRole || 'their'} authority to change it.`,
      }, { status: 403 });
    }
    const stampedName = (session.user.name || session.user.email || 'Unknown') + ` (${callerRole})`;
    const newStatus = isCommit ? 'committed' : 'cancelled';
    const data = { status: newStatus, closedById: session.user.id, closedByName: stampedName, closedAt: new Date() };
    const point = await writeWithFallback(
      () => prisma.auditPoint.update({ where: { id }, data, select: AUDIT_POINT_SAFE_SELECT }),
      () => prisma.auditPoint.update({ where: { id }, data, select: AUDIT_POINT_MINIMAL_SELECT }),
      `PATCH ${action}`,
    );
    // Log so the per-point history popover (in the UI) and the
    // engagement audit trail have an entry to attribute. Mirrors the
    // pattern used for close on RI matters above.
    const actor = await resolveActor(engagementId, session);
    if (actor) {
      const verb = isCommit ? 'Committed' : 'Rejected';
      await logEngagementAction({
        engagementId,
        firmId: actor.firmId,
        actorUserId: actor.actorUserId,
        actorName: stampedName,
        action: isCommit ? 'audit-point.commit' : 'audit-point.reject',
        summary: `${verb} ${existing.pointType.replace(/_/g, ' ')} #${existing.chatNumber}: ${(existing.description || '').slice(0, 120)}${(existing.description || '').length > 120 ? '…' : ''}`,
        targetType: 'audit_point',
        targetId: id,
        metadata: { pointType: existing.pointType, chatNumber: existing.chatNumber, role: callerRole },
      });
    }
    return NextResponse.json({ point });
  }

  // Update content (description, heading, body)
  if (action === 'update') {
    const data: any = {};
    if (body.description !== undefined) data.description = body.description;
    if (body.heading !== undefined) data.heading = body.heading;
    if (body.body !== undefined) data.body = body.body;
    if (body.attachments !== undefined) data.attachments = body.attachments;
    const point = await writeWithFallback(
      () => prisma.auditPoint.update({ where: { id }, data, select: AUDIT_POINT_SAFE_SELECT }),
      () => prisma.auditPoint.update({ where: { id }, data, select: AUDIT_POINT_MINIMAL_SELECT }),
      'PATCH update',
    );
    return NextResponse.json({ point });
  }

  // Raise as … (error | management | representation).
  //
  // Creates a NEW record in the target table with a back-link
  // (linkedFromType='ri_matter', linkedFromId=existing.id). The
  // target's description is seeded from the matter's description;
  // the user can tweak in the target's own panel afterwards.
  //
  // For 'error' the target is AuditErrorSchedule and we need fsLine +
  // errorAmount + errorType. These are passed in the body (AI-
  // pre-filled on the client side) and the auditor verifies before
  // submitting. fsLine defaults to 'Unclassified' when not provided
  // so the raise never fails silently.
  if (action === 'raise') {
    const { raiseAs, raiseFields } = body as {
      raiseAs: 'error' | 'management' | 'representation';
      raiseFields?: Record<string, any>;
    };
    if (!raiseAs) return NextResponse.json({ error: 'raiseAs required' }, { status: 400 });

    const actor = await resolveActor(engagementId, session);
    const summaryText = (existing.description || '').slice(0, 120);

    let created: any = null;
    if (raiseAs === 'error') {
      const errorBase = {
        engagementId,
        fsLine: String(raiseFields?.fsLine ?? 'Unclassified'),
        accountCode: raiseFields?.accountCode ?? null,
        description: String(raiseFields?.description ?? existing.description ?? ''),
        errorAmount: Number(raiseFields?.errorAmount ?? 0) || 0,
        errorType: String(raiseFields?.errorType ?? 'judgemental'),
        explanation: raiseFields?.explanation ?? null,
        isFraud: !!raiseFields?.isFraud,
      };
      // Note: AuditErrorSchedule has its own field-projection drift
      // problem mirrored from this route. Try with the back-link; if
      // those columns are missing in production, retry without.
      try {
        created = await prisma.auditErrorSchedule.create({
          data: { ...errorBase, linkedFromType: existing.pointType, linkedFromId: existing.id },
        });
      } catch (err: any) {
        if (!isMissingMigrationColumn(err)) throw err;
        console.warn('[audit-points] error_schedules.linked_from_* missing — creating without back-link');
        created = await prisma.auditErrorSchedule.create({ data: errorBase });
      }
    } else if (raiseAs === 'management' || raiseAs === 'representation') {
      const pointType = raiseAs; // 'management' | 'representation'
      const maxChat = await prisma.auditPoint.aggregate({
        where: { engagementId, pointType },
        _max: { chatNumber: true },
      });
      const chatNumber = (maxChat._max.chatNumber || 0) + 1;
      const pointBase = {
        engagementId,
        pointType,
        chatNumber,
        status: 'new',
        description: String(raiseFields?.description ?? existing.description ?? ''),
        heading: raiseFields?.heading ?? null,
        body: raiseFields?.body ?? null,
        createdById: session.user.id,
        createdByName: session.user.name || session.user.email || '',
        linkedFromType: existing.pointType,
        linkedFromId: existing.id,
      };
      created = await writeWithFallback(
        () => prisma.auditPoint.create({ data: pointBase, select: AUDIT_POINT_SAFE_SELECT }),
        () => prisma.auditPoint.create({ data: stripMigrationFields(pointBase), select: AUDIT_POINT_MINIMAL_SELECT }),
        'raise create',
      );
    } else {
      return NextResponse.json({ error: 'Unknown raiseAs value' }, { status: 400 });
    }

    // Audit trail — raising is a decision that jumps the matter into
    // a different workflow, worth recording so reviewers can trace
    // the chain back.
    if (actor && created) {
      await logEngagementAction({
        engagementId,
        firmId: actor.firmId,
        actorUserId: actor.actorUserId,
        actorName: actor.actorName,
        action: `audit-point.raise-${raiseAs}`,
        summary: `Raised ${existing.pointType.replace(/_/g, ' ')} #${existing.chatNumber} as ${raiseAs}${summaryText ? ` — ${summaryText}${(existing.description || '').length > 120 ? '…' : ''}` : ''}`,
        targetType: raiseAs === 'error' ? 'error_schedule' : 'audit_point',
        targetId: created.id,
        // Generic source-pointer keys so review_point and ri_matter
        // raises both attribute back to their source. Old entries used
        // `raisedFromRiMatterId` — readers should accept either.
        metadata: {
          raisedFromPointId: existing.id,
          raisedFromPointType: existing.pointType,
          raisedFromChatNumber: existing.chatNumber,
        },
      });
    }

    return NextResponse.json({ raised: created });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
