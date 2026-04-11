import { NextRequest, NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

// GET: List all tax chats for an engagement, optionally filtered by category
export async function GET(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(req.url);
  const category = url.searchParams.get('category');

  const where: any = { engagementId };
  if (category) where.taxCategory = category;

  const chats = await prisma.auditTaxChat.findMany({
    where,
    orderBy: [{ taxCategory: 'asc' }, { chatNumber: 'asc' }],
  });

  return NextResponse.json({ chats });
}

// POST: Create a new tax chat or add a message to an existing chat
export async function POST(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  const body = await req.json();

  // Create new chat
  if (body.action === 'create') {
    const { taxCategory, businessBackground, assignedToId, assignedToName, assignedToType, initialMessage } = body;
    if (!taxCategory) return NextResponse.json({ error: 'taxCategory is required' }, { status: 400 });

    // Get next chat number for this category
    const lastChat = await prisma.auditTaxChat.findFirst({
      where: { engagementId, taxCategory },
      orderBy: { chatNumber: 'desc' },
      select: { chatNumber: true },
    });
    const chatNumber = (lastChat?.chatNumber || 0) + 1;

    const messages: any[] = [];
    if (businessBackground) {
      messages.push({
        id: crypto.randomUUID(),
        userId: 'system',
        userName: 'System',
        role: 'system',
        message: `Business Background:\n${businessBackground}`,
        createdAt: new Date().toISOString(),
      });
    }
    if (initialMessage) {
      messages.push({
        id: crypto.randomUUID(),
        userId: session.user.id,
        userName: session.user.name || session.user.email || 'Unknown',
        role: 'audit_team',
        message: initialMessage,
        createdAt: new Date().toISOString(),
      });
    }

    const chat = await prisma.auditTaxChat.create({
      data: {
        engagementId,
        taxCategory,
        chatNumber,
        businessBackground: businessBackground || null,
        createdById: session.user.id,
        createdByName: session.user.name || session.user.email || 'Unknown',
        assignedToId: assignedToId || null,
        assignedToName: assignedToName || null,
        assignedToType: assignedToType || 'internal',
        messages,
      },
    });

    return NextResponse.json({ chat }, { status: 201 });
  }

  // Add message to existing chat
  if (body.action === 'message') {
    const { chatId, message, role } = body;
    if (!chatId || !message) return NextResponse.json({ error: 'chatId and message are required' }, { status: 400 });

    const chat = await prisma.auditTaxChat.findUnique({ where: { id: chatId } });
    if (!chat || chat.engagementId !== engagementId) return NextResponse.json({ error: 'Chat not found' }, { status: 404 });

    const messages = (chat.messages as any[]) || [];
    messages.push({
      id: crypto.randomUUID(),
      userId: session.user.id,
      userName: session.user.name || session.user.email || 'Unknown',
      role: role || 'audit_team',
      message,
      createdAt: new Date().toISOString(),
    });

    await prisma.auditTaxChat.update({
      where: { id: chatId },
      data: { messages },
    });

    return NextResponse.json({ ok: true, messageCount: messages.length });
  }

  // Conclude chat
  if (body.action === 'conclude') {
    const { chatId, conclusion, conclusionStatus } = body;
    if (!chatId) return NextResponse.json({ error: 'chatId is required' }, { status: 400 });

    await prisma.auditTaxChat.update({
      where: { id: chatId },
      data: {
        status: 'concluded',
        conclusion: conclusion || null,
        conclusionStatus: conclusionStatus || 'correct',
      },
    });

    return NextResponse.json({ ok: true });
  }

  // Delegate to another person
  if (body.action === 'delegate') {
    const { chatId, delegatedToId, delegatedToName } = body;
    if (!chatId) return NextResponse.json({ error: 'chatId is required' }, { status: 400 });

    await prisma.auditTaxChat.update({
      where: { id: chatId },
      data: {
        delegatedToId: delegatedToId || null,
        delegatedToName: delegatedToName || null,
      },
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
