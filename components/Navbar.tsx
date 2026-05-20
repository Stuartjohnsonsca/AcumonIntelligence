'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useState, useEffect, useCallback } from 'react';
import { Menu, X, ChevronDown, LogIn, LogOut, User, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ASSURANCE_PRODUCTS, FINANCIAL_ACCOUNTS_ITEMS } from '@/lib/products';

// Audit click goes straight to the SME methodology page — the dropdown
// of all audit types was removed in favour of a single fast-click entry
// point. Other audit types (PIE, GROUP, controls variants) live behind
// their own URLs and aren't promoted in the top nav.
const AUDIT_LANDING_URL = '/tools/methodology/StatAudit';
import { cn } from '@/lib/utils';
import { BackgroundTaskDots } from '@/components/BackgroundTaskDots';

export function Navbar() {
  const { data: session } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  // ── State (declared up-front — must run on EVERY render) ───────────────
  // Previously, an early `if (pathname.startsWith('/portal')) return null;`
  // sat between the three hooks above and the useState calls below. That
  // is a Rules-of-Hooks violation: when the user crossed a portal/non-
  // portal boundary, the hook count between renders changed and React
  // would silently desynchronise its internal hook indices, leaving the
  // navbar mounted but unresponsive to clicks (e.g. "My Account does
  // nothing"). Hooks now always run; the portal-page no-op moved down
  // below where it's safe to short-circuit the render.
  const [mobileOpen, setMobileOpen] = useState(false);
  const [assuranceOpen, setAssuranceOpen] = useState(false);
  const [financialOpen, setFinancialOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [toolSessions, setToolSessions] = useState<{toolKey: string; toolLabel: string; clients: {clientId: string; clientName: string; periods: {id: string; periodLabel: string; toolPath: string}[]}[]}[]>([]);
  const [actionCount, setActionCount] = useState(0);

  const isAuthenticated = session?.user && session.user.twoFactorVerified;

  // Poll outstanding actions count for badge
  const pollActions = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await fetch('/api/user/outstanding-actions?countOnly=true');
      if (res.ok) {
        const data = await res.json();
        setActionCount(data.totalCount || 0);
      }
    } catch { /* ignore */ }
  }, [isAuthenticated]);

  useEffect(() => {
    pollActions();
    const interval = setInterval(pollActions, 60000);
    return () => clearInterval(interval);
  }, [pollActions]);

  function handleProductClick(urlPrefix: string) {
    if (!isAuthenticated) {
      router.push(`/login?redirect=${urlPrefix}`);
      return;
    }
    router.push(`/product-access?prefix=${urlPrefix}`);
  }

  // Portal pages have their own nav — render nothing here. Sits AFTER
  // every hook above so React always sees the same hook order across
  // portal/non-portal transitions.
  if (pathname.startsWith('/portal')) return null;

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60 shadow-sm">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo + Background Task Dots */}
          <div className="flex items-center flex-shrink-0">
            <Link
              href="/"
              className="flex items-center"
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
            <BackgroundTaskDots />
          </div>

          {/* Desktop Nav */}
          <div className="hidden lg:flex items-center space-x-1">
            <Link
              href="/about"
              data-howto-id="nav.about"
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
            >
              About
            </Link>

            {/* Audit — single fast-click to the SME methodology page.
                Quality Management lives on the My Account performance
                dashboard; the four Tools entries moved to a top-level
                Tools dropdown. */}
            <Link
              href={AUDIT_LANDING_URL}
              data-howto-id="nav.audit"
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
            >
              Audit
            </Link>

            {/* Assurance Dropdown */}
            <div
              className="relative"
              onMouseEnter={() => setAssuranceOpen(true)}
              onMouseLeave={() => setAssuranceOpen(false)}
            >
              <button
                onClick={() => setAssuranceOpen(!assuranceOpen)}
                data-howto-id="nav.assurance"
                className="flex items-center space-x-1 px-4 py-2 text-sm font-medium text-slate-700 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
              >
                <span>Assurance</span>
                <ChevronDown className={cn('h-4 w-4 transition-transform', assuranceOpen && 'rotate-180')} />
              </button>
              {assuranceOpen && (
                <div className="absolute top-full left-0 pt-1 w-64 z-50">
                  <div className="bg-white rounded-lg shadow-lg border border-slate-200 py-1">
                    <button
                      onClick={() => { setAssuranceOpen(false); if (!isAuthenticated) { router.push('/login?redirect=/tools/assurance'); } else { router.push('/tools/assurance'); } }}
                      data-howto-id="nav.assurance.hub"
                      className="w-full text-left px-4 py-2.5 text-sm font-semibold text-blue-600 hover:bg-blue-50 transition-colors border-b border-slate-100"
                    >
                      Assurance Hub
                    </button>
                    <button
                      onClick={() => { setAssuranceOpen(false); if (!isAuthenticated) { router.push('/login?redirect=/tools/risk'); } else { router.push('/tools/risk'); } }}
                      data-howto-id="nav.assurance.risk"
                      className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                    >
                      Risk
                    </button>
                    <button
                      onClick={() => { setAssuranceOpen(false); if (!isAuthenticated) { router.push('/login?callbackUrl=/tools/risk-forum'); } else { router.push('/tools/risk-forum'); } }}
                      data-howto-id="nav.assurance.risk-forum"
                      className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                    >
                      Risk Forum
                    </button>
                    <button
                      onClick={() => { setAssuranceOpen(false); if (!isAuthenticated) { router.push('/login?callbackUrl=/tools/risk-forum/assessments'); } else { router.push('/tools/risk-forum/assessments'); } }}
                      className="w-full text-left pl-8 pr-4 py-2 text-xs text-slate-500 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                    >
                      ↳ Behavioural Assessments
                    </button>
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

            {/* Financial Accounts Dropdown */}
            <div
              className="relative"
              onMouseEnter={() => setFinancialOpen(true)}
              onMouseLeave={() => setFinancialOpen(false)}
            >
              <button
                onClick={() => setFinancialOpen(!financialOpen)}
                data-howto-id="nav.financial"
                className="flex items-center space-x-1 px-4 py-2 text-sm font-medium text-slate-700 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
              >
                <span>Financial Accounts</span>
                <ChevronDown className={cn('h-4 w-4 transition-transform', financialOpen && 'rotate-180')} />
              </button>
              {financialOpen && (
                <div className="absolute top-full left-0 pt-1 w-56 z-50">
                  <div className="bg-white rounded-lg shadow-lg border border-slate-200 py-1">
                    {FINANCIAL_ACCOUNTS_ITEMS.map((item) => (
                      <button
                        key={item.urlPrefix}
                        onClick={() => { setFinancialOpen(false); handleProductClick(item.urlPrefix); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                      >
                        {item.navLabel}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Tools Dropdown — promoted to top-level; replaces the
                old Connections placeholder. Items used to live inside
                the Audit dropdown's Tools sub-menu. */}
            <div
              className="relative"
              onMouseEnter={() => setToolsOpen(true)}
              onMouseLeave={() => setToolsOpen(false)}
            >
              <button
                onClick={() => setToolsOpen(!toolsOpen)}
                data-howto-id="nav.tools"
                className="flex items-center space-x-1 px-4 py-2 text-sm font-medium text-slate-700 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
              >
                <span>Tools</span>
                <ChevronDown className={cn('h-4 w-4 transition-transform', toolsOpen && 'rotate-180')} />
              </button>
              {toolsOpen && (
                <div className="absolute top-full left-0 pt-1 w-64 z-50">
                  <div className="bg-white rounded-lg shadow-lg border border-slate-200 py-1">
                    {[
                      { label: 'Financial Data Extraction', prefix: 'DateExtraction' },
                      { label: 'Sample Calculator', prefix: 'Sampling' },
                      { label: 'Document Summary', prefix: 'DocSummary' },
                      { label: 'Financial Statement Review', prefix: 'FSChecker' },
                    ].map(item => (
                      <button
                        key={item.prefix}
                        onClick={() => { setToolsOpen(false); handleProductClick(item.prefix); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Deal Portal Link — same "Coming Soon" treatment. */}
            <Link
              href="/deal-portal"
              prefetch={false}
              className="px-4 py-2 text-sm font-medium text-slate-400 rounded-md transition-colors cursor-default"
              onClick={e => e.preventDefault()}
            >
              Deal Portal <span className="text-[10px] text-slate-300 ml-1">Coming Soon</span>
            </Link>

            {/* Resources Link */}
            {isAuthenticated && (
              <Link
                href="/tools/resource-planning"
                data-howto-id="nav.resources"
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
              >
                Resources
              </Link>
            )}

            {/* Sessions Dropdown */}
            {isAuthenticated && (
              <div
                className="relative"
                onMouseEnter={() => {
                  setSessionsOpen(true);
                  fetch('/api/sessions').then(r => r.json()).then(d => setToolSessions(d.sessions || [])).catch(() => {});
                }}
                onMouseLeave={() => setSessionsOpen(false)}
              >
                <button
                  onClick={() => setSessionsOpen(!sessionsOpen)}
                  data-howto-id="nav.sessions"
                  className="flex items-center space-x-1 px-4 py-2 text-sm font-medium text-slate-700 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                >
                  <Layers className="h-4 w-4" />
                  <span>Sessions</span>
                  <ChevronDown className={cn('h-4 w-4 transition-transform', sessionsOpen && 'rotate-180')} />
                </button>
                {sessionsOpen && (
                  <div className="absolute top-full left-0 pt-1 w-72 z-50">
                    <div className="bg-white rounded-lg shadow-lg border border-slate-200 py-1 max-h-80 overflow-y-auto">
                      {toolSessions.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-slate-400">No active sessions</div>
                      ) : (
                        toolSessions.map(tool => (
                          <div key={tool.toolKey}>
                            <div className="px-4 py-1 text-xs font-semibold text-slate-400 uppercase tracking-wide bg-slate-50">
                              {tool.toolLabel}
                            </div>
                            {tool.clients.map(client => (
                              <div key={client.clientId}>
                                <div className="px-6 py-1 text-xs font-medium text-slate-500">{client.clientName}</div>
                                {client.periods.map(period => (
                                  <button
                                    key={period.id}
                                    onClick={() => { setSessionsOpen(false); router.push(period.toolPath); }}
                                    className="w-full text-left px-8 py-1.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                                  >
                                    {period.periodLabel}
                                  </button>
                                ))}
                              </div>
                            ))}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <Link
              href="/my-account"
              data-howto-id="nav.my-account"
              className="relative px-4 py-2 text-sm font-medium text-slate-700 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
            >
              My Account
              {actionCount > 0 && (
                <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-green-500 text-white text-[10px] font-bold leading-none">
                  {actionCount}
                </span>
              )}
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

          <Link
            href={AUDIT_LANDING_URL}
            className="block px-3 py-2 text-sm font-medium text-slate-700 hover:bg-blue-50 rounded-md"
            onClick={() => setMobileOpen(false)}
          >
            Audit
          </Link>

          <div>
            <p className="px-3 py-1 text-xs font-semibold text-slate-400 uppercase tracking-wide">Tools</p>
            {[
              { label: 'Financial Data Extraction', prefix: 'DateExtraction' },
              { label: 'Sample Calculator', prefix: 'Sampling' },
              { label: 'Document Summary', prefix: 'DocSummary' },
              { label: 'Financial Statement Review', prefix: 'FSChecker' },
            ].map(item => (
              <button key={item.prefix} onClick={() => { setMobileOpen(false); handleProductClick(item.prefix); }} className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded-md">{item.label}</button>
            ))}
          </div>

          <div>
            <p className="px-3 py-1 text-xs font-semibold text-slate-400 uppercase tracking-wide">Financial Accounts</p>
            {FINANCIAL_ACCOUNTS_ITEMS.map((item) => (
              <button key={item.urlPrefix} onClick={() => { setMobileOpen(false); handleProductClick(item.urlPrefix); }} className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded-md">
                {item.navLabel}
              </button>
            ))}
          </div>

          <div>
            <p className="px-3 py-1 text-xs font-semibold text-slate-400 uppercase tracking-wide">Assurance</p>
            <button onClick={() => { setMobileOpen(false); if (!isAuthenticated) { router.push('/login?redirect=/tools/assurance'); } else { router.push('/tools/assurance'); } }} className="w-full text-left px-3 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50 rounded-md">Assurance Hub</button>
            <button onClick={() => { setMobileOpen(false); if (!isAuthenticated) { router.push('/login?redirect=/tools/risk'); } else { router.push('/tools/risk'); } }} className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded-md">Risk</button>
            <button onClick={() => { setMobileOpen(false); if (!isAuthenticated) { router.push('/login?callbackUrl=/tools/risk-forum'); } else { router.push('/tools/risk-forum'); } }} className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded-md">Risk Forum</button>
            {ASSURANCE_PRODUCTS.map((product) => (
              <button key={product.urlPrefix} onClick={() => { setMobileOpen(false); handleProductClick(product.urlPrefix); }} className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded-md">
                {product.navLabel}
              </button>
            ))}
          </div>

          <span className="block px-3 py-2 text-sm text-slate-400">Deal Portal <span className="text-[10px] text-slate-300 ml-1">Coming Soon</span></span>

          {isAuthenticated && (
            <Link href="/tools/resource-planning" className="block px-3 py-2 text-sm font-medium text-slate-700 hover:bg-blue-50 rounded-md" onClick={() => setMobileOpen(false)}>Resources</Link>
          )}

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
