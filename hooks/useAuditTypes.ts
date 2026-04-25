'use client';

/**
 * useAuditTypes — fetch the firm's configurable audit-type list.
 *
 * Mirrors useFirmVariables: module-level memo so multiple callers
 * on the same page share one fetch. Falls back to the default seed
 * (the original 5 built-in types) if the endpoint fails or returns
 * nothing.
 */

import { useEffect, useState } from 'react';
import { defaultAuditTypes, type FirmAuditType } from '@/lib/firm-audit-types';

let memoCache: FirmAuditType[] | null = null;
let inflight: Promise<FirmAuditType[]> | null = null;

async function fetchOnce(): Promise<FirmAuditType[]> {
  if (memoCache) return memoCache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch('/api/methodology-admin/audit-types');
      if (!res.ok) return defaultAuditTypes();
      const json = await res.json();
      const items: FirmAuditType[] = Array.isArray(json?.items) ? json.items : [];
      const result = items.length > 0 ? items : defaultAuditTypes();
      memoCache = result;
      return result;
    } catch {
      return defaultAuditTypes();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function invalidateAuditTypes() {
  memoCache = null;
}

export function useAuditTypes(): FirmAuditType[] {
  const [items, setItems] = useState<FirmAuditType[]>(() => memoCache || defaultAuditTypes());
  useEffect(() => {
    let cancelled = false;
    fetchOnce().then(loaded => { if (!cancelled) setItems(loaded); });
    return () => { cancelled = true; };
  }, []);
  return items;
}
