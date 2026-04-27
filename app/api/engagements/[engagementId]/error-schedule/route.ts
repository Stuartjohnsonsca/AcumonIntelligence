import { NextRequest, NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ERROR_SCHEDULE_SAFE_SELECT } from '@/lib/error-schedule-select';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

// AuditPermanentFile section that holds per-error meta the schedule
// schema doesn't have a dedicated column for: sign-offs (preparer /
// reviewer / RI), and the encoded source-location captured at create
// time so the UI can render a back-link to the tab where the error
// was raised. Keyed by error id.
const META_SECTION = 'error_schedule_meta';
type ErrorMetaEntry = {
  signOffs?: { preparer?: SignOff; reviewer?: SignOff; ri?: SignOff };
  sourceLocation?: string | null;
};
type SignOff = { userId: string; userName: string; at: string };
type ErrorMeta = Record<string, ErrorMetaEntry>;

async function readMeta(engagementId: string): Promise<ErrorMeta> {
  const rec = await prisma.auditPermanentFile.findUnique({
    where: { engagementId_sectionKey: { engagementId, sectionKey: META_SECTION } },
  });
  const data = rec?.data as ErrorMeta | undefined;
  return data && typeof data === 'object' ? data : {};
}
async function writeMeta(engagementId: string, meta: ErrorMeta): Promise<void> {
  await prisma.auditPermanentFile.upsert({
    where: { engagementId_sectionKey: { engagementId, sectionKey: META_SECTION } },
    create: { engagementId, sectionKey: META_SECTION, data: meta as unknown as object },
    update: { data: meta as unknown as object },
  });
}

// GET: All error schedule entries + the per-error meta blob.
export async function GET(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [errors, meta] = await Promise.all([
    prisma.auditErrorSchedule.findMany({
      where: { engagementId },
      orderBy: { createdAt: 'asc' },
      // Explicit select — production Supabase lacks the `linked_from_type`
      // / `linked_from_id` columns on this table until
      // scripts/sql/raise-as-linked-from.sql is applied. Without this,
      // Prisma selects those columns by default and the query 500s.
      select: ERROR_SCHEDULE_SAFE_SELECT,
    }),
    readMeta(engagementId),
  ]);
  return NextResponse.json({ errors, meta });
}

// POST: Commit errors to schedule
export async function POST(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  const body = await req.json();

  // Send unadjusted errors to the client for approval. Creates a
  // PortalRequest with section='error_approvals' and a structured
  // payload (errorApprovalsRequest) on chatHistory[0]. The portal
  // renders the items as a checkbox list instead of a textarea, and
  // the /api/portal/requests POST handler ticks resolution='in_tb'
  // on whichever errors the client approves.
  if (body.action === 'send_for_approval') {
    const { errorIds, message } = body as { errorIds: string[]; message?: string };
    if (!Array.isArray(errorIds) || errorIds.length === 0) {
      return NextResponse.json({ error: 'errorIds required' }, { status: 400 });
    }
    const eng = await prisma.auditEngagement.findUnique({
      where: { id: engagementId },
      select: { clientId: true },
    });
    if (!eng?.clientId) return NextResponse.json({ error: 'Engagement client not found' }, { status: 404 });

    const rows = await prisma.auditErrorSchedule.findMany({
      where: { engagementId, id: { in: errorIds } },
      select: { id: true, fsLine: true, accountCode: true, description: true, errorAmount: true, errorType: true },
    });
    if (rows.length === 0) return NextResponse.json({ error: 'No matching errors found' }, { status: 404 });

    const items = rows.map(r => ({
      errorId: r.id,
      fsLine: r.fsLine,
      accountCode: r.accountCode,
      description: r.description,
      errorAmount: r.errorAmount,
      errorType: r.errorType,
    }));
    const cover = (message && typeof message === 'string' && message.trim()) || 'Please review the following misstatements and tick those you accept and have adjusted in your records.';
    const initialChat = [{
      from: 'firm',
      name: session.user.name || session.user.email || 'Auditor',
      message: cover,
      timestamp: new Date().toISOString(),
      // Structured payload the portal renderer keys off — the absence
      // of this field means render the standard textarea response.
      errorApprovalsRequest: { items },
    }];

    const created = await prisma.portalRequest.create({
      data: {
        clientId: eng.clientId,
        engagementId,
        section: 'error_approvals',
        question: `[Error approvals] ${cover.slice(0, 200)}`,
        status: 'outstanding',
        requestedById: session.user.id,
        requestedByName: session.user.name || session.user.email || '',
        chatHistory: initialChat as any,
      } as any,
    });

    return NextResponse.json({ ok: true, portalRequestId: created.id, sent: items.length });
  }

  // Commit multiple errors from a conclusion
  if (body.action === 'commit_from_conclusion') {
    const { conclusionId, items } = body as { action: string; conclusionId: string; items: { description: string; errorAmount: number; errorType: string; explanation?: string; isFraud?: boolean }[] };
    if (!conclusionId || !items?.length) return NextResponse.json({ error: 'conclusionId and items required' }, { status: 400 });

    const conclusion = await prisma.auditTestConclusion.findUnique({ where: { id: conclusionId } });
    if (!conclusion) return NextResponse.json({ error: 'Conclusion not found' }, { status: 404 });

    const created = await prisma.auditErrorSchedule.createMany({
      data: items.map(item => ({
        engagementId,
        conclusionId,
        fsLine: conclusion.fsLine,
        accountCode: conclusion.accountCode,
        description: item.description,
        errorAmount: item.errorAmount,
        errorType: item.errorType || 'factual',
        explanation: item.explanation || null,
        isFraud: item.isFraud || false,
        committedBy: session.user.id,
        committedByName: session.user.name || session.user.email || '',
        committedAt: new Date(),
      })),
    });

    return NextResponse.json({ committed: created.count });
  }

  // Sign-off / unsignoff / set reason / set resolution actions —
  // metadata that doesn't have a dedicated column on AuditErrorSchedule
  // is persisted in the `error_schedule_meta` AuditPermanentFile blob
  // instead, keyed by error id. Avoids a schema migration and keeps
  // the new feature's persistence in one place.
  if (body.action === 'signoff' || body.action === 'unsignoff') {
    const { errorId, role } = body as { errorId: string; role: 'preparer' | 'reviewer' | 'ri' };
    if (!errorId || !['preparer', 'reviewer', 'ri'].includes(role)) {
      return NextResponse.json({ error: 'errorId and valid role required' }, { status: 400 });
    }
    const meta = await readMeta(engagementId);
    const entry: ErrorMetaEntry = meta[errorId] || {};
    entry.signOffs = entry.signOffs || {};
    if (body.action === 'signoff') {
      entry.signOffs[role] = {
        userId: session.user.id,
        userName: session.user.name || session.user.email || 'Unknown',
        at: new Date().toISOString(),
      };
    } else {
      delete entry.signOffs[role];
    }
    meta[errorId] = entry;
    await writeMeta(engagementId, meta);
    return NextResponse.json({ meta });
  }

  if (body.action === 'set_reason') {
    const { errorId, reason } = body as { errorId: string; reason: string };
    if (!errorId) return NextResponse.json({ error: 'errorId required' }, { status: 400 });
    // Reason is the user-visible explanation/narrative for the error
    // journal — single source of truth on the AuditErrorSchedule row.
    await prisma.auditErrorSchedule.update({
      where: { id: errorId },
      data: { explanation: typeof reason === 'string' ? reason : null },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'set_resolution') {
    // 'in_tb' = the error has been booked into the trial balance
    // (i.e. adjusted). Anything else (typically null or 'error')
    // means it remains as an unadjusted misstatement. Drives the
    // Adjusted vs Unadjusted view filters on the panel.
    const { errorId, resolution } = body as { errorId: string; resolution: string | null };
    if (!errorId) return NextResponse.json({ error: 'errorId required' }, { status: 400 });
    const allowed = new Set([null, 'error', 'in_tb']);
    const next = resolution === '' ? null : resolution;
    if (!allowed.has(next as any)) return NextResponse.json({ error: 'invalid resolution' }, { status: 400 });
    await prisma.auditErrorSchedule.update({
      where: { id: errorId },
      data: {
        resolution: next as any,
        resolvedBy: next ? session.user.id : null,
        resolvedByName: next ? (session.user.name || session.user.email || 'Unknown') : null,
        resolvedAt: next ? new Date() : null,
      },
    });
    return NextResponse.json({ ok: true });
  }

  // Single error create. Accepts an optional sourceLocation (encoded
  // engagement-nav reference) which gets persisted into the meta blob
  // so the panel can render a back-link to the originating tab.
  const error = await prisma.auditErrorSchedule.create({
    data: {
      engagementId,
      conclusionId: body.conclusionId || null,
      fsLine: body.fsLine,
      accountCode: body.accountCode || null,
      description: body.description,
      errorAmount: body.errorAmount,
      errorType: body.errorType || 'factual',
      explanation: body.explanation || null,
      isFraud: body.isFraud || false,
      committedBy: session.user.id,
      committedByName: session.user.name || session.user.email || '',
      committedAt: new Date(),
    },
  });
  if (body.sourceLocation) {
    const meta = await readMeta(engagementId);
    meta[error.id] = { ...(meta[error.id] || {}), sourceLocation: String(body.sourceLocation) };
    await writeMeta(engagementId, meta);
  }
  return NextResponse.json({ error });
}

// DELETE: Remove error from schedule
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  const { id } = await req.json();
  await prisma.auditErrorSchedule.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
