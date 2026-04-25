import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getFirmAuditTypes, defaultAuditTypes, type FirmAuditType } from '@/lib/firm-audit-types';

/**
 * GET  /api/methodology-admin/audit-types
 *   Returns the firm's audit-type list, with sensible defaults when
 *   the row is missing. Available to any authenticated firm user
 *   (read-only) so client UIs can populate dropdowns.
 *
 * PUT  /api/methodology-admin/audit-types
 *   Body: { items: FirmAuditType[] }
 *   Replaces the firm's audit-type list. Methodology admins only.
 *   The five built-in codes (SME / PIE / SME_CONTROLS / PIE_CONTROLS
 *   / GROUP) cannot be deleted — only deactivated / relabelled — so
 *   existing engagements keep resolving their labels.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.firmId) return NextResponse.json({ error: 'No firm' }, { status: 400 });

  const items = await getFirmAuditTypes(session.user.firmId);
  return NextResponse.json({ items });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.firmId) return NextResponse.json({ error: 'No firm' }, { status: 400 });
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Methodology-admin access required.' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const incoming = Array.isArray(body?.items) ? body.items : [];

  // Built-in codes are IMMUTABLE — engagements / formulas / templates
  // already reference them throughout the system, so renaming would
  // silently corrupt data the admin didn't realise depended on the
  // original code. Labels and isActive are still editable.
  const BUILT_IN_CODES = new Set(defaultAuditTypes().map(d => d.code));

  const cleaned: FirmAuditType[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < incoming.length; i++) {
    const x = incoming[i];
    if (!x || typeof x !== 'object') continue;
    const rawCode = String(x.code || '').trim();
    // Normalise custom codes to UPPER_SNAKE so they're safe to use
    // as firm-variable suffixes (e.g. min_avg_fee_per_hour_grant_audit).
    // Built-in codes pass through untouched.
    const code = BUILT_IN_CODES.has(rawCode)
      ? rawCode
      : rawCode.toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/^_+|_+$/g, '').replace(/_{2,}/g, '_');
    if (!code) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    cleaned.push({
      code,
      label: typeof x.label === 'string' && x.label.trim() ? x.label.trim() : code,
      isActive: x.isActive !== false,
      sortOrder: Number.isFinite(Number(x.sortOrder)) ? Number(x.sortOrder) : i,
      isBuiltIn: BUILT_IN_CODES.has(code),
    });
  }

  // Built-ins must always be present (deactivated is fine, deleted
  // is not — historical engagements can still carry the code).
  for (const def of defaultAuditTypes()) {
    if (!seen.has(def.code)) {
      cleaned.push({ ...def, isActive: false });
      seen.add(def.code);
    }
  }

  try {
    await prisma.methodologyRiskTable.upsert({
      where: { firmId_tableType: { firmId: session.user.firmId, tableType: 'audit_types' } },
      update: { data: { items: cleaned } as any },
      create: {
        firmId: session.user.firmId,
        tableType: 'audit_types',
        data: { items: cleaned } as any,
      },
    });
    return NextResponse.json({ ok: true, items: cleaned });
  } catch (err: any) {
    console.error('[audit-types] save failed:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Save failed' }, { status: 500 });
  }
}
