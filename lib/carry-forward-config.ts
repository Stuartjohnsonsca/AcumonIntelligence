/**
 * Bring-forward configuration helpers.
 *
 * Reads the firm's carry-forward matrix (configured in Firm Wide
 * Assumptions, stored in `methodology_risk_tables` under
 * tableType='carryForward'). Each schedule that supports carrying
 * data into the prior columns of a new engagement consults this
 * matrix at engagement-creation time to decide whether to do so.
 *
 * The matrix shape is:
 *
 *   { [auditTypeCode]: { [itemKey]: true } }
 *
 * Missing keys are treated as `false` (do not bring forward) so an
 * unconfigured firm doesn't silently inherit data the auditor may not
 * want. Keep the itemKey list in sync with `CARRY_FORWARD_ITEMS` in
 * `components/methodology-admin/FirmAssumptionsClient.tsx`.
 */

import { prisma } from '@/lib/db';

export type CarryForwardMatrix = Record<string, Record<string, boolean>>;

/** All known carry-forward item keys. Mirrors CARRY_FORWARD_ITEMS in
 *  FirmAssumptionsClient.tsx — kept here as a const so server code
 *  doesn't import a client component. */
export type CarryForwardItem =
  | 'permanent_file'
  | 'rmm_rows'
  | 'audit_plan'
  | 'materiality'
  | 'agreed_dates'
  | 'ethics'
  | 'continuance'
  | 'team_members'
  | 'tb_figures';

/**
 * Load the firm's full carry-forward matrix. Returns an empty object
 * when the firm hasn't configured anything yet — every check against
 * the empty matrix returns false (i.e. opt-in default).
 *
 * Tolerant of the row not existing or the JSON being malformed: any
 * read failure resolves to `{}` so callers don't crash a downstream
 * engagement-creation flow when the assumption record is missing.
 */
export async function getFirmCarryForward(firmId: string): Promise<CarryForwardMatrix> {
  try {
    const row = await prisma.methodologyRiskTable.findUnique({
      where: { firmId_tableType: { firmId, tableType: 'carryForward' } },
    });
    if (!row?.data || typeof row.data !== 'object') return {};
    const data = row.data as { matrix?: unknown };
    if (!data.matrix || typeof data.matrix !== 'object') return {};
    return data.matrix as CarryForwardMatrix;
  } catch {
    return {};
  }
}

/**
 * Convenience boolean lookup — true iff the firm has ticked the
 * (auditType, itemKey) cell. Use from schedule loaders that need to
 * decide whether to populate prior-period columns.
 *
 * Example:
 *   if (await shouldCarryForward(firmId, 'PIE', 'materiality')) {
 *     // copy prior period materiality figures into the new engagement
 *   }
 */
export async function shouldCarryForward(
  firmId: string,
  auditType: string,
  itemKey: CarryForwardItem | string,
): Promise<boolean> {
  const matrix = await getFirmCarryForward(firmId);
  return matrix[auditType]?.[itemKey] === true;
}
