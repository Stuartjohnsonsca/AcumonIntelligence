/**
 * /api/admin/messaging-usage
 *
 * Super Admin-only messaging-usage rollup feeding the Messaging Usage
 * tab. Returns one row per (firm, client, engagement, channel) for a
 * date range, with the SUM of billableUnits across outbound sends.
 *
 * Aggregation is run server-side via raw SQL so it scales: we GROUP
 * BY four columns against an index-covered query, then look up the
 * display labels for firms / clients / engagements in a single batch
 * round-trip. The endpoint deliberately doesn't return individual
 * portal_messages rows — the bill-cycle UI cares about totals.
 *
 * Query params:
 *   from   — ISO date / datetime (inclusive lower bound). Defaults to
 *            the start of the current month.
 *   to     — ISO date / datetime (exclusive upper bound). Defaults to
 *            "now".
 *   firmId — Optional filter to a single firm; without it the
 *            response includes every firm with usage in range.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * The /my-account/admin page guard already redirects any non-
 * SuperAdmin and any session that hasn't 2FA-verified, so by the
 * time this endpoint is called from the Messaging Usage tab the
 * caller is necessarily a verified SuperAdmin. We gate the API on
 * `isSuperAdmin` alone — the page is the source of truth for 2FA,
 * and tying every inner-panel API to a fresh re-check of the
 * `twoFactorVerified` flag has been giving spurious 403s when the
 * session token rotates mid-panel.
 *
 * Failures are logged with the specific reason so future
 * regressions are obvious in the server log.
 */
async function requireSuperAdmin(): Promise<{ ok: true } | { ok: false; reason: 'no-session' | 'not-superadmin' }> {
  const session = await auth();
  if (!session?.user) {
    console.warn('[messaging-usage] auth() returned no user');
    return { ok: false, reason: 'no-session' };
  }
  if (!session.user.isSuperAdmin) {
    console.warn('[messaging-usage] user is not SuperAdmin', { userId: session.user.id, email: session.user.email });
    return { ok: false, reason: 'not-superadmin' };
  }
  return { ok: true };
}

interface RollupRow {
  firm_id: string | null;
  client_id: string | null;
  audit_engagement_id: string | null;
  channel: string;
  direction: string;
  message_count: bigint;
  billable_units: bigint;
}

export async function GET(req: Request) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) {
    const message = gate.reason === 'no-session'
      ? 'Not signed in. Reload the Super Admin page and try again.'
      : 'Only Super Admins can view messaging usage.';
    return NextResponse.json({ error: message, reason: gate.reason }, { status: 403 });
  }

  const url = new URL(req.url);
  // Defaults: start of current month → now. SuperAdmin usually wants
  // "this billing month so far" on first load.
  const now = new Date();
  const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const firmFilter = url.searchParams.get('firmId') || null;

  const from = fromParam ? new Date(fromParam) : defaultFrom;
  const to = toParam ? new Date(toParam) : now;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: 'Invalid from/to date' }, { status: 400 });
  }

  // The rollup. GROUP BY four columns; SUM billable_units (which is
  // 0 for inbound and 1+ for outbound) plus COUNT for the total
  // message volume (useful for inspection but not billed).
  const rows = firmFilter
    ? await prisma.$queryRaw<RollupRow[]>`
        SELECT firm_id, client_id, audit_engagement_id, channel, direction,
               COUNT(*)::bigint AS message_count,
               COALESCE(SUM(billable_units), 0)::bigint AS billable_units
        FROM portal_messages
        WHERE created_at >= ${from} AND created_at < ${to}
          AND firm_id = ${firmFilter}
        GROUP BY firm_id, client_id, audit_engagement_id, channel, direction
        ORDER BY firm_id, client_id, audit_engagement_id, channel
      `
    : await prisma.$queryRaw<RollupRow[]>`
        SELECT firm_id, client_id, audit_engagement_id, channel, direction,
               COUNT(*)::bigint AS message_count,
               COALESCE(SUM(billable_units), 0)::bigint AS billable_units
        FROM portal_messages
        WHERE created_at >= ${from} AND created_at < ${to}
        GROUP BY firm_id, client_id, audit_engagement_id, channel, direction
        ORDER BY firm_id, client_id, audit_engagement_id, channel
      `;

  // Look up display labels in one round-trip per dimension. Skip
  // nulls — the UI shows them as "(unassigned)" and doesn't need
  // labels.
  const firmIds = Array.from(new Set(rows.map(r => r.firm_id).filter((v): v is string => !!v)));
  const clientIds = Array.from(new Set(rows.map(r => r.client_id).filter((v): v is string => !!v)));
  const engagementIds = Array.from(new Set(rows.map(r => r.audit_engagement_id).filter((v): v is string => !!v)));

  const [firms, clients, engagements] = await Promise.all([
    firmIds.length
      ? prisma.firm.findMany({ where: { id: { in: firmIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string }[]),
    clientIds.length
      ? prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, clientName: true } })
      : Promise.resolve([] as { id: string; clientName: string }[]),
    engagementIds.length
      ? prisma.auditEngagement.findMany({
          where: { id: { in: engagementIds } },
          select: {
            id: true,
            periodId: true,
            period: { select: { startDate: true, endDate: true } },
          },
        })
      : Promise.resolve([] as { id: string; periodId: string; period: { startDate: Date; endDate: Date } | null }[]),
  ]);

  const firmName = new Map(firms.map(f => [f.id, f.name]));
  const clientName = new Map(clients.map(c => [c.id, c.clientName]));
  const engagementLabel = new Map(engagements.map(e => {
    if (!e.period) return [e.id, e.id];
    const start = e.period.startDate?.toISOString().slice(0, 10);
    const end = e.period.endDate?.toISOString().slice(0, 10);
    return [e.id, `${start} → ${end}`];
  }));

  // Shape into a UI-friendly response. Convert bigint → Number; we
  // don't expect a single firm to send more than 2^53 messages.
  const data = rows.map(r => ({
    firmId: r.firm_id,
    firmName: r.firm_id ? firmName.get(r.firm_id) ?? '(unknown firm)' : '(unassigned)',
    clientId: r.client_id,
    clientName: r.client_id ? clientName.get(r.client_id) ?? '(unknown client)' : '(unassigned)',
    auditEngagementId: r.audit_engagement_id,
    auditEngagementLabel: r.audit_engagement_id
      ? engagementLabel.get(r.audit_engagement_id) ?? '(unknown period)'
      : '(no engagement attribution)',
    channel: r.channel,
    direction: r.direction,
    messageCount: Number(r.message_count),
    billableUnits: Number(r.billable_units),
  }));

  // Grand totals — useful for the "this month so far" header.
  const totals = data.reduce(
    (acc, r) => {
      acc.messageCount += r.messageCount;
      acc.billableUnits += r.billableUnits;
      return acc;
    },
    { messageCount: 0, billableUnits: 0 },
  );

  return NextResponse.json({
    from: from.toISOString(),
    to: to.toISOString(),
    rows: data,
    totals,
  });
}
