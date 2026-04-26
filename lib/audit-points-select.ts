/**
 * Safe field projections for `prisma.auditPoint.*`.
 *
 * Production Supabase may be missing columns added in
 *   prisma/migrations/manual/2026-04-22-audit-points-colour-links.sql
 * (`colour`, `linked_from_type`, `linked_from_id`). A plain findMany /
 * create without an explicit `select` expands to every Prisma-declared
 * column, and Postgres 500s on the missing ones — taking down the RI
 * Matters / Review Points / Management / Representation panels.
 *
 * Two projections so callers can fall back gracefully:
 *  - FULL  : everything, used first.
 *  - MINIMAL : only columns guaranteed to exist in older schemas. Used
 *    as a retry when FULL hits a "column does not exist" error.
 *
 * Once the admin runs the migration in Supabase the fallback path is
 * never taken and the field shape is identical to FULL.
 */
export const AUDIT_POINT_SAFE_SELECT = {
  id: true,
  engagementId: true,
  pointType: true,
  chatNumber: true,
  status: true,
  colour: true,
  description: true,
  heading: true,
  body: true,
  reference: true,
  createdById: true,
  createdByName: true,
  createdAt: true,
  updatedAt: true,
  closedById: true,
  closedByName: true,
  closedAt: true,
  responses: true,
  attachments: true,
} as const;

// Subset that excludes anything from the 2026-04-22 migration. Used as
// a retry projection when production hasn't applied that migration yet.
export const AUDIT_POINT_MINIMAL_SELECT = {
  id: true,
  engagementId: true,
  pointType: true,
  chatNumber: true,
  status: true,
  description: true,
  heading: true,
  body: true,
  reference: true,
  createdById: true,
  createdByName: true,
  createdAt: true,
  updatedAt: true,
  closedById: true,
  closedByName: true,
  closedAt: true,
  responses: true,
  attachments: true,
} as const;

// True if a Prisma error message names a column from the
// 2026-04-22-audit-points-colour-links.sql migration. Use to decide
// whether a write/read should be retried with the minimal projection.
export function isMissingMigrationColumn(err: unknown): boolean {
  const msg = (err as any)?.message;
  if (typeof msg !== 'string') return false;
  return /\b(colour|linked_from_type|linked_from_id)\b/i.test(msg)
    && /does not exist|unknown column|undefined column/i.test(msg);
}
