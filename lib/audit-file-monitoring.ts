/**
 * Audit File Monitoring — runner + scheduler helpers.
 *
 * A monitoring report is a saved list of questions the firm wants the
 * InterrogateBot to re-answer on a regular cadence. This module:
 *
 *   • computeNextRunAt(frequency, from?) — derives the next due
 *     timestamp from a frequency. Used when the report is created /
 *     updated and after every successful run.
 *   • runMonitoringReport(reportId, opts) — answers every question
 *     in the report, persists an AuditFileMonitoringRun, optionally
 *     emails the recipients, and updates the report's lastRunAt /
 *     nextRunAt.
 *   • findDueMonitoringReports() — scans for active reports whose
 *     nextRunAt has passed. Used by the cron sweep.
 *
 * The runner is deliberately tolerant of per-question failures — a
 * single bot timeout shouldn't abort the whole report. Partial runs
 * mark status='partial' and capture the per-question error.
 */

import { prisma } from '@/lib/db';
import { buildTemplateContext } from '@/lib/template-context';
import { askInterrogateBot } from '@/lib/interrogate-bot';
import { sendEmail } from '@/lib/email';
import { postToTeamsWebhook, renderMonitoringRunForTeams } from '@/lib/teams-webhook';
import { resolvePortalPublicUrl } from '@/lib/portal-public-url';

export type Frequency = 'manual' | 'daily' | 'weekly' | 'monthly';

interface AnswerRow {
  question: string;
  answer: string;
  /** Plain JSON-path or document citations parsed from the answer. */
  citations?: string[];
  /** Per-question error when the bot call failed. Other questions in
   *  the same run can still succeed. */
  error?: string;
}

/**
 * Compute the next time a report of `frequency` should run. Anchors
 * scheduled runs to a sensible time-of-day (08:00 UTC) rather than
 * "now + 24h" so the audit team consistently sees fresh reports each
 * morning rather than at random points in the day.
 *
 * Manual reports return null — the cron skips them, only manual runs
 * fire them.
 */
export function computeNextRunAt(
  frequency: Frequency,
  from: Date = new Date(),
): Date | null {
  if (frequency === 'manual') return null;
  const next = new Date(from);
  next.setUTCHours(8, 0, 0, 0);
  // If the anchored time is in the past, push forward to the next slot.
  if (next.getTime() <= from.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  if (frequency === 'daily') return next;
  if (frequency === 'weekly') {
    // Roll forward to the next Monday so weekly reports land at the
    // start of the working week.
    const day = next.getUTCDay(); // 0=Sun..6=Sat
    const daysUntilMonday = (1 - day + 7) % 7;
    if (daysUntilMonday > 0) {
      next.setUTCDate(next.getUTCDate() + daysUntilMonday);
    } else if (next.getTime() <= from.getTime()) {
      next.setUTCDate(next.getUTCDate() + 7);
    }
    return next;
  }
  // monthly — roll to the 1st of next month at 08:00.
  const monthly = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 1, 8, 0, 0, 0));
  return monthly;
}

/**
 * Find every active scheduled report whose nextRunAt is <= now. Used
 * by the hourly cron sweep.
 */
export async function findDueMonitoringReports(now: Date = new Date()) {
  return prisma.auditFileMonitoringReport.findMany({
    where: {
      isActive: true,
      frequency: { in: ['daily', 'weekly', 'monthly'] },
      nextRunAt: { lte: now, not: null },
    },
    select: { id: true, engagementId: true, frequency: true },
    orderBy: { nextRunAt: 'asc' },
    take: 100, // cap per-tick fan-out
  });
}

/**
 * Run a single monitoring report. Loads the questions, asks the bot
 * for each one in sequence, persists a run row, optionally emails the
 * recipients, and advances the schedule.
 */
export async function runMonitoringReport(
  reportId: string,
  opts: { trigger?: 'manual' | 'scheduled' } = {},
): Promise<{ runId: string; status: 'ok' | 'partial' | 'failed' }> {
  const trigger = opts.trigger ?? 'scheduled';
  const report = await prisma.auditFileMonitoringReport.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      engagementId: true,
      name: true,
      questions: true,
      frequency: true,
      emailRecipients: true,
      teamsWebhookUrl: true,
      deliveryMethods: true,
    },
  });
  if (!report) throw new Error(`Monitoring report ${reportId} not found`);

  const questions = Array.isArray(report.questions) ? (report.questions as unknown[]).filter(q => typeof q === 'string' && q.trim()) as string[] : [];
  if (questions.length === 0) {
    // Empty report — still create a run row so the UI shows the
    // attempt, but mark it failed so the auditor knows to add
    // questions.
    const empty = await prisma.auditFileMonitoringRun.create({
      data: {
        reportId: report.id,
        engagementId: report.engagementId,
        trigger,
        answers: [],
        status: 'failed',
        errorMessage: 'No questions configured on this report.',
      },
    });
    return { runId: empty.id, status: 'failed' };
  }

  // One template-context load per run; askInterrogateBot reuses the
  // same context across questions to keep the prompt grounded.
  let templateContext;
  try {
    templateContext = await buildTemplateContext(report.engagementId);
  } catch (err: any) {
    const failed = await prisma.auditFileMonitoringRun.create({
      data: {
        reportId: report.id,
        engagementId: report.engagementId,
        trigger,
        answers: [],
        status: 'failed',
        errorMessage: `Failed to load engagement context: ${err?.message || 'unknown'}`,
      },
    });
    return { runId: failed.id, status: 'failed' };
  }

  const results: AnswerRow[] = [];
  let okCount = 0;
  let failCount = 0;
  for (const question of questions) {
    try {
      const response = await askInterrogateBot(templateContext, question, [], [], []);
      const answer = String(response?.answer || '').trim() || 'No response.';
      results.push({ question, answer });
      okCount++;
    } catch (err: any) {
      results.push({
        question,
        answer: '',
        error: err?.message || 'Bot call failed',
      });
      failCount++;
    }
  }

  const status: 'ok' | 'partial' | 'failed' =
    failCount === 0 ? 'ok' : okCount === 0 ? 'failed' : 'partial';

  // Delivery method gating — only push to a channel if BOTH the
  // method is in deliveryMethods AND the matching target field is
  // populated. This keeps recipient lists intact while letting the
  // user pause a channel by toggling its checkbox off.
  const methods: string[] = Array.isArray(report.deliveryMethods)
    ? (report.deliveryMethods as unknown[]).filter((m): m is string => typeof m === 'string')
    : [];
  const wantsEmail = methods.includes('email');
  const wantsTeams = methods.includes('teams');

  const recipients = Array.isArray(report.emailRecipients)
    ? (report.emailRecipients as unknown[]).filter(e => typeof e === 'string' && /\S+@\S+/.test(e as string)) as string[]
    : [];

  const runAt = new Date();
  const run = await prisma.auditFileMonitoringRun.create({
    data: {
      reportId: report.id,
      engagementId: report.engagementId,
      trigger,
      answers: results as any,
      status,
      emailedTo: wantsEmail && recipients.length ? recipients : undefined,
    },
  });

  // Advance the schedule + lastRunAt on scheduled runs. Manual runs
  // don't bump nextRunAt — the audit team is just spot-checking.
  if (trigger === 'scheduled') {
    await prisma.auditFileMonitoringReport.update({
      where: { id: report.id },
      data: {
        lastRunAt: new Date(),
        nextRunAt: computeNextRunAt(report.frequency as Frequency, new Date()),
      },
    });
  } else {
    await prisma.auditFileMonitoringReport.update({
      where: { id: report.id },
      data: { lastRunAt: new Date() },
    });
  }

  // Best-effort delivery — failures land in console.error and never
  // fail the run. The run row stays usable in-app regardless of
  // whether a push channel succeeded.
  if (wantsEmail && recipients.length > 0) {
    try {
      await sendEmail(
        recipients[0],
        `Audit file monitoring — ${report.name}`,
        renderReportEmailHtml(report.name, results),
        recipients.length > 1
          ? { displayName: recipients[0] }
          : undefined,
      );
    } catch (err) {
      console.error('[monitoring] email send failed', err);
    }
  }

  if (wantsTeams && report.teamsWebhookUrl) {
    try {
      // Dynamically resolved — picks up the deployed Vercel URL
      // automatically once it's live, no env var required. Manual
      // PORTAL_PUBLIC_URL still wins when set as an override.
      const portalBase = resolvePortalPublicUrl();
      const portalUrl = portalBase ? `${portalBase}/methodology/engagements/${report.engagementId}` : undefined;
      const card = renderMonitoringRunForTeams({
        reportName: report.name,
        runAt,
        status,
        rows: results,
        portalUrl,
      });
      const teamsResult = await postToTeamsWebhook({ webhookUrl: report.teamsWebhookUrl, ...card });
      if (!teamsResult.ok) {
        console.error('[monitoring] Teams post failed', teamsResult.error);
      }
    } catch (err) {
      console.error('[monitoring] Teams post threw', err);
    }
  }

  return { runId: run.id, status };
}

/** Tiny HTML renderer for the email digest. Kept inline because the
 *  existing email helpers are simple sendEmail() calls with HTML
 *  strings. */
function renderReportEmailHtml(name: string, rows: AnswerRow[]): string {
  const escape = (s: string) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const items = rows.map(r => `
    <div style="margin: 16px 0; padding: 12px; background: #f8fafc; border-left: 3px solid #2563eb; border-radius: 4px;">
      <p style="margin: 0 0 6px 0; font-weight: 600; color: #1e3a5f; font-size: 13px;">${escape(r.question)}</p>
      ${r.error
        ? `<p style="margin: 0; color: #b91c1c; font-size: 12px;">Error: ${escape(r.error)}</p>`
        : `<p style="margin: 0; white-space: pre-wrap; color: #374151; font-size: 13px; line-height: 1.5;">${escape(r.answer)}</p>`}
    </div>
  `).join('\n');
  return `
    <div style="font-family: Arial, sans-serif; max-width: 720px; margin: 0 auto;">
      <h2 style="color: #1e3a5f; font-size: 18px;">${escape(name)}</h2>
      <p style="color: #6b7280; font-size: 12px;">Automated monitoring report generated by Acumon Intelligence.</p>
      ${items}
    </div>
  `;
}
