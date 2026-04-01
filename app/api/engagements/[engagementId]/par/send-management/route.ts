import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/engagements/[engagementId]/par/send-management
 * Creates portal requests for PAR items marked "Send Mgt" — posts to the
 * client portal Explanations tab for the client to provide explanations.
 */
export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { engagementId } = await params;
  const { items } = await req.json();

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'items array required' }, { status: 400 });
  }

  // Get engagement details for clientId
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { clientId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });

  // Create portal requests for each PAR item
  let created = 0;
  for (const item of items) {
    // Build the question with PAR context
    const parts = [item.particulars || 'PAR Item'];
    if (item.currentYear != null || item.priorYear != null) {
      const cy = item.currentYear != null ? `£${Number(item.currentYear).toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : '—';
      const py = item.priorYear != null ? `£${Number(item.priorYear).toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : '—';
      const variance = item.absVariance != null ? `£${Number(item.absVariance).toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : '—';
      const pct = item.absVariancePercent != null ? `${Number(item.absVariancePercent).toFixed(1)}%` : '—';
      parts.push(`CY: ${cy} | PY: ${py} | Variance: ${variance} (${pct})`);
    }
    const question = parts.join('\n');

    // Check for duplicate (same question for same engagement)
    const existing = await prisma.portalRequest.findFirst({
      where: { clientId: engagement.clientId, engagementId, section: 'explanations', question, status: 'outstanding' },
    });
    if (existing) continue;

    await prisma.portalRequest.create({
      data: {
        clientId: engagement.clientId,
        engagementId,
        section: 'explanations',
        question,
        status: 'outstanding',
        requestedById: session.user.id,
        requestedByName: session.user.name || 'Audit Team',
      },
    });
    created++;
  }

  return NextResponse.json({ success: true, sentCount: created });
}
