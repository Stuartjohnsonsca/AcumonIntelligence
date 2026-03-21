import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifySummaryJobAccess } from '@/lib/client-access';
import { sendEmail, type EmailAttachment } from '@/lib/email';
import {
  generatePortfolioPdf,
  type Finding,
  type FileInfo,
  type FailedFileInfo,
  type QAMessage,
} from '@/lib/doc-summary-pdf';
import { logActivity, logError, requestContext } from '@/lib/logger';

export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let body: {
    jobId?: string;
    recipientEmail?: string;
    recipientName?: string;
    fileIds?: string[];
    jobIds?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { jobId, recipientEmail, recipientName, fileIds, jobIds: extraJobIds } = body;
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });
  if (!recipientEmail) return NextResponse.json({ error: 'recipientEmail required' }, { status: 400 });

  const jobAccess = await verifySummaryJobAccess(
    session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
    jobId,
  );
  if (!jobAccess.allowed) {
    return NextResponse.json({ error: jobAccess.reason || 'Forbidden' }, { status: 403 });
  }

  try {
    // Collect all job IDs (primary + imported)
    const allJobIds = [jobId, ...(extraJobIds || [])];
    const uniqueJobIds = [...new Set(allJobIds)];

    // Verify access to all jobs
    for (const jid of uniqueJobIds.slice(1)) {
      const access = await verifySummaryJobAccess(
        session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
        jid,
      );
      if (!access.allowed) {
        return NextResponse.json({ error: `Forbidden: ${access.reason}` }, { status: 403 });
      }
    }

    const jobs = await Promise.all(
      uniqueJobIds.map((jid) =>
        prisma.docSummaryJob.findUnique({
          where: { id: jid },
          include: {
            client: { select: { clientName: true } },
            user: { select: { name: true, firm: { select: { name: true } } } },
            files: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true, originalName: true, fileSize: true, pageCount: true,
                documentDescription: true, keyTerms: true, missingInformation: true, status: true, errorMessage: true, createdAt: true,
              },
            },
            findings: { orderBy: [{ fileId: 'asc' }, { sortOrder: 'asc' }] },
          },
        }),
      ),
    );

    const primaryJob = jobs[0];
    if (!primaryJob) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const clientName = primaryJob.client.clientName;
    const firmName = primaryJob.user.firm.name;
    const userName = primaryJob.user.name;
    const exportDate = new Date();

    // Merge files and findings from all jobs
    const files: FileInfo[] = [];
    const failedFiles: FailedFileInfo[] = [];
    const findings: Finding[] = [];

    for (const job of jobs) {
      if (!job) continue;
      const fnMap = new Map(job.files.map((f) => [f.id, f.originalName]));
      const analysed = job.files.filter((f) => f.status === 'analysed');
      const failed = job.files.filter((f) => f.status === 'failed');
      for (const f of analysed) {
        files.push({
          id: f.id, originalName: f.originalName, fileSize: f.fileSize,
          pageCount: f.pageCount, documentDescription: f.documentDescription || null,
          keyTerms: (f.keyTerms as FileInfo['keyTerms']) || null,
          missingInformation: (f.missingInformation as FileInfo['missingInformation']) || null,
          createdAt: f.createdAt.toISOString(), uploadedBy: userName,
        });
      }
      for (const f of failed) {
        failedFiles.push({
          originalName: f.originalName, fileSize: f.fileSize,
          createdAt: f.createdAt.toISOString(), errorMessage: f.errorMessage,
        });
      }
      const analysedIds = new Set(analysed.map((f) => f.id));
      for (const f of job.findings) {
        if (!analysedIds.has(f.fileId)) continue;
        findings.push({
          id: f.id, area: f.area, finding: f.finding, clauseReference: f.clauseReference,
          isSignificantRisk: f.isSignificantRisk, aiSignificantRisk: f.aiSignificantRisk,
          userResponse: f.userResponse, addToTesting: f.addToTesting, reviewed: f.reviewed,
          fileId: f.fileId, fileName: fnMap.get(f.fileId) || 'Unknown',
          accountingImpact: f.accountingImpact ?? null, auditImpact: f.auditImpact ?? null,
        });
      }
    }

    // Fetch Q&A messages
    const qaRows = await prisma.docSummaryQA.findMany({
      where: { jobId: { in: allJobIds } },
      orderBy: [{ fileId: 'asc' }, { turnOrder: 'asc' }],
      select: { id: true, fileId: true, role: true, content: true, createdAt: true },
    });
    const qaMessages: Record<string, QAMessage[]> = {};
    for (const row of qaRows) {
      if (!qaMessages[row.fileId]) qaMessages[row.fileId] = [];
      qaMessages[row.fileId].push({ id: row.id, role: row.role, content: row.content, createdAt: row.createdAt.toISOString() });
    }

    const pdfBytes = await generatePortfolioPdf({
      jobId,
      findings,
      files,
      clientName,
      firmName,
      userName,
      exportDate,
      failedFiles,
      selectedFileIds: fileIds,
      qaMessages,
    });

    const pdfBase64 = Buffer.from(pdfBytes).toString('base64');
    const safeClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateStr = exportDate.toISOString().slice(0, 10);
    const filename = `Portfolio-Report-${safeClientName}-${dateStr}.pdf`;

    const formattedDate = exportDate.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    const displayName = recipientName || recipientEmail;
    const subject = `Portfolio Document Summary Report \u2014 ${clientName}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 30px; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Acumon Intelligence</h1>
        </div>
        <div style="background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0;">
          <p style="color: #374151; font-size: 16px;">Hello ${displayName},</p>
          <p style="color: #374151; font-size: 16px;">
            Please find attached the Portfolio Document Summary report for <strong>${clientName}</strong>,
            generated by ${userName} on ${formattedDate}.
          </p>
          <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
            This report was generated using the Acumon Intelligence platform.
          </p>
        </div>
      </div>
    `;

    const attachment: EmailAttachment = {
      name: filename,
      contentType: 'application/pdf',
      contentInBase64: pdfBase64,
    };

    console.log(`[DocSummary:SendPortfolioEmail] Sending to ${recipientEmail} | jobId=${jobId} | client=${clientName}`);

    const result = await sendEmail(recipientEmail, subject, html, {
      displayName,
      attachments: [attachment],
    });

    console.log(`[DocSummary:SendPortfolioEmail] Sent | messageId=${result.messageId}`);

    logActivity({
      userId: session.user.id,
      firmId: (session.user as { firmId?: string }).firmId,
      clientId: primaryJob.clientId,
      action: 'send_portfolio_email',
      tool: 'doc-summary',
      detail: { jobId, recipient: recipientEmail, fileIds },
      ipAddress: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ success: true, messageId: result.messageId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[DocSummary:SendPortfolioEmail] Failed | jobId=${jobId} | error=${msg}`);
    logError({
      userId: session.user.id,
      route: '/api/doc-summary/send-portfolio-email',
      tool: 'doc-summary',
      message: msg,
      stack: error instanceof Error ? error.stack : undefined,
      context: requestContext(req),
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
