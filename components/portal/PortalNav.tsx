'use client';

import { Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Home, User, LogOut } from 'lucide-react';

function PortalNavInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  // Don't show nav on the login page
  const isLoginPage = pathname === '/portal';
  if (isLoginPage) {
    return (
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-2">
          <span className="text-lg font-bold text-blue-800">acumon</span>
          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Client Portal</span>
        </div>
      </header>
    );
  }

  function tokenParam(path: string) {
    return token ? `${path}?token=${token}` : path;
  }

  const navItems = [
    { href: tokenParam('/portal/dashboard'), label: 'Home', icon: Home, key: 'dashboard' },
    { href: tokenParam('/portal/my-details'), label: 'My Details', icon: User, key: 'my-details' },
  ];

  function handleLogOff() {
    window.location.href = '/portal';
  }

  return (
    <header className="bg-white border-b border-slate-200 px-6 py-0">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href={tokenParam('/portal/dashboard')} className="flex items-center gap-2 py-3">
            <span className="text-lg font-bold text-blue-800">acumon</span>
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Client Portal</span>
          </Link>

          <nav className="flex items-center gap-1">
            {navItems.map(item => {
              const isActive = pathname.includes(item.key);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={`flex items-center gap-1.5 px-3 py-3 text-sm font-medium border-b-2 transition-colors ${
                    isActive
                      ? 'border-blue-600 text-blue-700'
                      : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <button
          onClick={handleLogOff}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Log Off
        </button>
      </div>
    </header>
  );
}

export function PortalNav() {
  return <Suspense><PortalNavInner /></Suspense>;
}
