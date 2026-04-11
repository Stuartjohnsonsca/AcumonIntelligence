import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { generateCommunicationOverall } from '@/lib/board-minutes-ai';

/**
 * Communication tab roll-ups.
 *
 * This route is deliberately separate from the per-meeting Board-Minutes /
 * TCWG / Shareholders route because it operates on all meeting types at once:
 *
 *  - GET  /api/engagements/[id]/communication — overall + per-sub-tab sign-offs,
 *         overall summary (if cached), headings, and current meeting counts.
 *  - POST /api/engagements/[id]/communication — actions:
 *      * regenerate_overall — run the AI across every meeting to produce a
 *        consolidated per-heading summary + overall narrative. Cached in the
 *        permanent-file so revisits are instant.
 *      * signoff / unsignoff — toggles either the overall sign-off (target:
 *        'overall') or a specific sub-tab sign-off (target: 'board-minutes',
 *        'tcwg', 'shareholders', 'client', 'internal', 'expert').
 */

const DEFAULT_OVERALL_HEADINGS = [
  'Impacts Financial Statements',
  'Impacts Going Concern',
  'Impacts Profitability',
  'Indicated Significant Decision',
];

const OVERALL_SECTION_KEY = 'communication_overall';
const SIGNOFF_SECTION_KEY = 'communication_signoffs';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

async function getOverallHeadings(firmId: string): Promise<string[]> {
  const row = await prisma.methodologyRiskTable.findUnique({
    where: { firmId_tableType: { firmId, tableType: 'communication_overall_headings' } },
  });
  const headings = (row?.data as any)?.headings;
  if (Array.isArray(headings) && headings.length > 0) return headings;
  return DEFAULT_OVERALL_HEADINGS;
}

async function getCachedOverall(engagementId: string) {
  const row = await prisma.auditPermanentFile.findUnique({
    where: { engagementId_sectionKey: { engagementId, sectionKey: OVERALL_SECTION_KEY } },
  });
  return (row?.data as Record<string, unknown>) || null;
}

async function setCachedOverall(engagementId: string, data: Record<string, unknown>) {
  await prisma.auditPermanentFile.upsert({
    where: { engagementId_sectionKey: { engagementId, sectionKey: OVERALL_SECTION_KEY } },
    create: { engagementId, sectionKey: OVERALL_SECTION_KEY, data: data as object },
    update: { data: data as object },
  });
}

async function getAllSignOffs(engagementId: string): Promise<Record<string, Record<string, unknown>>> {
  const row = await prisma.auditPermanentFile.findUnique({
    where: { engagementId_sectionKey: { engagementId, sectionKey: SIGNOFF_SECTION_KEY } },
  });
  return ((row?.data as Record<string, Record<string, unknown>>) || {});
}

async function setAllSignOffs(engagementId: string, data: Record<string, Record<string, unknown>>) {
  await prisma.auditPermanentFile.upsert({
    where: { engagementId_sectionKey: { engagementId, sectionKey: SIGNOFF_SECTION_KEY } },
    create: { engagementId, sectionKey: SIGNOFF_SECTION_KEY, data: data as object },
    update: { data: data as object },
  });
}

// GET — return headings, cached summary, sign-offs, and meeting counts
export async function GET(_req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  const engagement = await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!engagement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [headings, cached, signOffs, counts] = await Promise.all([
    getOverallHeadings(session.user.firmId),
    getCachedOverall(engagementId),
    getAllSignOffs(engagementId),
    prisma.auditMeeting.groupBy({
      by: ['meetingType'],
      where: { engagementId },
      _count: { _all: true },
    }),
  ]);

  const countsByType = Object.fromEntries(counts.map(c => [c.meetingType || 'other', c._count._all]));

  return NextResponse.json({
    headings,
    summary: cached,
    signOffs,
    counts: countsByType,
  });
}

// POST — regenerate overall summary / toggle sign-offs
export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  const engagement = await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!engagement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  const body = await req.json();
  const { action } = body;

  if (action === 'regenerate_overall') {
    const headings = await getOverallHeadings(session.user.firmId);

    // Pull every meeting with any extracted/minutes content. Meeting types
    // outside of board_minutes / tcwg / shareholders may not have a structured
    // headings blob — use their raw notes / transcript as a fallback.
    const meetings = await prisma.auditMeeting.findMany({
      where: { engagementId },
      orderBy: { meetingDate: 'asc' },
      select: {
        id: true,
        title: true,
        meetingDate: true,
        meetingType: true,
        minutes: true,
        transcriptRaw: true,
      },
    });

    if (meetings.length === 0) {
      return NextResponse.json({ error: 'No meetings to summarise — add board minutes, TCWG or meetings first.' }, { status: 400 });
    }

    const prepared = meetings.map(m => {
      const mins = (m.minutes as Record<string, unknown>) || {};
      const headingsBlob = (mins.headings as Record<string, { content?: string; flagged?: boolean }> | undefined) || {};
      const headingLines = Object.entries(headingsBlob)
        .filter(([, v]) => typeof v?.content === 'string' && v.content.trim().length > 0)
        .map(([k, v]) => `  ${k}: ${v.content}`);
      const otherMatters = typeof mins.otherMatters === 'string' ? mins.otherMatters : '';
      const transcript = typeof m.transcriptRaw === 'string' ? m.transcriptRaw.slice(0, 4000) : '';
      return {
        meetingType: m.meetingType || 'other',
        meetingDate: m.meetingDate.toISOString().slice(0, 10),
        title: m.title,
        headingsText: headingLines.join('\n'),
        otherMatters,
        // Only include raw transcript for meetings that don't have structured headings
        rawFallback: headingLines.length === 0 && !otherMatters ? transcript : '',
      };
    });

    try {
      const summary = await generateCommunicationOverall(prepared, headings);
      const cached = {
        ...summary,
        generatedAt: new Date().toISOString(),
        generatedBy: session.user.name || session.user.email,
        meetingCount: meetings.length,
      };
      await setCachedOverall(engagementId, cached);
      return NextResponse.json({ summary: cached });
    } catch (err: any) {
      return NextResponse.json({ error: `AI summary failed: ${err?.message || 'unknown'}` }, { status: 500 });
    }
  }

  if (action === 'signoff' || action === 'unsignoff') {
    const { target, role } = body as { target?: string; role?: string };
    if (!target || !role) return NextResponse.json({ error: 'target and role required' }, { status: 400 });
    if (!['preparer', 'reviewer', 'ri', 'eqr'].includes(role)) return NextResponse.json({ error: 'invalid role' }, { status: 400 });

    // target may be 'overall' or a sub-tab key like 'board-minutes', 'tcwg', etc.
    const allSignOffs = await getAllSignOffs(engagementId);
    const bucket = (allSignOffs[target] as Record<string, unknown>) || {};

    if (action === 'unsignoff') {
      delete bucket[role];
    } else {
      bucket[role] = {
        userId: session.user.id,
        userName: session.user.name || session.user.email,
        timestamp: new Date().toISOString(),
      };
    }
    allSignOffs[target] = bucket;
    await setAllSignOffs(engagementId, allSignOffs);
    return NextResponse.json({ signOffs: allSignOffs });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
