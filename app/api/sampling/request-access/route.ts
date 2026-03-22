import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/sampling/request-access
 * Request access to the Sample Calculator for a client+period.
 * Sends email to users with Portfolio Rights over the client.
 *
 * Body: { clientId, periodId }
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { clientId, periodId } = await req.json();
  if (!clientId || !periodId) {
    return NextResponse.json({ error: 'clientId and periodId required' }, { status: 400 });
  }

  // Get client details
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      clientName: true,
      firmId: true,
      portfolioManagerId: true,
      portfolioManager: { select: { name: true, email: true } },
    },
  });

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  // Verify requesting user is in the same firm
  if (client.firmId !== session.user.firmId && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Find all users with portfolio rights for this firm
  const portfolioOwners = await prisma.user.findMany({
    where: {
      firmId: client.firmId,
      isActive: true,
      OR: [
        { isPortfolioOwner: true },
        { isFirmAdmin: true },
      ],
    },
    select: { id: true, name: true, email: true },
  });

  if (portfolioOwners.length === 0) {
    return NextResponse.json({ error: 'No portfolio managers found for this client' }, { status: 400 });
  }

  // Get period info
  const period = await prisma.clientPeriod.findUnique({
    where: { id: periodId },
    select: { startDate: true, endDate: true },
  });

  const periodLabel = period
    ? `${period.startDate.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} – ${period.endDate.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`
    : 'Unknown period';

  // Send email via Azure Communication Services
  try {
    const { EmailClient } = await import('@azure/communication-email');
    const connStr = process.env.AZURE_COMMUNICATION_CONNECTION_STRING;
    if (connStr) {
      const emailClient = new EmailClient(connStr);
      const senderAddress = process.env.EMAIL_FROM || 'DoNotReply@acumonintelligence.com';

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1e3a5f;">Access Request — Sample Calculator</h2>
          <p><strong>${session.user.name}</strong> (${session.user.email}) is requesting access to the <strong>Sample Calculator</strong> for:</p>
          <table style="border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 4px 16px 4px 0; color: #666;">Client:</td><td style="padding: 4px 0; font-weight: bold;">${client.clientName}</td></tr>
            <tr><td style="padding: 4px 16px 4px 0; color: #666;">Period:</td><td style="padding: 4px 0;">${periodLabel}</td></tr>
            <tr><td style="padding: 4px 16px 4px 0; color: #666;">Tool:</td><td style="padding: 4px 0;">Sample Calculator (Sampling)</td></tr>
          </table>
          <p>To grant access, please go to <a href="https://acumonintelligence.com/clients/new-period">Client Period Management</a> and assign the Sample Calculator tool to this user for the relevant period.</p>
          <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;" />
          <p style="color: #999; font-size: 12px;">Sent by Acumon Intelligence</p>
        </div>
      `;

      // Send to each portfolio owner
      for (const owner of portfolioOwners) {
        try {
          await emailClient.beginSend({
            senderAddress,
            content: { subject: `Access Request: Sample Calculator — ${client.clientName}`, html },
            recipients: { to: [{ address: owner.email, displayName: owner.name }] },
          });
        } catch (emailErr) {
          console.error(`[Sampling:RequestAccess] Email to ${owner.email} failed:`, emailErr instanceof Error ? emailErr.message : emailErr);
        }
      }
    }
  } catch (err) {
    console.error('[Sampling:RequestAccess] Email error:', err instanceof Error ? err.message : err);
    // Still return success — the request was logged even if email failed
  }

  // Log the access request as an activity
  await prisma.activityLog.create({
    data: {
      userId: session.user.id,
      firmId: client.firmId,
      clientId,
      action: 'sampling_access_request',
      detail: JSON.stringify({
        periodId,
        periodLabel,
        requestedTool: 'Sampling',
        notifiedUsers: portfolioOwners.map(u => ({ id: u.id, name: u.name })),
      }),
    },
  });

  return NextResponse.json({
    ok: true,
    notifiedCount: portfolioOwners.length,
    notifiedUsers: portfolioOwners.map(u => u.name),
  });
}
