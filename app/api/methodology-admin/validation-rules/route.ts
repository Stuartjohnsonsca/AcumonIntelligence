import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import type { ValidationRule } from '@/lib/validation-rules';

/**
 * Firm-wide validation-rule storage.
 *
 *   GET  — return the firm's rule list (empty array when nothing
 *          has been configured yet)
 *   PUT  — replace the full rule list (Methodology Admin only)
 *
 * Stored in `methodologyTemplate` under templateType
 * 'validation_rules', auditType 'ALL'. One row per firm.
 */

const TEMPLATE_TYPE = 'validation_rules';
const AUDIT_TYPE = 'ALL';

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const row = await prisma.methodologyTemplate.findUnique({
      where: {
        firmId_templateType_auditType: {
          firmId: session.user.firmId,
          templateType: TEMPLATE_TYPE,
          auditType: AUDIT_TYPE,
        },
      },
    });
    const rules = Array.isArray(row?.items) ? (row!.items as unknown as ValidationRule[]) : [];
    return NextResponse.json({ rules });
  } catch {
    return NextResponse.json({ rules: [] });
  }
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const rules = body?.rules;
  if (!Array.isArray(rules)) return NextResponse.json({ error: 'rules[] required' }, { status: 400 });

  // Defensive-copy — only persist the fields we expect. Stops admins
  // from accidentally storing rubbish if the client sends extra keys.
  const clean: ValidationRule[] = rules
    .filter((r: any) => r && typeof r === 'object' && typeof r.id === 'string')
    .map((r: any) => ({
      id: String(r.id),
      label: String(r.label || '').slice(0, 200),
      scheduleKey: String(r.scheduleKey || ''),
      expression: String(r.expression || ''),
      severity: r.severity === 'error' ? 'error' : 'warning',
      message: String(r.message || '').slice(0, 2000),
      isActive: !!r.isActive,
    }));

  try {
    await prisma.methodologyTemplate.upsert({
      where: {
        firmId_templateType_auditType: {
          firmId: session.user.firmId,
          templateType: TEMPLATE_TYPE,
          auditType: AUDIT_TYPE,
        },
      },
      create: {
        firmId: session.user.firmId,
        templateType: TEMPLATE_TYPE,
        auditType: AUDIT_TYPE,
        items: clean as any,
      },
      update: { items: clean as any },
    });
    return NextResponse.json({ rules: clean });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Save failed' }, { status: 500 });
  }
}
