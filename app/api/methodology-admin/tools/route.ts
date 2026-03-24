import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { settings } = await req.json();
  const firmId = session.user.firmId;

  // settings is Record<"toolName|methodName|auditType", availability>
  const ops = Object.entries(settings as Record<string, string>).map(([key, availability]) => {
    const [toolName, methodName, auditType] = key.split('|');
    return prisma.methodologyToolSetting.upsert({
      where: {
        firmId_toolName_methodName_auditType: { firmId, toolName, methodName, auditType },
      },
      create: { firmId, toolName, methodName, availability, auditType },
      update: { availability },
    });
  });

  await Promise.all(ops);

  return NextResponse.json({ success: true });
}
