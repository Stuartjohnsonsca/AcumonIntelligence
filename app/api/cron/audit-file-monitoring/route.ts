/**
 * Cron — Audit File Monitoring sweeps.
 *
 * Hit hourly by Vercel cron (configured in vercel.json). Finds every
 * active monitoring report whose nextRunAt has passed and runs it.
 * Each run loops the report's questions through the InterrogateBot
 * and persists the answers to audit_file_monitoring_runs.
 *
 * Auth: shared CRON_SECRET secret, matching the existing portal-
 * escalation cron pattern. Accepts both ?secret=… and Bearer header.
 *
 * Bounded concurrency: we fan out reports sequentially in the same
 * invocation to avoid blowing Together / Anthropic rate limits. The
 * findDueMonitoringReports helper caps at 100 reports per tick — at
 * a 1-hour cadence that's 2,400 reports/day, plenty of headroom for
 * the immediate roadmap.
 */

import { NextResponse } from 'next/server';
import {
  findDueMonitoringReports,
  runMonitoringReport,
} from '@/lib/audit-file-monitoring';

function isAuthorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const url = new URL(req.url);
  if (url.searchParams.get('secret') === secret) return true;
  const auth = req.headers.get('authorization') || '';
  if (auth === `Bearer ${secret}`) return true;
  return false;
}

export async function GET(req: Request) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const due = await findDueMonitoringReports();
  const results: Array<{ reportId: string; status: string; error?: string }> = [];

  for (const report of due) {
    try {
      const { status } = await runMonitoringReport(report.id, { trigger: 'scheduled' });
      results.push({ reportId: report.id, status });
    } catch (err: any) {
      results.push({
        reportId: report.id,
        status: 'failed',
        error: err?.message || String(err),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    inspected: due.length,
    results,
  });
}

export const POST = GET;
