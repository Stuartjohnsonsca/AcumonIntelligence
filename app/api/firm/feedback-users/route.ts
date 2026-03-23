import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// GET: List all IA Feedback Users for the firm
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const firmId = request.nextUrl.searchParams.get('firmId') || session.user.firmId;

    const feedbackUsers = await prisma.iAFeedbackUser.findMany({
      where: { firmId, isActive: true },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({
      users: feedbackUsers.map(fu => ({
        id: fu.id,
        userId: fu.userId,
        userName: fu.user.name,
        userEmail: fu.user.email,
        isActive: fu.isActive,
      })),
    });
  } catch (err) {
    console.error('[FeedbackUsers:GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST: Add a user as IA Feedback User (by email)
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isFirmAdmin = session.user.isFirmAdmin || session.user.isSuperAdmin;
    if (!isFirmAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { firmId: requestFirmId, email, userId: directUserId } = await request.json();
    const firmId = requestFirmId || session.user.firmId;

    // Find user by email or direct userId
    let targetUserId = directUserId;
    if (!targetUserId && email) {
      const user = await prisma.user.findFirst({
        where: { email: email.toLowerCase().trim(), firmId },
      });
      if (!user) {
        return NextResponse.json({ error: 'User not found in this firm' }, { status: 404 });
      }
      targetUserId = user.id;
    }

    if (!targetUserId) {
      return NextResponse.json({ error: 'email or userId is required' }, { status: 400 });
    }

    // Check if already a feedback user
    const existing = await prisma.iAFeedbackUser.findUnique({
      where: { userId_firmId: { userId: targetUserId, firmId } },
    });

    if (existing) {
      if (!existing.isActive) {
        // Reactivate
        await prisma.iAFeedbackUser.update({
          where: { id: existing.id },
          data: { isActive: true },
        });
        return NextResponse.json({ success: true, reactivated: true });
      }
      return NextResponse.json({ error: 'User is already a feedback user' }, { status: 409 });
    }

    await prisma.iAFeedbackUser.create({
      data: { userId: targetUserId, firmId },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[FeedbackUsers:POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE: Remove an IA Feedback User
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isFirmAdmin = session.user.isFirmAdmin || session.user.isSuperAdmin;
    if (!isFirmAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { firmId: requestFirmId, userId } = await request.json();
    const firmId = requestFirmId || session.user.firmId;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // Soft delete — set isActive to false
    await prisma.iAFeedbackUser.updateMany({
      where: { userId, firmId },
      data: { isActive: false },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[FeedbackUsers:DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
