/**
 * Safe field projection for `prisma.auditErrorSchedule.findMany()`.
 *
 * Production Supabase is currently missing the `linked_from_type` +
 * `linked_from_id` columns (added to the Prisma schema for the
 * "Raise as …" cross-link flows but never pushed to the DB). Any
 * findMany() without a `select:` clause therefore 500s because Prisma
 * tries to fetch every declared column. Using this explicit select
 * list keeps the feature working until the admin runs
 * scripts/sql/raise-as-linked-from.sql in Supabase.
 *
 * Once the SQL migration is applied, removing this select clause (or
 * leaving it in — it's harmless, just explicit) restores parity with
 * the schema.
 */
export const ERROR_SCHEDULE_SAFE_SELECT = {
  id: true,
  engagementId: true,
  conclusionId: true,
  fsLine: true,
  accountCode: true,
  description: true,
  errorAmount: true,
  errorType: true,
  explanation: true,
  isFraud: true,
  committedBy: true,
  committedByName: true,
  committedAt: true,
  createdAt: true,
  sampleItemMarkerId: true,
  resolution: true,
  resolvedBy: true,
  resolvedByName: true,
  resolvedAt: true,
} as const;
