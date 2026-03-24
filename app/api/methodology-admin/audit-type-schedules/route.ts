import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const firmId = session.user.firmId;

  const [scheduleTemplates, frameworkTemplates, fwOptionsTemplate] = await Promise.all([
    prisma.methodologyTemplate.findMany({
      where: { firmId, templateType: 'audit_type_schedules' },
    }),
    prisma.methodologyTemplate.findMany({
      where: { firmId, templateType: 'audit_type_framework' },
    }),
    prisma.methodologyTemplate.findFirst({
      where: { firmId, templateType: 'audit_type_schedules', auditType: '__framework_options' },
    }),
  ]);

  const mappings: Record<string, string[]> = {};
  for (const t of scheduleTemplates) {
    if (t.auditType !== '__framework_options') {
      mappings[t.auditType] = t.items as string[];
    }
  }

  const frameworks: Record<string, string> = {};
  for (const t of frameworkTemplates) {
    const data = t.items as unknown;
    frameworks[t.auditType] = typeof data === 'string' ? data : (data as { framework?: string })?.framework || '';
  }

  const frameworkOptions = fwOptionsTemplate ? fwOptionsTemplate.items as string[] : [];

  return NextResponse.json({ mappings, frameworks, frameworkOptions });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { auditType, schedules, framework } = body;
  if (!auditType || !Array.isArray(schedules)) {
    return NextResponse.json({ error: 'auditType and schedules array required' }, { status: 400 });
  }

  const firmId = session.user.firmId;

  // Save schedules
  await prisma.methodologyTemplate.upsert({
    where: {
      firmId_templateType_auditType: { firmId, templateType: 'audit_type_schedules', auditType },
    },
    create: { firmId, templateType: 'audit_type_schedules', auditType, items: schedules },
    update: { items: schedules },
  });

  // Save framework if provided (not for __framework_options)
  if (auditType !== '__framework_options' && framework !== undefined) {
    await prisma.methodologyTemplate.upsert({
      where: {
        firmId_templateType_auditType: { firmId, templateType: 'audit_type_framework', auditType },
      },
      create: { firmId, templateType: 'audit_type_framework', auditType, items: { framework } as any },
      update: { items: { framework } as any },
    });
  }

  return NextResponse.json({ success: true });
}
