import { sendEmail } from '@/lib/email';
import { prisma } from '@/lib/db';
import { branchUrl, commitUrl, compareUrl, getRepoConfig } from './github';
import type { ErrorAutoFix, User } from '@prisma/client';

const APP_URL = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://app.acumonintelligence.com';

interface FixWithReporter extends ErrorAutoFix {
  reporter?: Pick<User, 'id' | 'name' | 'email'> | null;
}

async function getSuperAdminEmails(): Promise<{ email: string; name: string }[]> {
  const admins = await prisma.user.findMany({
    where: { isSuperAdmin: true, isActive: true },
    select: { email: true, name: true },
  });
  return admins.filter((a) => !!a.email);
}

function frame(title: string, body: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 720px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #b91c1c 0%, #ef4444 100%); padding: 20px 28px; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; font-size: 18px; margin: 0;">Acumon Intelligence — Self-Healing</h1>
        <p style="color: rgba(255,255,255,0.9); font-size: 13px; margin: 4px 0 0;">${title}</p>
      </div>
      <div style="background: white; padding: 22px 28px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
        ${body}
      </div>
    </div>
  `;
}

function escapeHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function sendInitialErrorNotification(fix: FixWithReporter): Promise<void> {
  const admins = await getSuperAdminEmails();
  if (admins.length === 0) return;

  const sourceLabel = fix.source === 'user_reported' ? `Reported by ${fix.reporter?.name || 'a user'}` : 'Auto-detected';

  const body = `
    <p style="color: #334155; font-size: 14px; margin-top: 0;">
      <strong style="color: #b91c1c;">${sourceLabel}</strong> — AI is now analysing this error and will attempt a fix.
    </p>
    <table style="width: 100%; font-size: 13px; color: #475569; border-collapse: collapse; margin: 12px 0;">
      <tr><td style="padding: 4px 8px 4px 0; color: #64748b; width: 130px;">Reference</td><td><code style="background:#f1f5f9; padding:2px 6px; border-radius:4px;">${fix.id}</code></td></tr>
      <tr><td style="padding: 4px 8px 4px 0; color: #64748b;">URL</td><td>${escapeHtml(fix.url) || '—'}</td></tr>
      ${fix.httpStatus ? `<tr><td style="padding: 4px 8px 4px 0; color: #64748b;">HTTP status</td><td>${fix.httpStatus}</td></tr>` : ''}
      ${fix.errorMessage ? `<tr><td style="padding: 4px 8px 4px 0; color: #64748b; vertical-align:top;">Error message</td><td><code style="background:#fef2f2; color:#b91c1c; padding:2px 6px; border-radius:4px; word-break: break-word;">${escapeHtml(fix.errorMessage)}</code></td></tr>` : ''}
      ${fix.userDescription ? `<tr><td style="padding: 4px 8px 4px 0; color: #64748b; vertical-align:top;">User description</td><td>${escapeHtml(fix.userDescription)}</td></tr>` : ''}
      ${fix.superAdminMessage ? `<tr><td style="padding: 4px 8px 4px 0; color: #64748b; vertical-align:top;">Message to admins</td><td>${escapeHtml(fix.superAdminMessage)}</td></tr>` : ''}
    </table>
    <p style="color:#94a3b8; font-size: 12px;">You'll receive a follow-up email when analysis completes (typically &lt;1 min).</p>
    <p style="text-align:center; margin: 18px 0 4px;">
      <a href="${APP_URL}/methodology-admin/error-fixes/${fix.id}" style="display:inline-block; padding:10px 18px; background:#1e40af; color:white; text-decoration:none; border-radius:8px; font-weight:600; font-size:13px;">Open in Admin Queue</a>
    </p>
  `;

  const html = frame(`New error reported · ${fix.source.replace('_', ' ')}`, body);
  const subject = fix.source === 'user_reported'
    ? `[Acumon] User-reported error: ${(fix.userDescription || fix.errorMessage || '').slice(0, 60)}`
    : `[Acumon] Auto-detected error: ${(fix.errorMessage || fix.url || '').slice(0, 60)}`;

  await Promise.allSettled(
    admins.map((a) => sendEmail(a.email, subject, html, { displayName: a.name }))
  );
}

export async function sendCompletionNotification(fix: ErrorAutoFix): Promise<void> {
  const admins = await getSuperAdminEmails();
  if (admins.length === 0) return;

  const repo = getRepoConfig();
  const branchLink = fix.branchName ? `<a href="${branchUrl(fix.branchName)}" style="color:#1e40af;">${escapeHtml(fix.branchName)}</a>` : '—';
  const commitLink = fix.commitSha ? `<a href="${commitUrl(fix.commitSha)}" style="color:#1e40af;"><code>${fix.commitSha.slice(0, 7)}</code></a>` : '—';
  const compareLink = fix.branchName ? `<a href="${compareUrl(fix.branchName)}" style="color:#1e40af;">view diff</a>` : '';
  const adminLink = `${APP_URL}/methodology-admin/error-fixes/${fix.id}`;
  const revertLink = fix.commitSha ? `${APP_URL}/methodology-admin/error-fixes/${fix.id}#revert` : '';

  let statusBlurb = '';
  switch (fix.status) {
    case 'merged':
      statusBlurb = `<p style="color: #047857; font-weight:600;">✓ Auto-merged to <code>${repo.baseBranch}</code>. Vercel will redeploy automatically. Click revert below if this fix is bad.</p>`;
      break;
    case 'branch_created':
      statusBlurb = `<p style="color: #1e40af; font-weight:600;">→ Branch ready for review. Manual merge required.</p>`;
      break;
    case 'no_fix_proposed':
      statusBlurb = `<p style="color: #b45309; font-weight:600;">⚠ AI did not propose a fix. Manual investigation needed.</p>`;
      break;
    case 'failed':
      statusBlurb = `<p style="color: #b91c1c; font-weight:600;">✗ Fix attempt failed. Reason: ${escapeHtml(fix.processingError) || 'unknown'}</p>`;
      break;
  }

  const body = `
    ${statusBlurb}
    <table style="width: 100%; font-size: 13px; color: #475569; border-collapse: collapse; margin: 12px 0;">
      <tr><td style="padding: 4px 8px 4px 0; color: #64748b; width: 130px;">Reference</td><td><code style="background:#f1f5f9; padding:2px 6px; border-radius:4px;">${fix.id}</code></td></tr>
      <tr><td style="padding: 4px 8px 4px 0; color: #64748b;">Source</td><td>${fix.source.replace('_', ' ')}</td></tr>
      <tr><td style="padding: 4px 8px 4px 0; color: #64748b;">Branch</td><td>${branchLink} ${compareLink ? '· ' + compareLink : ''}</td></tr>
      <tr><td style="padding: 4px 8px 4px 0; color: #64748b;">Commit</td><td>${commitLink}</td></tr>
      <tr><td style="padding: 4px 8px 4px 0; color: #64748b; vertical-align:top;">URL</td><td>${escapeHtml(fix.url) || '—'}</td></tr>
      ${fix.errorMessage ? `<tr><td style="padding: 4px 8px 4px 0; color: #64748b; vertical-align:top;">Error</td><td><code style="background:#fef2f2; color:#b91c1c; padding:2px 6px; border-radius:4px;">${escapeHtml(fix.errorMessage)}</code></td></tr>` : ''}
    </table>

    ${fix.claudeAnalysis ? `
      <h3 style="color: #1e293b; font-size: 13px; margin: 18px 0 6px;">AI diagnosis</h3>
      <div style="background:#f8fafc; border-left:3px solid #6366f1; padding:10px 14px; font-size:13px; color:#334155; white-space: pre-wrap;">${escapeHtml(fix.claudeAnalysis)}</div>
    ` : ''}

    <p style="text-align:center; margin: 22px 0 4px;">
      <a href="${adminLink}" style="display:inline-block; padding:10px 18px; background:#1e40af; color:white; text-decoration:none; border-radius:8px; font-weight:600; font-size:13px; margin-right: 6px;">Open in Admin Queue</a>
      ${revertLink && fix.autoMerged ? `<a href="${revertLink}" style="display:inline-block; padding:10px 18px; background:#b91c1c; color:white; text-decoration:none; border-radius:8px; font-weight:600; font-size:13px;">Revert this fix</a>` : ''}
    </p>
  `;

  const html = frame(`Fix attempt complete · ${fix.status}`, body);
  const subject = `[Acumon Self-Healing] ${fix.status} · ${(fix.errorMessage || fix.url || fix.userDescription || '').slice(0, 60)}`;

  await Promise.allSettled(
    admins.map((a) => sendEmail(a.email, subject, html, { displayName: a.name }))
  );
}
