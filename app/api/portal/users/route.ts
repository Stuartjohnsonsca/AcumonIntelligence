import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyClientAccess } from '@/lib/client-access';
import bcrypt from 'bcryptjs';

/**
 * POST /api/portal/users
 * Create a client portal user. Only accessible by firm users with client access.
 *
 * Body: { clientId, email, name, password }
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const { clientId, email, name, password } = await req.json();

    if (!clientId || !email || !name || !password) {
      return NextResponse.json({ error: 'clientId, email, name, and password are required' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const access = await verifyClientAccess(
      session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
      clientId,
    );
    if (!access.allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.clientPortalUser.create({
      data: {
        clientId,
        email: email.toLowerCase(),
        name,
        passwordHash,
      },
    });

    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      message: 'Portal user created. They can now login at /portal',
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'A portal user with this email already exists for this client' }, { status: 409 });
    }
    console.error('Create portal user error:', error);
    return NextResponse.json({ error: 'Failed to create portal user' }, { status: 500 });
  }
}

/**
 * GET /api/portal/users?clientId=X
 * List portal users for a client.
 */
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

  const access = await verifyClientAccess(
    session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
    clientId,
  );
  if (!access.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const users = await prisma.clientPortalUser.findMany({
    where: { clientId },
    select: { id: true, email: true, name: true, isActive: true, lastLoginAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(users);
}
