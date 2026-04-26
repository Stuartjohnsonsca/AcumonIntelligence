'use client';

import { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';

/**
 * Read-only banner for the methodology layout. Fetches the caller's
 * role on the engagement and renders a sticky banner at the top of
 * the page when the role is purely read-only (EQR or Regulatory
 * Reviewer). For the standard write roles it returns null so the
 * banner doesn't take up vertical space.
 *
 * Server-side write enforcement (assertEngagementWriteAccess)
 * remains the security guarantee; this is purely the UI signal so
 * the regulator sees their state up front instead of bumping into
 * 403s when they click write controls.
 */
export function ReadOnlyBanner({ engagementId }: { engagementId: string }) {
  const [role, setRole] = useState<string | null>(null);
  const [isReadOnly, setIsReadOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/engagements/${engagementId}/my-role`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setRole(data.role || null);
        setIsReadOnly(Boolean(data.isReadOnly));
      } catch {
        // Silent — banner just doesn't render. Server-side gates still
        // protect writes regardless of whether the banner shows.
      }
    })();
    return () => { cancelled = true; };
  }, [engagementId]);

  if (!isReadOnly) return null;

  // Distinct copy per role so the regulator and the EQR each see a
  // tailored message. Both convey "you can read but not write".
  const isRegulator = role === 'RegulatoryReviewer';
  const heading = isRegulator
    ? 'Regulatory Reviewer — read-only access'
    : 'EQR — read-only access (Review Points only)';
  const detail = isRegulator
    ? 'You have unlimited read access to this engagement. All editing buttons are inactive; the server will reject any attempted write. Generate or download anything that needs to leave the system via the Methodology Administrator.'
    : 'You can record Review Points; all other tabs are read-only for the duration of your review.';

  return (
    <div className="bg-amber-50 border border-amber-300 text-amber-900 px-4 py-2 mb-4 rounded flex items-start gap-3">
      <Eye className="h-4 w-4 mt-0.5 flex-shrink-0" />
      <div className="flex-1">
        <div className="text-sm font-semibold">{heading}</div>
        <div className="text-xs mt-0.5">{detail}</div>
      </div>
    </div>
  );
}
