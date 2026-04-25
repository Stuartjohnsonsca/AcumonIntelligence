/**
 * Firm-configurable audit types.
 *
 * Historically the system carried a hard-coded `AuditType` enum
 * (SME / PIE / SME_CONTROLS / PIE_CONTROLS / GROUP) and a matching
 * AUDIT_TYPE_LABELS map. Firms started asking to add their own types
 * (Grant Audit, CASS Audit, …) and to retire ones they don't run, so
 * the list is now stored on a per-firm `audit_types` row of
 * MethodologyRiskTable. The hard-coded list lives on as a fallback
 * default + a constant import for code that still needs to typecheck
 * against the original 5 — but the canonical list flows from this
 * helper.
 *
 * Shape on the row:
 *   { items: [{ code, label, isActive, sortOrder, isDefault? }] }
 */

import { prisma } from '@/lib/db';
import { AUDIT_TYPE_LABELS, type AuditType } from '@/types/methodology';

export interface FirmAuditType {
  code: string;
  label: string;
  isActive: boolean;
  sortOrder: number;
  /** Indicates this row matches one of the original built-in types
   *  (SME / PIE / SME_CONTROLS / PIE_CONTROLS / GROUP). Built-in
   *  types are kept around so existing engagements don't break, but
   *  the admin can rename / hide them via the Audit Types editor. */
  isBuiltIn?: boolean;
}

/** Default seed used the first time a firm opens the audit-types
 *  editor or whenever the row is missing entirely. */
export function defaultAuditTypes(): FirmAuditType[] {
  const order: AuditType[] = ['SME', 'PIE', 'SME_CONTROLS', 'PIE_CONTROLS', 'GROUP'];
  return order.map((code, i) => ({
    code,
    label: AUDIT_TYPE_LABELS[code],
    isActive: true,
    sortOrder: i,
    isBuiltIn: true,
  }));
}

/** Load the firm's audit types from the risk-table row, falling back
 *  to the default seed when the row is missing or malformed. ALWAYS
 *  returns at least the 5 built-in types so engagements with legacy
 *  auditType values can resolve a label even if the admin has hidden
 *  every built-in. */
export async function getFirmAuditTypes(firmId: string): Promise<FirmAuditType[]> {
  let stored: FirmAuditType[] = [];
  try {
    const row = await prisma.methodologyRiskTable.findUnique({
      where: { firmId_tableType: { firmId, tableType: 'audit_types' } },
      select: { data: true },
    }).catch(() => null);
    const items = (row?.data as any)?.items;
    if (Array.isArray(items)) {
      stored = items
        .filter((x: any) => x && typeof x.code === 'string' && x.code.trim())
        .map((x: any, i: number) => ({
          code: String(x.code).trim(),
          label: typeof x.label === 'string' && x.label.trim() ? x.label.trim() : String(x.code).trim(),
          isActive: x.isActive !== false,
          sortOrder: Number.isFinite(Number(x.sortOrder)) ? Number(x.sortOrder) : i,
          isBuiltIn: x.isBuiltIn === true,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    }
  } catch (err) {
    console.error('[firm-audit-types] load failed:', (err as any)?.message || err);
  }

  if (stored.length === 0) return defaultAuditTypes();

  // Bridge: if the admin's stored list doesn't include one of the
  // built-in codes that an existing engagement might still reference,
  // append it (inactive) so callers can still resolve the label.
  const stored$codes = new Set(stored.map(x => x.code));
  for (const builtIn of defaultAuditTypes()) {
    if (!stored$codes.has(builtIn.code)) {
      stored.push({ ...builtIn, isActive: false });
    }
  }
  return stored;
}

/** Sync alias for code paths that already have a list in scope (e.g.
 *  loaded as a prop) and just need the label-by-code lookup. */
export function buildAuditTypeLabelMap(types: FirmAuditType[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of types) out[t.code] = t.label;
  // Always include built-ins as a fallback so unknown codes from
  // legacy data still get a sensible label.
  for (const [code, label] of Object.entries(AUDIT_TYPE_LABELS)) {
    if (!(code in out)) out[code] = label;
  }
  return out;
}
