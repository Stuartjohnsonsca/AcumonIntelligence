/**
 * Tiny in-memory nav registry for the engagement page.
 *
 * The engagement page has top-level tabs (managed by EngagementTabs)
 * and per-tab sub-tabs (e.g. Walkthroughs has Sales/Purchase/etc,
 * Communication has Overall/Board Minutes/etc) that live in component-
 * local state with no global URL representation. URL-based routing
 * therefore can't restore "where the user was" beyond the top-level
 * tab.
 *
 * This module is a tiny pub/sub used by:
 *   - tabs/sub-tabs reporting their CURRENT location (so something
 *     opened over the top — like the RI Matters modal — can capture
 *     "where was I when I opened this?")
 *   - features that need to NAVIGATE somewhere — they call navigateTo
 *     with a target. The relevant tab/sub-tab subscribers pick it up.
 *
 * Pending-target replay: a sub-tab component that isn't mounted yet
 * (because the user is on a different top-level tab) can't receive a
 * live event. So navigateTo also stashes the target as `pending`.
 * When the sub-tab component mounts, it calls consumePending() with
 * a matcher to claim it. This makes "switch tab + switch sub-tab in
 * one click" work correctly.
 */

export interface NavLocation {
  tab: string;            // top-level tab key (e.g. 'walkthroughs')
  subTab?: string;        // optional sub-tab key (e.g. 'sales')
  // Human-readable breadcrumb for showing on back-links etc. Not used
  // for matching during navigateTo — just for display.
  label?: string;
}

let currentLocation: NavLocation | null = null;
let pendingNav: NavLocation | null = null;
const subscribers = new Set<(loc: NavLocation) => void>();

export function setCurrentLocation(loc: NavLocation): void {
  currentLocation = loc;
}

export function getCurrentLocation(): NavLocation | null {
  return currentLocation;
}

export function navigateTo(loc: NavLocation): void {
  pendingNav = loc;
  // Snapshot subscribers — a subscriber may unsubscribe inside its
  // own callback (e.g. component unmounts as a result of navigating).
  for (const fn of Array.from(subscribers)) {
    try { fn(loc); } catch { /* swallow — one bad subscriber shouldn't break the rest */ }
  }
}

export function subscribeNav(fn: (loc: NavLocation) => void): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

/**
 * Claim the pending nav target if the matcher accepts it. Used by
 * components on mount: if the pending target matches their scope, they
 * apply it and clear it so the next mount doesn't re-trigger.
 */
export function consumePendingNav(matcher: (loc: NavLocation) => boolean): NavLocation | null {
  if (pendingNav && matcher(pendingNav)) {
    const claimed = pendingNav;
    pendingNav = null;
    return claimed;
  }
  return null;
}

/**
 * Encode a NavLocation (plus the URL it came from) into the existing
 * `reference` text column on AuditPoint. Backwards-compatible: any
 * previously-saved plain URL still works on the read side (decode
 * returns null and the caller falls back to treating it as a URL).
 */
export function encodeNavReference(loc: NavLocation, url?: string): string {
  return JSON.stringify({ v: 1, ...loc, url: url ?? null });
}

export interface DecodedNavReference {
  loc: NavLocation;
  url: string | null;
}

export function decodeNavReference(ref: string | null | undefined): DecodedNavReference | null {
  if (!ref) return null;
  // Plain URL references (pre-back-link change) start with http(s):// —
  // skip the JSON.parse attempt for those to avoid noisy try/catch.
  if (ref.startsWith('http://') || ref.startsWith('https://')) return null;
  try {
    const obj = JSON.parse(ref);
    if (obj && typeof obj === 'object' && obj.v === 1 && typeof obj.tab === 'string') {
      return {
        loc: { tab: obj.tab, subTab: obj.subTab, label: obj.label },
        url: typeof obj.url === 'string' ? obj.url : null,
      };
    }
  } catch { /* not JSON — fall through */ }
  return null;
}
