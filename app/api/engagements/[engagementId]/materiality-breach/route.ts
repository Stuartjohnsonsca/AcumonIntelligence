import { NextRequest, NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/engagements/[engagementId]/materiality-breach
 * Sends a technical breach notification to the Technical Team.
 * Also supports PUT for technical approval.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ engagementId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { engagementId } = await params;
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;
  const { benchmark, actualPct, rangeRow, materiality } = await req.json();

  // Get engagement details
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    include: { client: { select: { clientName: true } } },
  });
  if (!engagement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Get technical team config
  let techTeam: { email: string; members: { name: string; email: string }[] } | null = null;
  try {
    const table = await prisma.methodologyRiskTable.findFirst({
      where: { firmId: engagement.firmId, tableType: 'technical_team' },
    });
    if (table?.data) techTeam = table.data as any;
  } catch {}

  if (!techTeam?.email && (!techTeam?.members || techTeam.members.length === 0)) {
    return NextResponse.json({ warning: 'No technical team configured' });
  }

  // Build the materiality screen URL
  const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
  const link = `${baseUrl}/methodology/StatAudit?tab=materiality&engagementId=${engagementId}`;

  // Send email via Azure Communication Services (or log if not configured)
  const subject = `Technical Breach: Materiality — ${engagement.client?.clientName || 'Unknown Client'}`;
  const body = `A materiality range breach has been detected.\n\nClient: ${engagement.client?.clientName}\nBenchmark: ${benchmark}\nActual %: ${((actualPct || 0) * 100).toFixed(2)}%\nPermitted Range: ${((rangeRow?.low || 0) * 100).toFixed(1)}% – ${((rangeRow?.high || 0) * 100).toFixed(1)}%\nMateriality Amount: £${(materiality || 0).toLocaleString()}\n\nReview and approve: ${link}`;

  console.log(`[TechBreach] Email to: ${techTeam.email || techTeam.members?.map(m => m.email).join(', ')}`);
  console.log(`[TechBreach] Subject: ${subject}`);
  console.log(`[TechBreach] Body: ${body}`);

  // Try sending email
  try {
    const { sendEmail } = await import('@/lib/email');
    const recipients = techTeam.email
      ? [techTeam.email]
      : techTeam.members?.map(m => m.email) || [];
    for (const to of recipients) {
      await sendEmail(to, subject, body);
    }
  } catch (err) {
    console.warn('[TechBreach] Email send failed (non-fatal):', err);
  }

  return NextResponse.json({ sent: true });
}

/**
 * PUT /api/engagements/[engagementId]/materiality-breach
 * Technical team approves the breach.
 * Body: { action: 'approve' } or { action: 'clear' }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ engagementId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { engagementId } = await params;
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;
  const { action } = await req.json();

  // Load current materiality data
  const existing = await prisma.auditPermanentFile.findUnique({
    where: { engagementId_sectionKey: { engagementId, sectionKey: '__materiality' } },
  });

  const data = (existing?.data || {}) as Record<string, unknown>;

  if (action === 'approve') {
    data.tech_approval = {
      userName: session.user.name || session.user.email,
      date: new Date().toLocaleDateString('en-GB'),
      userId: session.user.id,
    };
  } else if (action === 'clear') {
    delete data.tech_approval;
    delete data._techEmailSent;
  }

  await prisma.auditPermanentFile.upsert({
    where: { engagementId_sectionKey: { engagementId, sectionKey: '__materiality' } },
    create: { engagementId, sectionKey: '__materiality', data: data as object },
    update: { data: data as object },
  });

  return NextResponse.json({ success: true, tech_approval: data.tech_approval || null });
}
