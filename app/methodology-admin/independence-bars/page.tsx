import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { BackButton } from '@/components/methodology-admin/BackButton';
import { IndependenceBarsClient, type IndependenceBar } from '@/components/methodology-admin/IndependenceBarsClient';

/**
 * Methodology Admin → Independence Bars.
 *
 * Lists every team member currently barred from an engagement because
 * they declared they were not independent. Methodology Admin / Super
 * User can unbar an individual user × engagement pair; the action
 * resets their row to outstanding (so they re-confirm next time) and
 * is recorded in the append-only Independence history.
 */
export default async function IndependenceBarsPage() {
  const session = await auth();
  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/independence-bars');
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  const firmId = session.user.firmId;

  let bars: IndependenceBar[] = [];
  let migrationPending = false;
  try {
    const rows = await prisma.auditMemberIndependence.findMany({
      where: {
        status: 'declined',
        engagement: { firmId },
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        engagement: {
          select: {
            id: true,
            auditType: true,
            client: { select: { id: true, clientName: true } },
            period: { select: { id: true, startDate: true, endDate: true } },
          },
        },
      },
      orderBy: { confirmedAt: 'desc' },
    });
    bars = rows.map(r => ({
      id: r.id,
      engagementId: r.engagementId,
      auditType: r.engagement.auditType,
      clientId: r.engagement.client.id,
      clientName: r.engagement.client.clientName,
      periodStart: r.engagement.period.startDate.toISOString(),
      periodEnd: r.engagement.period.endDate.toISOString(),
      userId: r.user.id,
      userName: r.user.name || r.user.email,
      userEmail: r.user.email,
      declinedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null,
      notifiedAt: r.notifiedAt ? r.notifiedAt.toISOString() : null,
      flaggedQuestions: extractFlagged(r.answers),
      notes: r.notes,
    }));
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (/audit_member_independence/.test(msg) && /does not exist/i.test(msg)) {
      migrationPending = true;
    } else {
      throw err;
    }
  }

  return (
    <div data-howto-id="page.independence-bars.body" className="container mx-auto px-4 py-10 max-w-5xl">
      <BackButton href="/methodology-admin" label="Back to Methodology Admin" />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Independence Bars</h1>
        <p className="text-sm text-slate-500 mt-1">
          Team members currently barred from a Client/Period because they declared they were not independent. Unbar
          a user once the matter has been resolved (they will be re-prompted for the questionnaire next time they
          open the engagement). Every unbar is recorded in the Independence audit trail.
        </p>
      </div>
      {migrationPending ? (
        <div className="bg-amber-50 border border-amber-200 rounded p-4 text-sm text-amber-800">
          The Independence tables aren&rsquo;t migrated yet on this database. Run
          {' '}<code>scripts/sql/independence-gate.sql</code>{' '}then
          {' '}<code>scripts/sql/independence-history.sql</code>{' '}then
          {' '}<code>scripts/sql/independence-unbar.sql</code>{' '}on Supabase.
        </div>
      ) : (
        <IndependenceBarsClient initialBars={bars} />
      )}
    </div>
  );
}

function extractFlagged(answers: unknown): Array<{ text: string; notes?: string }> {
  if (!Array.isArray(answers)) return [];
  return answers
    .filter((a: any) => a && a.answer === true)
    .map((a: any) => ({ text: String(a.questionText || ''), notes: a.notes ? String(a.notes) : undefined }))
    .filter(a => a.text.length > 0);
}
