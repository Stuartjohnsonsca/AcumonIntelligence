import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { sendXeroAccessRequestEmail } from '@/lib/email';
import crypto from 'crypto';

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const body = await req.json();
    const { clientId } = body;
    if (!clientId) {
      return NextResponse.json({ error: 'clientId required' }, { status: 400 });
    }

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: {
        clientName: true,
        contactName: true,
        contactEmail: true,
        firmId: true,
      },
    });

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    if (!client.contactEmail) {
      return NextResponse.json(
        { error: 'No contact email set for this client. Please add a contact email in the Clients tab.' },
        { status: 400 },
      );
    }

    if (!session.user.isSuperAdmin && client.firmId !== session.user.firmId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const pending = await prisma.xeroAuthRequest.findFirst({
      where: {
        clientId,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
    });

    if (pending) {
      const ageMs = Date.now() - new Date(pending.createdAt).getTime();
      const isStale = true;

      if (pending.recipientEmail !== client.contactEmail || isStale) {
        await prisma.xeroAuthRequest.update({
          where: { id: pending.id },
          data: { status: 'expired' },
        });
      } else {
        return NextResponse.json(
          { error: `An access request was just sent to ${pending.recipientEmail}. Please wait a few minutes for the client to authorise, or update the client contact email to send a new request.` },
          { status: 409 },
        );
      }
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.xeroAuthRequest.create({
      data: {
        clientId,
        requestedBy: session.user.email || session.user.name || 'Unknown',
        recipientEmail: client.contactEmail,
        recipientName: client.contactName,
        token,
        expiresAt,
      },
    });

    const baseUrl = process.env.NEXTAUTH_URL || 'https://acumon-intelligence.vercel.app';
    const authoriseUrl = `${baseUrl}/xero-authorise/${token}`;

    let emailResult;
    try {
      emailResult = await sendXeroAccessRequestEmail(
        client.contactEmail,
        client.contactName || 'Client',
        client.clientName,
        session.user.name || session.user.email || 'Your auditor',
        authoriseUrl,
      );
    } catch (emailErr) {
      console.error('Failed to send Xero access request email:', emailErr);
      await prisma.xeroAuthRequest.deleteMany({ where: { token } });
      return NextResponse.json(
        { error: `Failed to send email to ${client.contactEmail}: ${emailErr instanceof Error ? emailErr.message : 'Unknown error'}` },
        { status: 500 },
      );
    }

    return NextResponse.json({
      message: `Access request sent to ${client.contactEmail}`,
      expiresAt: expiresAt.toISOString(),
      emailStatus: 'sent',
      emailMessageId: emailResult?.messageId || null,
    });
  } catch (err) {
    console.error('Xero request-access error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'An unexpected error occurred' },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 });
  }

  const latest = await prisma.xeroAuthRequest.findFirst({
    where: { clientId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      recipientEmail: true,
      createdAt: true,
      expiresAt: true,
      respondedAt: true,
    },
  });

  if (latest && latest.status === 'pending') {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { contactEmail: true },
    });

    if (client?.contactEmail && client.contactEmail !== latest.recipientEmail) {
      await prisma.xeroAuthRequest.update({
        where: { id: latest.id },
        data: { status: 'expired' },
      });
      return NextResponse.json({ request: null });
    }
  }

  return NextResponse.json({ request: latest ? { status: latest.status, recipientEmail: latest.recipientEmail, createdAt: latest.createdAt, expiresAt: latest.expiresAt, respondedAt: latest.respondedAt } : null });
}
