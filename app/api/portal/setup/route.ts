import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';

/**
 * POST /api/portal/setup
 * One-time setup endpoint to create the first client portal user.
 * Protected by a setup key (not auth) so it can be called externally.
 * Remove or disable after initial setup.
 */
export async function POST(req: Request) {
  try {
    const { setupKey, clientName, email, name, password } = await req.json();

    // Simple setup key protection
    if (setupKey !== 'acumon-portal-setup-2026') {
      return NextResponse.json({ error: 'Invalid setup key' }, { status: 403 });
    }

    if (!clientName || !email || !name || !password) {
      return NextResponse.json({ error: 'clientName, email, name, and password are required' }, { status: 400 });
    }

    // Find the client by name
    const client = await prisma.client.findFirst({
      where: { clientName: { equals: clientName, mode: 'insensitive' } },
      select: { id: true, clientName: true },
    });

    if (!client) {
      // List available clients for debugging
      const allClients = await prisma.client.findMany({ select: { clientName: true } });
      return NextResponse.json({
        error: `Client "${clientName}" not found`,
        availableClients: allClients.map(c => c.clientName),
      }, { status: 404 });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.clientPortalUser.create({
      data: {
        clientId: client.id,
        email: email.toLowerCase(),
        name,
        passwordHash,
      },
    });

    return NextResponse.json({
      success: true,
      userId: user.id,
      clientName: client.clientName,
      email: user.email,
      message: `Portal user created. Login at /portal with email: ${email}`,
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Portal user with this email already exists for this client' }, { status: 409 });
    }
    console.error('Portal setup error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
