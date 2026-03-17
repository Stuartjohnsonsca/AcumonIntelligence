'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useState } from 'react';
import { Menu, X, ChevronDown, LogIn, LogOut, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { STATUTORY_AUDIT_PRODUCTS, ASSURANCE_PRODUCTS } from '@/lib/products';
import { cn } from '@/lib/utils';

export function Navbar() {
  const { data: session } = useSession();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [assuranceOpen, setAssuranceOpen] = useState(false);

  const isAuthenticated = session?.user && session.user.twoFactorVerified;

  function handleProductClick(urlPrefix: string) {
    if (!isAuthenticated) {
      router.push(`/login?redirect=${urlPrefix}`);
      return;
    }
    router.push(`/product-access?prefix=${urlPrefix}`);
  }

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60 shadow-sm">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link
            href="/"
            className="flex items-center flex-shrink-0"
          >
            <Image
              src="/logo-dark.svg"
              alt="Acumon Intelligence"
              width={160}
              height={51}
              className="h-9 w-auto"
              priority
            />
          </Link>

          {/* Desktop Nav */}
          <div className="hidden lg:flex items-center space-x-1">
            <Link
              href="/about"
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
            >
              About
            </Link>

            {/* Statutory Audit Dropdown */}
            <div
              className="relative"
              onMouseEnter={() => setAuditOpen(true)}
              onMouseLeave={() => setAuditOpen(false)}
            >
              <button
                onClick={() => setAuditOpen(!auditOpen)}
                className="flex items-center space-x-1 px-4 py-2 text-sm font-medium text-slate-700 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
              >
                <span>Statutory Audit</span>
                <ChevronDown className={cn('h-4 w-4 transition-transform', auditOpen && 'rotate-180')} />
              </button>
              {auditOpen && (
                <div className="absolute top-full left-0 pt-1 w-64 z-50">
                  <div className="bg-white rounded-lg shadow-lg border border-slate-200 py-1">
                    {STATUTORY_AUDIT_PRODUCTS.map((product) => (
                      <button
                        key={product.urlPrefix}
                        onClick={() => { setAuditOpen(false); handleProductClick(product.urlPrefix); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                      >
                        {product.navLabel}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Assurance Dropdown */}
            <div
              className="relative"
              onMouseEnter={() => setAssuranceOpen(true)}
              onMouseLeave={() => setAssuranceOpen(false)}
            >
              <button
                onClick={() => setAssuranceOpen(!assuranceOpen)}
                className="flex items-center space-x-1 px-4 py-2 text-sm font-medium text-slate-700 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
              >
                <span>Assurance</span>
                <ChevronDown className={cn('h-4 w-4 transition-transform', assuranceOpen && 'rotate-180')} />
              </button>
              {assuranceOpen && (
                <div className="absolute top-full left-0 pt-1 w-64 z-50">
                  <div className="bg-white rounded-lg shadow-lg border border-slate-200 py-1">
                    {ASSURANCE_PRODUCTS.map((product) => (
                      <button
                        key={product.urlPrefix}
                        onClick={() => { setAssuranceOpen(false); handleProductClick(product.urlPrefix); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                      >
                        {product.navLabel}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Link
              href="/my-account"
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
            >
              My Account
            </Link>
          </div>

          {/* Right side - Login/Logout */}
          <div className="hidden lg:flex items-center space-x-2">
            {isAuthenticated ? (
              <div className="flex items-center space-x-3">
                <span className="text-sm text-slate-600">
                  <User className="inline h-4 w-4 mr-1" />
                  {session.user.name}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => signOut({ callbackUrl: '/' })}
                  className="flex items-center space-x-1"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Logout</span>
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                onClick={() => router.push('/login')}
                className="flex items-center space-x-1 bg-blue-600 hover:bg-blue-700"
              >
                <LogIn className="h-4 w-4" />
                <span>Login</span>
              </Button>
            )}
          </div>

          {/* Mobile menu button */}
          <button
            className="lg:hidden p-2 rounded-md text-slate-700 hover:bg-slate-100"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="lg:hidden border-t bg-white px-4 py-4 space-y-2">
          <Link href="/about" className="block px-3 py-2 text-sm font-medium text-slate-700 hover:bg-blue-50 rounded-md" onClick={() => setMobileOpen(false)}>About</Link>

          <div>
            <p className="px-3 py-1 text-xs font-semibold text-slate-400 uppercase tracking-wide">Statutory Audit</p>
            {STATUTORY_AUDIT_PRODUCTS.map((product) => (
              <button key={product.urlPrefix} onClick={() => { setMobileOpen(false); handleProductClick(product.urlPrefix); }} className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded-md">
                {product.navLabel}
              </button>
            ))}
          </div>

          <div>
            <p className="px-3 py-1 text-xs font-semibold text-slate-400 uppercase tracking-wide">Assurance</p>
            {ASSURANCE_PRODUCTS.map((product) => (
              <button key={product.urlPrefix} onClick={() => { setMobileOpen(false); handleProductClick(product.urlPrefix); }} className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded-md">
                {product.navLabel}
              </button>
            ))}
          </div>

          <Link href="/my-account" className="block px-3 py-2 text-sm font-medium text-slate-700 hover:bg-blue-50 rounded-md" onClick={() => setMobileOpen(false)}>My Account</Link>

          <div className="pt-2 border-t">
            {isAuthenticated ? (
              <Button variant="outline" className="w-full" onClick={() => signOut({ callbackUrl: '/' })}>
                <LogOut className="h-4 w-4 mr-2" />Logout
              </Button>
            ) : (
              <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={() => { setMobileOpen(false); router.push('/login'); }}>
                <LogIn className="h-4 w-4 mr-2" />Login
              </Button>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
