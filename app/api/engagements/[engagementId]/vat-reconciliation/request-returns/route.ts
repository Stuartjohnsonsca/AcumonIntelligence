import { NextRequest, NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/engagements/[engagementId]/vat-reconciliation/request-returns
 *
 * Spawns a single PortalRequest asking the client to upload their VAT
 * returns for the periods that overlap this engagement. The
 * `periodEndings` payload is an array of ISO dates the auditor sees on
 * the reconciliation grid; we render them as a friendly bullet list in
 * the question text so the portal user knows exactly which returns to
 * upload (and whether any are partial / cut-off periods).
 *
 * The `vatReturnsRequest` field on the engagement's
 * audit_vat_reconciliations row is updated with the new request id +
 * timestamp so the panel can display a "Requested on X" badge instead
 * of re-firing the portal request on every click.
 *
 * Body: { periodEndings: string[] }
 * Response: { id, sentAt }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { clientId: true, firmId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const periodEndings = Array.isArray(body?.periodEndings)
    ? body.periodEndings.filter((s: unknown): s is string => typeof s === 'string' && s.length > 0)
    : [];

  // Friendly question text. Keeps the periods on separate lines so the
  // portal renderer wraps them as a bullet list (the portal markdown
  // renderer treats `- ` prefixes as bullets).
  const intro = periodEndings.length > 0
    ? `Please upload your filed VAT returns for each of the following periods:`
    : `Please upload all VAT returns covering this audit period.`;
  const periodsList = periodEndings
    .map(iso => {
      const d = new Date(iso);
      const friendly = isNaN(d.getTime())
        ? iso
        : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      return `- Period ending ${friendly}`;
    })
    .join('\n');
  const helpTail = `\n\nWhen uploading, the audit team will use the figures (Net Revenue, Net Purchases, Sales VAT, Purchase VAT) to populate the reconciliation directly — no rekeying needed at your end.`;
  const question = `${intro}\n\n${periodsList}${helpTail}`;

  const portalRequest = await prisma.portalRequest.create({
    data: {
      clientId: engagement.clientId,
      engagementId,
      section: 'vat_returns',
      question,
      status: 'outstanding',
      requestedById: session.user.id,
      requestedByName: session.user.name || session.user.email || 'Audit Team',
    },
  });

  // Persist a pointer on the engagement's vat-reconciliation row so
  // the panel knows the request has been made + can deep-link to it.
  // Tolerant of the row not existing yet (first-time use of the panel
  // would normally have created it on Save, but this endpoint may
  // fire before the auditor has typed anything).
  try {
    const existing = await (prisma as any).auditVatReconciliation?.findUnique({ where: { engagementId } });
    const baseData = (existing?.data && typeof existing.data === 'object' && !Array.isArray(existing.data))
      ? existing.data as Record<string, unknown>
      : {};
    const merged = {
      ...baseData,
      vatReturnsRequest: {
        portalRequestId: portalRequest.id,
        sentAt: new Date().toISOString(),
      },
    };
    await (prisma as any).auditVatReconciliation?.upsert({
      where: { engagementId },
      create: { id: crypto.randomUUID(), engagementId, data: merged as object },
      update: { data: merged as object },
    });
  } catch (err) {
    console.warn('[vat-reconciliation/request-returns] failed to persist request pointer:', err);
    // Non-fatal — the portal request itself is created, the panel
    // will still see it on next refresh via the engagement's portal
    // request list.
  }

  return NextResponse.json({
    id: portalRequest.id,
    sentAt: new Date().toISOString(),
  });
}
