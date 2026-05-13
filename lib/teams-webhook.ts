/**
 * Microsoft Teams — incoming webhook helper.
 *
 * Each Teams channel can have an "Incoming Webhook" connector that
 * gives you an HTTPS URL. POSTing JSON to that URL drops a message
 * into the channel. We use the legacy MessageCard schema rather than
 * Adaptive Cards because:
 *   • MessageCard renders cleanly in classic Teams + new Teams.
 *   • Adaptive Cards via incoming webhook require a deeper schema
 *     contract (refs, themes, image hosting) which is overkill for
 *     a status digest.
 *
 * https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/connectors-using
 */

interface PostTeamsArgs {
  webhookUrl: string;
  title: string;
  summary: string;
  /** Sections render as collapsible blocks under the title. Each
   *  section has its own heading + body text. */
  sections: Array<{
    heading: string;
    text: string;
  }>;
  /** Optional CTA — link back to the engagement, etc. */
  buttons?: Array<{ label: string; url: string }>;
  /** Optional theme colour (hex without leading #). Defaults to the
   *  Acumon indigo brand colour. */
  themeColor?: string;
}

/**
 * POST a MessageCard to a Teams incoming webhook URL. Returns true on
 * 200 OK (Teams responds with the literal string "1"); false on any
 * other status. Never throws — the runner persists failures into the
 * run row rather than crashing the whole monitoring job.
 */
export async function postToTeamsWebhook(args: PostTeamsArgs): Promise<{ ok: boolean; error?: string }> {
  if (!args.webhookUrl || !/^https:\/\//i.test(args.webhookUrl)) {
    return { ok: false, error: 'Teams webhook URL is missing or not HTTPS' };
  }
  const card = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    summary: args.summary,
    themeColor: args.themeColor || '4F46E5',
    title: args.title,
    sections: args.sections.map(s => ({
      activityTitle: s.heading,
      text: s.text,
      markdown: true,
    })),
    potentialAction: (args.buttons || []).map(b => ({
      '@type': 'OpenUri',
      name: b.label,
      targets: [{ os: 'default', uri: b.url }],
    })),
  };
  try {
    const res = await fetch(args.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Teams responded ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Render a monitoring-report run as a Teams MessageCard payload.
 * Each question becomes its own section with the answer body (or
 * error if the bot call failed for that question).
 */
export function renderMonitoringRunForTeams(args: {
  reportName: string;
  runAt: Date;
  status: 'ok' | 'partial' | 'failed';
  rows: Array<{ question: string; answer: string; error?: string }>;
  portalUrl?: string;
}): Omit<PostTeamsArgs, 'webhookUrl'> {
  const stamp = args.runAt.toLocaleString('en-GB');
  const statusEmoji = args.status === 'ok' ? '✅' : args.status === 'partial' ? '⚠️' : '❌';
  const sections = args.rows.map(r => ({
    heading: r.question,
    text: r.error
      ? `**Error:** ${escapeMarkdown(r.error)}`
      : escapeMarkdown(r.answer),
  }));
  const buttons = args.portalUrl ? [{ label: 'Open audit file', url: args.portalUrl }] : undefined;
  return {
    title: `${statusEmoji} ${args.reportName}`,
    summary: `Audit file monitoring — ${args.reportName} (${args.status}, ${stamp})`,
    sections,
    buttons,
    themeColor:
      args.status === 'ok' ? '10B981' :
      args.status === 'partial' ? 'F59E0B' :
      'EF4444',
  };
}

/** MessageCard text supports a subset of Markdown but renders bare
 *  '\n' as a line break only when the text is inside a section. We
 *  also escape the few characters that Teams over-interprets. */
function escapeMarkdown(s: string): string {
  return (s || '')
    .replace(/\r/g, '')
    // Teams renders `\n\n` as a paragraph break — preserve.
    .replace(/[ \t]+\n/g, '\n')
    // Trim very long answers so a verbose run doesn't blow the
    // MessageCard size limit (≈ 28KB). 4000 chars per question is
    // plenty for a digest.
    .slice(0, 4000);
}
