'use client';

/**
 * Tiny pub/sub for "templates changed → please re-fetch references".
 *
 * Powers the live red-outline refresh on schedule forms: the moment an
 * admin saves / deletes / toggles a document or email template, every
 * open schedule form re-fetches /api/methodology-admin/template-references
 * so the outlines reflect reality without forcing a page reload.
 *
 * Two transports, layered for robustness:
 *
 *   1. BroadcastChannel — when supported. Cross-tab, in-process
 *      delivery on the same origin. The clean primary path; fires
 *      synchronously after the publisher's writeback.
 *
 *   2. localStorage `storage` event — fallback for older Safari and
 *      private-browsing modes where BroadcastChannel is missing.
 *      Same-tab listeners DON'T receive `storage` events (the spec
 *      only fires it in OTHER tabs), but BroadcastChannel covers the
 *      same-tab case on every browser that has it. So in practice
 *      one of the two paths is always live.
 *
 *   3. window event — covers the rare case where neither of the
 *      above is available (SSR-rendered code, unusual sandboxes).
 *      Always dispatched alongside the others; cheap and harmless.
 *
 * No state is carried in the message — receivers refetch the API
 * unconditionally because a "save" can hit any number of templates
 * and the receiver doesn't know whether THIS firm's templates
 * changed without asking the API anyway.
 */

const CHANNEL_NAME = 'acumon:template-refs';
const STORAGE_KEY = 'acumon:template-refs:tick';
const WINDOW_EVENT = 'acumon:template-refs:invalidate';

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null;
  if (channel) return channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  try { channel = new BroadcastChannel(CHANNEL_NAME); } catch { channel = null; }
  return channel;
}

/**
 * Tell every listener (this tab + every other tab on this origin)
 * that template references may have changed and the cache should be
 * invalidated. Cheap to call — no awaiting, no error surface — so
 * publishers can fire-and-forget after their successful save.
 */
export function notifyTemplateRefsChanged(): void {
  if (typeof window === 'undefined') return;
  const tick = Date.now();
  // 1. Same-origin broadcast (covers other tabs AND same-tab listeners
  //    that subscribed via BroadcastChannel).
  try { getChannel()?.postMessage({ tick }); } catch { /* tolerate */ }
  // 2. localStorage hop (covers other tabs even without BroadcastChannel).
  //    A no-op in private-browsing modes that throw on setItem.
  try { window.localStorage.setItem(STORAGE_KEY, String(tick)); } catch { /* tolerate */ }
  // 3. Local window event (covers same-tab listeners on browsers
  //    without BroadcastChannel — the storage event isn't dispatched
  //    in the writing tab).
  try { window.dispatchEvent(new CustomEvent(WINDOW_EVENT, { detail: { tick } })); } catch { /* tolerate */ }
}

/**
 * Subscribe to template-refs invalidation events. The callback fires
 * after the publisher has written, with no payload — receivers should
 * re-fetch the API to get the fresh state.
 *
 * Returns a cleanup function — call it from a useEffect cleanup so
 * subscriptions don't pile up across remounts.
 */
export function subscribeTemplateRefsChanged(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const ch = getChannel();
  const onMessage = () => { callback(); };
  if (ch) ch.addEventListener('message', onMessage);

  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) callback();
  };
  window.addEventListener('storage', onStorage);

  const onWindowEvent = () => { callback(); };
  window.addEventListener(WINDOW_EVENT, onWindowEvent as EventListener);

  return () => {
    if (ch) ch.removeEventListener('message', onMessage);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(WINDOW_EVENT, onWindowEvent as EventListener);
  };
}
