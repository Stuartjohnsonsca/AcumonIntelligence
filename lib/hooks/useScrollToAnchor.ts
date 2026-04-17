'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Scroll the current tab to an anchor supplied via the `?scroll=…` URL
 * parameter (written by EngagementTabs' onNavigateMainTab path when an
 * AI Populate reference is clicked on the Completion panel, or by any
 * other cross-tab link that wants deep-scroll behaviour).
 *
 * Usage inside a tab component:
 *   useScrollToAnchor(deps, { enabled: !loading });
 *
 * Matching rules, tried in order:
 *   1. [data-scroll-anchor="{value}"]
 *   2. #{value} (DOM id)
 *   3. [data-scroll-anchor^="{value}:"] (prefix match so a value like
 *      "rmm-5" can target a node tagged "rmm-5:any-suffix")
 *
 * After scrolling, the element gets a short yellow-ring highlight so
 * the auditor's eye lands on the right row. The URL's `scroll` param is
 * cleared via history.replaceState so re-renders don't re-scroll.
 *
 * The hook is intentionally tolerant — if nothing matches we leave the
 * user on the tab and clear the param silently. This keeps things
 * robust when the AI picks an anchor value that a tab doesn't yet
 * support.
 */
export function useScrollToAnchor(
  // Additional deps that should cause the hook to re-check the DOM
  // (e.g. a tab's `loading` flag flipping to false, or data arriving
  // asynchronously). The hook always re-runs when the search params
  // change; pass anything else here that influences when the anchor
  // target becomes rendered.
  deps: React.DependencyList = [],
  options: { enabled?: boolean; delayMs?: number } = {},
): void {
  const params = useSearchParams();
  const anchor = params?.get('scroll') || '';
  // Guard against double-firing when React re-renders the hook during
  // the same mount (Strict Mode, HMR, etc).
  const firedForAnchor = useRef<string>('');

  useEffect(() => {
    if (!anchor) return;
    if (options.enabled === false) return;
    if (firedForAnchor.current === anchor) return;

    // Give the DOM a frame to settle after the tab switch before we
    // look for the target node. Some tabs render their rows after an
    // async data fetch — callers should add their `loading` flag to
    // `deps` so the hook re-runs when the rows arrive.
    const timeout = setTimeout(() => {
      const target = findAnchor(anchor);
      if (!target) return;
      firedForAnchor.current = anchor;
      try {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {
        // Fallback for environments without smooth scroll support.
        (target as HTMLElement).scrollIntoView();
      }
      highlightBriefly(target);
      // Clear the `scroll` param so a subsequent re-render doesn't
      // repeat the scroll (users navigating around the same tab
      // shouldn't be dragged back to the anchor).
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('scroll');
        window.history.replaceState({}, '', url.pathname + url.search);
      } catch { /* ignore */ }
    }, Math.max(0, options.delayMs ?? 80));
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, options.enabled, ...deps]);
}

function findAnchor(value: string): Element | null {
  if (typeof document === 'undefined') return null;
  // 1. Exact data-scroll-anchor match.
  const direct = document.querySelector<HTMLElement>(`[data-scroll-anchor="${cssEscape(value)}"]`);
  if (direct) return direct;
  // 2. DOM id match.
  const byId = document.getElementById(value);
  if (byId) return byId;
  // 3. Prefix match — useful when the AI produces something like
  //    "rmm-5" and a row is tagged "rmm-5:description". We pick the
  //    first node whose data-scroll-anchor starts with the value
  //    followed by ":" or "-".
  const all = document.querySelectorAll<HTMLElement>('[data-scroll-anchor]');
  for (const el of all) {
    const raw = el.getAttribute('data-scroll-anchor') || '';
    if (raw === value || raw.startsWith(`${value}:`) || raw.startsWith(`${value}-`)) return el;
  }
  return null;
}

function highlightBriefly(el: Element): void {
  const target = el as HTMLElement;
  const prev = target.style.cssText;
  // Use inline styles rather than className toggling to avoid fighting
  // with whatever utility classes the target row already has.
  target.style.transition = 'box-shadow 0.6s ease-in-out, background-color 0.6s ease-in-out';
  target.style.boxShadow = '0 0 0 3px rgba(251, 191, 36, 0.65)';
  target.style.backgroundColor = 'rgba(254, 249, 195, 0.6)';
  setTimeout(() => {
    target.style.cssText = prev;
  }, 1800);
}

/**
 * Minimal CSS.escape polyfill — enough for our anchor values which are
 * expected to be simple ASCII identifiers. Falls back to native
 * CSS.escape when available (modern browsers).
 */
function cssEscape(value: string): string {
  try {
    if (typeof CSS !== 'undefined' && typeof (CSS as any).escape === 'function') {
      return (CSS as any).escape(value);
    }
  } catch { /* ignore */ }
  return value.replace(/["\\\]]/g, '\\$&');
}
