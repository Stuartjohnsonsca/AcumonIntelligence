import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

const TEMPLATE_TYPE = 'email_template_categories';
const AUDIT_TYPE = 'ALL';

// GET — return the firm's email template categories
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const firmId = session.user.firmId;
  try {
    const record = await prisma.methodologyTemplate.findUnique({
      where: { firmId_templateType_auditType: { firmId, templateType: TEMPLATE_TYPE, auditType: AUDIT_TYPE } },
    });
    if (record) {
      return NextResponse.json({ categories: record.items });
    }
    return NextResponse.json({ categories: null }); // null = use defaults
  } catch {
    return NextResponse.json({ categories: null });
  }
}

// PUT — save the firm's email template categories
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const firmId = session.user.firmId;
  const body = await req.json();
  const { categories } = body;

  if (!Array.isArray(categories)) {
    return NextResponse.json({ error: 'categories must be an array' }, { status: 400 });
  }

  try {
    await prisma.methodologyTemplate.upsert({
      where: { firmId_templateType_auditType: { firmId, templateType: TEMPLATE_TYPE, auditType: AUDIT_TYPE } },
      create: {
        firmId,
        templateType: TEMPLATE_TYPE,
        auditType: AUDIT_TYPE,
        items: categories as any,
      },
      update: {
        items: categories as any,
      },
    });
    return NextResponse.json({ categories });
  } catch (err) {
    console.error('Failed to save template categories:', err);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
