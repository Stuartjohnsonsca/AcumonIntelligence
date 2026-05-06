import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Firm-wide specialist roles — Methodology Admin sets who plays
 * each specialist role (Ethics Partner, MRLO, Management Board, ACP,
 * or any custom role). Each role has a display label + a name +
 * email, and is flagged active/inactive.
 *
 * Stored in `methodologyTemplate.items` under templateType
 * 'specialist_roles' with auditType 'ALL'. One row per firm.
 * Ethics Partner is also pulled from `Firm.ethicsPartnerId` when
 * present — this config can override it but doesn't have to.
 */

const TEMPLATE_TYPE = 'specialist_roles';
const AUDIT_TYPE = 'ALL';

// Default roles seeded the first time a firm visits Specialist
// Roles. `isAuditRole` controls whether the role appears on the
// Opening-tab specialist picker for an engagement. ACP and
// Management Board look across the whole firm, not per engagement,
// so they default to false; Ethics Partner and MRLO are commonly
// scoped per engagement so they default to true.
const DEFAULT_ROLES = [
  { key: 'ethics_partner',   label: 'Ethics Partner',   name: '', email: '', isActive: true, isAuditRole: true,  members: [] as Array<{ name: string; email: string }> },
  { key: 'mrlo',             label: 'MRLO',             name: '', email: '', isActive: true, isAuditRole: true,  members: [] },
  { key: 'management_board', label: 'Management Board', name: '', email: '', isActive: true, isAuditRole: false, members: [] },
  { key: 'acp',              label: 'ACP',              name: '', email: '', isActive: true, isAuditRole: false, members: [] },
];

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
    const items = Array.isArray(row?.items) ? (row!.items as any[]) : null;
    // If the firm hasn't customised yet, surface the four defaults so
    // the admin sees a fully-populated starter list (with blank names).
    let roles = items && items.length > 0 ? items : DEFAULT_ROLES;
    // Back-fill Ethics Partner from Firm.ethicsPartnerId when the
    // admin hasn't typed a name/email for that role yet.
    const ep = roles.find((r: any) => r.key === 'ethics_partner');
    if (ep && (!ep.name || !ep.email)) {
      try {
        const firm = await prisma.firm.findUnique({
          where: { id: session.user.firmId },
          include: { ethicsPartner: { select: { name: true, email: true } } },
        });
        if (firm?.ethicsPartner) {
          if (!ep.name) ep.name = firm.ethicsPartner.name || '';
          if (!ep.email) ep.email = firm.ethicsPartner.email || '';
        }
      } catch { /* tolerant */ }
    }
    return NextResponse.json({ roles });
  } catch {
    return NextResponse.json({ roles: DEFAULT_ROLES });
  }
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const roles = body?.roles;
  if (!Array.isArray(roles)) return NextResponse.json({ error: 'roles[] required' }, { status: 400 });

  const FIRM_GLOBAL = new Set(['acp', 'management_board']);
  const clean = roles
    .filter((r: any) => r && typeof r === 'object' && typeof r.key === 'string' && r.key.length > 0)
    .map((r: any) => ({
      key: String(r.key).slice(0, 64),
      label: String(r.label || r.key).slice(0, 120),
      name: String(r.name || '').slice(0, 200),
      email: String(r.email || '').slice(0, 200).trim(),
      isActive: r.isActive !== false,
      // isAuditRole: missing → default false for firm-global roles
      // (ACP, Management Board), true for everything else. Lets us
      // honour the original spec — these roles look at the firm
      // globally and shouldn't auto-appear on engagement pickers.
      isAuditRole: typeof r.isAuditRole === 'boolean' ? r.isAuditRole : !FIRM_GLOBAL.has(String(r.key)),
      members: Array.isArray(r.members)
        ? r.members
            .filter((m: any) => m && typeof m === 'object')
            .map((m: any) => ({
              name: String(m.name || '').slice(0, 200),
              email: String(m.email || '').slice(0, 200).trim(),
            }))
            .filter((m: any) => m.name || m.email)
        : [],
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
    return NextResponse.json({ roles: clean });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Save failed' }, { status: 500 });
  }
}
