import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

const AUDIT_TYPE = 'ALL';

/** The `methodologyTemplate.templateType` row that stores each kind's
 *  category list. Emails and documents keep separate rows so admins
 *  can curate each list independently. Default to 'email' on
 *  unrecognised input so older callers (without the ?kind= query)
 *  keep working. */
function templateTypeFor(kind: string | null | undefined): string {
  return kind === 'document' ? 'document_template_categories' : 'email_template_categories';
}

// GET — return the firm's template categories for the given kind
//   ?kind=email     → email template categories (default)
//   ?kind=document  → document template categories
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const firmId = session.user.firmId;
  const templateType = templateTypeFor(req.nextUrl.searchParams.get('kind'));
  try {
    const record = await prisma.methodologyTemplate.findUnique({
      where: { firmId_templateType_auditType: { firmId, templateType, auditType: AUDIT_TYPE } },
    });
    if (record) {
      return NextResponse.json({ categories: record.items });
    }
    return NextResponse.json({ categories: null }); // null = use defaults
  } catch {
    return NextResponse.json({ categories: null });
  }
}

// PUT — save the firm's template categories for the given kind
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const firmId = session.user.firmId;
  const templateType = templateTypeFor(req.nextUrl.searchParams.get('kind'));
  const body = await req.json();
  const { categories } = body;

  if (!Array.isArray(categories)) {
    return NextResponse.json({ error: 'categories must be an array' }, { status: 400 });
  }

  try {
    await prisma.methodologyTemplate.upsert({
      where: { firmId_templateType_auditType: { firmId, templateType, auditType: AUDIT_TYPE } },
      create: {
        firmId,
        templateType,
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
