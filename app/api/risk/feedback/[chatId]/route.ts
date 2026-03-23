import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// GET: Retrieve all detailed feedback for a specific risk chat (feedback users only)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ chatId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only feedback users can view feedback
    const feedbackUser = await prisma.iAFeedbackUser.findUnique({
      where: {
        userId_firmId: {
          userId: session.user.id,
          firmId: session.user.firmId,
        },
      },
    });

    if (!feedbackUser?.isActive) {
      return NextResponse.json({ error: 'Not authorised' }, { status: 403 });
    }

    const { chatId } = await params;

    const feedback = await prisma.riskFeedback.findMany({
      where: { chatId },
      include: {
        user: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ feedback });
  } catch (err) {
    console.error('[Risk:Feedback:chatId:GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
