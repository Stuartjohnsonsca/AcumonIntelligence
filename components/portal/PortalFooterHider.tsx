'use client';

import { usePathname } from 'next/navigation';

export function PortalFooterHider() {
  const pathname = usePathname();
  if (pathname.startsWith('/portal')) return null;

  return (
    <footer className="border-t py-8 bg-slate-900 text-slate-400">
      <div className="container mx-auto px-4 text-center">
        <p className="text-sm">
          &copy; {new Date().getFullYear()} Acumon Intelligence. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
