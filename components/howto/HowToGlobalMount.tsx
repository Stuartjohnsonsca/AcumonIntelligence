'use client';

import { usePathname } from 'next/navigation';
import { HowToButton } from './HowToButton';
import { HowToOverlay } from './HowToOverlay';

/**
 * Global mount point for the "How do I…?" guide. Hidden on routes where
 * the widget would be inappropriate (login, marketing, OAuth callbacks,
 * external specialist review). Shown everywhere else, including the
 * client portal — portal users benefit from the guide too.
 */
const HIDE_PREFIXES = [
  '/login',
  '/subscribe',
  '/access-denied',
  '/specialist-review',
  '/xero-authorise',
  '/xero-select-org',
  '/product-access',
];

const HIDE_EXACT = ['/', '/about'];

export function HowToGlobalMount() {
  const pathname = usePathname() || '';
  if (HIDE_EXACT.includes(pathname)) return null;
  if (HIDE_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  return (
    <>
      <HowToButton />
      <HowToOverlay />
    </>
  );
}
