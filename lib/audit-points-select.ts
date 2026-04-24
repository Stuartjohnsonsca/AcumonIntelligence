/**
 * Safe field projection for `prisma.auditPoint.findMany()`.
 *
 * Same story as ERROR_SCHEDULE_SAFE_SELECT: production Supabase is
 * currently missing the `linked_from_type` + `linked_from_id` columns
 * that were added to the Prisma schema for the 'Raise as …' cross-link
 * flows. A plain findMany() with no `select` expands to every
 * declared column and therefore 500s with
 *   'column audit_points.linked_from_type does not exist'
 * which takes down the RI Matters / Review Points / Management /
 * Representation panels.
 *
 * Using this explicit select keeps those panels working until the
 * admin runs scripts/sql/raise-as-linked-from.sql in Supabase.
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
