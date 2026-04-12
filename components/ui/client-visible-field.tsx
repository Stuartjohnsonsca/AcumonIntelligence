'use client';

/**
 * ClientVisibleField — visual indicator that a user-definable field will appear
 * on a client-facing letter. Wraps any input/textarea/select and adds a red
 * outline + tooltip so users know what they type will be seen by a client.
 *
 * Usage:
 *   <ClientVisibleField letterName="Planning Letter">
 *     <textarea ... />
 *   </ClientVisibleField>
 *
 * The outline is applied via a wrapper div; we do not inject classes into the
 * child element, so any existing styling on the input is preserved.
 */
import { Eye } from 'lucide-react';
import { ReactNode } from 'react';

export interface ClientVisibleFieldProps {
  children: ReactNode;
  /** Optional letter name for a more specific tooltip (e.g. "Planning Letter"). */
  letterName?: string;
  /** Set false to disable the indicator without removing the wrapper (useful for conditionals). */
  active?: boolean;
  className?: string;
}

export function ClientVisibleField({
  children,
  letterName,
  active = true,
  className = '',
}: ClientVisibleFieldProps) {
  if (!active) return <>{children}</>;

  const tooltip = letterName
    ? `This content appears on the ${letterName} sent to the client.`
    : 'This content appears on letters sent to the client.';

  return (
    <div
      className={`relative inline-block w-full rounded-md ring-2 ring-red-500 ring-offset-1 ring-offset-white ${className}`}
      title={tooltip}
    >
      {children}
      <span
        className="pointer-events-none absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-white shadow-sm"
        aria-hidden="true"
      >
        <Eye className="h-2.5 w-2.5" />
      </span>
    </div>
  );
}
