import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// Store audit type → schedule mappings using MethodologyTemplate table
// templateType = 'audit_type_schedules', auditType = the audit type, items = schedule keys array

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const templates = await prisma.methodologyTemplate.findMany({
    where: { firmId: session.user.firmId, templateType: 'audit_type_schedules' },
  });

  const mappings: Record<string, string[]> = {};
  for (const t of templates) {
    mappings[t.auditType] = t.items as string[];
  }

  return NextResponse.json({ mappings });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { auditType, schedules } = await req.json();
  if (!auditType || !Array.isArray(schedules)) {
    return NextResponse.json({ error: 'auditType and schedules array required' }, { status: 400 });
  }

  const firmId = session.user.firmId;

  await prisma.methodologyTemplate.upsert({
    where: {
      firmId_templateType_auditType: { firmId, templateType: 'audit_type_schedules', auditType },
    },
    create: { firmId, templateType: 'audit_type_schedules', auditType, items: schedules },
    update: { items: schedules },
  });

  return NextResponse.json({ success: true });
}
