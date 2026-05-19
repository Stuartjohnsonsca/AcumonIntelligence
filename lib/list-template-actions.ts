/**
 * Shared types + helpers for the per-item action feature on
 * Methodology Admin → Schedules → List Templates (currently Info
 * Request Standard / Preliminary, Agreed Dates, Permanent File).
 *
 * Storage shape evolved over time:
 *   1. `string[]`                                          — original plain list
 *   2. `[{description, action?}]`                          — per-item action support
 *   3. `{items: [{description, action?}], defaultAction?}` — adds a list-level
 *                                                            "trigger" action that
 *                                                            empty per-item cells
 *                                                            inherit at runtime
 *
 * Readers must accept all three shapes; writers should always emit
 * shape (3). The two `normalise*` helpers below are the canonical way
 * to read a stored value into the modern shape.
 */

export type ListAction = 'request_portal' | 'message_client' | 'third_party';

export interface ListItem {
  description: string;
  /** When set, overrides the list-level default for this item. */
  action?: ListAction | null;
}

export interface ListStorage {
  items: ListItem[];
  /** Trigger for the whole list — picked up by any per-item cell that
   *  doesn't specify its own action. Null/undefined → no default. */
  defaultAction?: ListAction | null;
}

export const LIST_ACTION_KINDS: ListAction[] = ['request_portal', 'message_client', 'third_party'];

export const LIST_ACTION_LABELS: Record<ListAction, string> = {
  request_portal: 'Request via Portal',
  message_client: 'Message Client',
  third_party:    'Issue to Third Party',
};

export const LIST_ACTION_HINTS: Record<ListAction, string> = {
  request_portal: 'Posts an Outstanding Portal Request containing the item description for the client to respond to.',
  message_client: 'Posts an Outstanding Portal Request whose body is interpreted from the item description (e.g. "Notification of Team" sends the audit team list).',
  third_party:    'Opens a dialog so the auditor can pick a third-party email address; the item is then emailed to that address.',
};

/** Coerce any of the three storage shapes into the modern ListStorage. */
export function normaliseListStorage(stored: unknown): ListStorage {
  if (stored && typeof stored === 'object' && !Array.isArray(stored) && Array.isArray((stored as any).items)) {
    const obj = stored as { items: unknown[]; defaultAction?: unknown };
    return {
      items: obj.items.map(coerceItem).filter(it => it.description.length > 0),
      defaultAction: isAction(obj.defaultAction) ? obj.defaultAction : null,
    };
  }
  if (Array.isArray(stored)) {
    return {
      items: stored.map(coerceItem).filter(it => it.description.length > 0),
      defaultAction: null,
    };
  }
  return { items: [], defaultAction: null };
}

/** Same as normaliseListStorage but seeds with `fallbackDescriptions`
 *  when the stored value is empty / missing. Used by the Schedule
 *  Designer so a never-saved list still shows its starter content. */
export function normaliseListStorageWithFallback(
  stored: unknown,
  fallbackDescriptions: string[],
): ListStorage {
  const out = normaliseListStorage(stored);
  if (out.items.length > 0) return out;
  return {
    items: fallbackDescriptions.map(d => ({ description: d })),
    defaultAction: null,
  };
}

function coerceItem(raw: unknown): ListItem {
  if (typeof raw === 'string') return { description: raw };
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const desc = typeof r.description === 'string' ? r.description : '';
    const action = isAction(r.action) ? r.action : null;
    return { description: desc, action };
  }
  return { description: '' };
}

function isAction(v: unknown): v is ListAction {
  return v === 'request_portal' || v === 'message_client' || v === 'third_party';
}

/** Resolve the effective action for an item at runtime — per-item
 *  override wins; otherwise inherit the list-level default. */
export function effectiveListAction(item: ListItem, storage: ListStorage): ListAction | null {
  if (item.action) return item.action;
  return storage.defaultAction ?? null;
}
