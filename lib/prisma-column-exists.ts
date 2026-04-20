import { prisma } from './db';

// Per-process cache of column-existence checks. Used to soften the
// transition period between deploying a Prisma schema change and
// running the matching SQL migration on Supabase — endpoints can
// conditionally include the new column in their queries instead of
// 500ing with P2022 ("column does not exist") when a stale DB is hit.
//
// Positive results are cached permanently — columns don't get removed
// during normal operation. Negative results are cached for 60s so a
// Vercel instance that probed before the admin ran the SQL migration
// picks up the new column shortly after without needing a cold start.

interface Entry { exists: boolean; at: number; }
const cache = new Map<string, Entry>();
const NEGATIVE_TTL_MS = 60_000;

export async function columnExists(table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  const cached = cache.get(key);
  if (cached) {
    if (cached.exists) return true;
    if (Date.now() - cached.at < NEGATIVE_TTL_MS) return false;
  }
  try {
    const res = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = ${table} AND column_name = ${column}
      ) AS exists
    `;
    const exists = Boolean(res[0]?.exists);
    cache.set(key, { exists, at: Date.now() });
    return exists;
  } catch {
    // On error (e.g. permission issues querying information_schema),
    // assume the column is missing so writes fall back to the
    // safe-without-new-field path. Cached briefly so we retry soon.
    cache.set(key, { exists: false, at: Date.now() });
    return false;
  }
}

/** For tests / manual reset. Rarely needed in production. */
export function invalidatePrismaColumnCache() { cache.clear(); }
