/**
 * Optimistic locking for concurrent editing.
 *
 * When saving, includes the `updatedAt` timestamp from the last known state.
 * The server compares this with its current `updatedAt`:
 * - Match → save proceeds
 * - Mismatch → 409 Conflict returned, client must refresh
 *
 * Usage in API routes:
 *   const { updatedAt } = req.body;
 *   const current = await prisma.model.findUnique({ where: { id } });
 *   if (current.updatedAt.toISOString() !== updatedAt) {
 *     return NextResponse.json({ error: 'Conflict', serverVersion: current.updatedAt }, { status: 409 });
 *   }
 */

/**
 * Add optimistic lock headers to a fetch request.
 */
export function withOptimisticLock(
  body: Record<string, any>,
  updatedAt: string | Date | null,
): Record<string, any> {
  return {
    ...body,
    _updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt,
  };
}

/**
 * Check optimistic lock in an API handler.
 * Returns null if lock is valid, or error response data if conflict.
 */
export function checkOptimisticLock(
  clientUpdatedAt: string | undefined,
  serverUpdatedAt: Date | string,
): { conflict: boolean; serverVersion?: string } {
  if (!clientUpdatedAt) {
    // No lock provided — allow (backward compat)
    return { conflict: false };
  }

  const serverStr = serverUpdatedAt instanceof Date
    ? serverUpdatedAt.toISOString()
    : serverUpdatedAt;

  if (clientUpdatedAt !== serverStr) {
    return { conflict: true, serverVersion: serverStr };
  }

  return { conflict: false };
}

/**
 * Conflict resolution strategies.
 */
export type ConflictStrategy = 'client-wins' | 'server-wins' | 'merge' | 'ask-user';

export interface ConflictInfo {
  serverVersion: string;
  localVersion: string;
  strategy: ConflictStrategy;
}
