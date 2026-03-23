import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { sessionId, recipientEmail } = await req.json();
  if (!sessionId || !recipientEmail) {
    return NextResponse.json({ error: 'sessionId and recipientEmail required' }, { status: 400 });
  }

  const btbSession = await prisma.bankToTBSession.findUnique({
    where: { id: sessionId },
    include: { client: true, period: true },
  });

  if (!btbSession || btbSession.userId !== session.user.id) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Generate the XLSX by calling the download endpoint internally
  const downloadResponse = await fetch(new URL('/api/bank-to-tb/export/download', req.url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: req.headers.get('cookie') || '',
    },
    body: JSON.stringify({ sessionId }),
  });

  if (!downloadResponse.ok) {
    return NextResponse.json({ error: 'Failed to generate export' }, { status: 500 });
  }

  // For now, return a success message. Email sending would use Azure Communication Services.
  // The actual email implementation would mirror the doc-summary export pattern.
  return NextResponse.json({
    success: true,
    message: `Export would be emailed to ${recipientEmail}`,
    note: 'Email integration pending - use Download for now',
  });
}
