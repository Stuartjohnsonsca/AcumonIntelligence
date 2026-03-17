import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');

  if (!token) {
    return htmlResponse('Invalid Link', 'No approval token provided.', false);
  }

  const request = await prisma.accessRequest.findUnique({ where: { token } });

  if (!request) {
    return htmlResponse('Invalid Link', 'This approval link is invalid or has already been used.', false);
  }

  if (request.clientId !== clientId) {
    return htmlResponse('Invalid Link', 'This approval link does not match the client.', false);
  }

  if (request.status !== 'pending') {
    return htmlResponse('Already Processed', `This request has already been ${request.status}.`, false);
  }

  if (request.expiresAt < new Date()) {
    await prisma.accessRequest.update({ where: { token }, data: { status: 'expired' } });
    return htmlResponse('Link Expired', 'This approval link has expired. The user will need to request access again.', false);
  }

  const existing = await prisma.userClientAssignment.findUnique({
    where: { userId_clientId: { userId: request.userId, clientId: request.clientId } },
  });

  if (existing) {
    await prisma.accessRequest.update({ where: { token }, data: { status: 'approved', respondedAt: new Date() } });
    return htmlResponse('Already Assigned', 'This user already has access to this client.', true);
  }

  await prisma.$transaction([
    prisma.userClientAssignment.create({
      data: { userId: request.userId, clientId: request.clientId },
    }),
    prisma.accessRequest.update({
      where: { token },
      data: { status: 'approved', respondedAt: new Date() },
    }),
  ]);

  const user = await prisma.user.findUnique({ where: { id: request.userId }, select: { name: true, email: true } });
  const client = await prisma.client.findUnique({ where: { id: request.clientId }, select: { clientName: true } });

  return htmlResponse(
    'Access Approved',
    `<strong>${user?.name || user?.email}</strong> now has access to <strong>${client?.clientName}</strong>.`,
    true,
  );
}

function htmlResponse(title: string, message: string, success: boolean) {
  const colour = success ? '#16a34a' : '#dc2626';
  const icon = success ? '✓' : '✗';

  return new NextResponse(
    `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} — Acumon Intelligence</title></head>
<body style="font-family:Arial,sans-serif;background:#f1f5f9;margin:0;padding:40px 20px;display:flex;justify-content:center;align-items:flex-start;">
  <div style="max-width:480px;width:100%;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,.07);">
    <div style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);padding:24px 30px;">
      <h1 style="color:white;margin:0;font-size:22px;">Acumon Intelligence</h1>
    </div>
    <div style="padding:30px;text-align:center;">
      <div style="width:56px;height:56px;border-radius:50%;background:${colour}15;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;">
        <span style="font-size:28px;color:${colour};">${icon}</span>
      </div>
      <h2 style="color:#1e293b;margin:0 0 12px;">${title}</h2>
      <p style="color:#64748b;line-height:1.6;">${message}</p>
      <a href="/" style="display:inline-block;margin-top:24px;background:#2563eb;color:white;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Go to Acumon Intelligence</a>
    </div>
  </div>
</body>
</html>`,
    { status: 200, headers: { 'Content-Type': 'text/html' } },
  );
}
