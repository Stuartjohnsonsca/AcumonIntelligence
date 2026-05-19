import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getFamiliarityTable } from '@/lib/team-familiarity';
import { sendEmail } from '@/lib/email';

/**
 * POST /api/methodology-admin/team-familiarity/snapshot-email
 *
 * On-demand snapshot of the Audit Rotation Record. Builds a CSV
 * attachment from the current rotation table and emails it to the
 * caller (whose email address comes from the session — guaranteed to
 * be a Methodology Admin / Super Admin / Firm Admin by the auth
 * checks below). No body required.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin && !session.user.isFirmAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const to = session.user.email;
  if (!to) return NextResponse.json({ error: 'No email on file for current user' }, { status: 400 });

  const { rows, limits } = await getFamiliarityTable(session.user.firmId);
  const csv = buildCsv(rows);
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10);
  const fileName = `audit-rotation-record-${stamp}.csv`;

  const subject = `Audit Rotation Record snapshot — ${stamp}`;
  const html = `
    <p>Attached is the Audit Rotation Record snapshot taken at ${now.toLocaleString('en-GB')}.</p>
    <p>Limits in force at the time of this snapshot:</p>
    <ul>
      <li>RI familiarity limit (non-PIE): <strong>${limits.riFamiliarityLimitNonPIE}</strong> periods</li>
      <li>RI familiarity limit (PIE): <strong>${limits.riFamiliarityLimitPIE}</strong> periods</li>
    </ul>
    <p>${rows.length} rotation rows in this snapshot.</p>
  `;

  try {
    await sendEmail(to, subject, html, {
      attachments: [{
        name: fileName,
        contentType: 'text/csv',
        contentInBase64: Buffer.from(csv, 'utf8').toString('base64'),
      }],
    });
    return NextResponse.json({ ok: true, to, rowCount: rows.length });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Email send failed' }, { status: 500 });
  }
}

function buildCsv(rows: Array<{
  clientName: string;
  clientIsPIE: boolean;
  userName: string;
  memberType: string;
  role: string;
  auditCategories: string[];
  engagementStartDate: string | null;
  roleStartedDate: string | null;
  ceasedActingDate: string | null;
  servedPeriods: string[];
}>): string {
  const header = [
    'Client', 'PIE', 'Member', 'Member Type', 'Role',
    'Audit Categories', 'Engagement Start', 'Role Started', 'Ceased Acting',
    'Total Periods', 'Period End Dates',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      csvSafe(r.clientName),
      r.clientIsPIE ? 'Yes' : 'No',
      csvSafe(r.userName),
      r.memberType,
      csvSafe(r.role),
      csvSafe(r.auditCategories.join('; ')),
      r.engagementStartDate?.slice(0, 10) || '',
      r.roleStartedDate?.slice(0, 10) || '',
      r.ceasedActingDate?.slice(0, 10) || '',
      String(r.servedPeriods.length),
      csvSafe(r.servedPeriods.map(p => p.slice(0, 10)).join('; ')),
    ].join(','));
  }
  return lines.join('\n');
}

function csvSafe(v: string): string {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
