'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ClipboardCheck, Calculator, Briefcase, Receipt, Monitor } from 'lucide-react';

const SERVICE_TILES = [
  {
    title: 'Audit Client Support',
    description: 'View and respond to audit evidence requests, upload documents, and track progress.',
    href: '/portal/audit',
    icon: ClipboardCheck,
    color: 'bg-blue-50 border-blue-200 hover:bg-blue-100 hover:border-blue-400',
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-100',
  },
  {
    title: 'Accounting Support',
    description: 'Get help with bookkeeping, financial reporting, and accounting queries.',
    href: '/portal/accounting',
    icon: Calculator,
    color: 'bg-teal-50 border-teal-200 hover:bg-teal-100 hover:border-teal-400',
    iconColor: 'text-teal-600',
    iconBg: 'bg-teal-100',
  },
  {
    title: 'Consulting Support',
    description: 'Business advisory, strategy, and operational improvement assistance.',
    href: '/portal/consulting',
    icon: Briefcase,
    color: 'bg-purple-50 border-purple-200 hover:bg-purple-100 hover:border-purple-400',
    iconColor: 'text-purple-600',
    iconBg: 'bg-purple-100',
  },
  {
    title: 'Tax Support',
    description: 'Tax planning, compliance, VAT queries, and tax return assistance.',
    href: '/portal/tax',
    icon: Receipt,
    color: 'bg-amber-50 border-amber-200 hover:bg-amber-100 hover:border-amber-400',
    iconColor: 'text-amber-600',
    iconBg: 'bg-amber-100',
  },
  {
    title: 'Technology Support',
    description: 'IT systems, software, digital transformation, and tech infrastructure help.',
    href: '/portal/technology',
    icon: Monitor,
    color: 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100 hover:border-indigo-400',
    iconColor: 'text-indigo-600',
    iconBg: 'bg-indigo-100',
  },
];

export default function PortalDashboardPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  return (
    <div>
      <div className="text-center mb-10">
        <h1 className="text-2xl font-bold text-slate-900">Welcome to your Client Portal</h1>
        <p className="text-sm text-slate-500 mt-2">
          Select a service below to get started.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
        {SERVICE_TILES.map((tile) => (
          <Link
            key={tile.href}
            href={`${tile.href}?token=${token}`}
            className={`group block p-8 rounded-xl border-2 transition-all shadow-sm hover:shadow-lg ${tile.color}`}
          >
            <div className={`inline-flex items-center justify-center w-14 h-14 rounded-xl ${tile.iconBg} mb-4 group-hover:scale-110 transition-transform`}>
              <tile.icon className={`h-7 w-7 ${tile.iconColor}`} />
            </div>
            <h2 className="text-lg font-semibold text-slate-900 mb-1">{tile.title}</h2>
            <p className="text-sm text-slate-600">{tile.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
