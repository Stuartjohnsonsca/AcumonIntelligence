import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';

// Promote a user to Super Admin by email
// Protected by CRON_SECRET — call via:
//   POST /api/admin/promote?secret=YOUR_CRON_SECRET
//   Body: { "email": "stuart@acumon.com" }
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');

  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { email } = await request.json();
    if (!email) {
      return Response.json({ error: 'Email is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return Response.json({ error: `No user found with email: ${email}` }, { status: 404 });
    }

    if (user.isSuperAdmin) {
      return Response.json({ message: `${user.name} is already a Super Admin` });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        isSuperAdmin: true,
        isFirmAdmin: true,
        isMethodologyAdmin: true,
      },
    });

    return Response.json({
      message: `${user.name} (${email}) has been promoted to Super Admin`,
      userId: user.id,
    });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
