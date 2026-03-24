'use client';

import Link from 'next/link';
import { Wrench, Factory, FlaskConical, Calendar, ClipboardList, BarChart3 } from 'lucide-react';

const tiles = [
  {
    title: 'Audit Types',
    description: 'Configure accounting frameworks and which schedules apply to each audit type',
    href: '/methodology-admin/audit-methodology/audit-types',
    icon: ClipboardList,
    color: 'bg-rose-50 border-rose-200 hover:bg-rose-100',
    iconColor: 'text-rose-600',
  },
  {
    title: 'FS Lines',
    description: 'Define financial statement lines and map them to industries',
    href: '/methodology-admin/audit-methodology/fs-lines',
    icon: BarChart3,
    color: 'bg-cyan-50 border-cyan-200 hover:bg-cyan-100',
    iconColor: 'text-cyan-600',
  },
  {
    title: 'Tools',
    description: 'Configure tool method availability per audit type',
    href: '/methodology-admin/audit-methodology/tools',
    icon: Wrench,
    color: 'bg-blue-50 border-blue-200 hover:bg-blue-100',
    iconColor: 'text-blue-600',
  },
  {
    title: 'Industries',
    description: 'Manage industry definitions for test bank categorisation',
    href: '/methodology-admin/audit-methodology/industries',
    icon: Factory,
    color: 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100',
    iconColor: 'text-emerald-600',
  },
  {
    title: 'Test Bank',
    description: 'Define audit tests by industry and FS statement line',
    href: '/methodology-admin/audit-methodology/test-bank',
    icon: FlaskConical,
    color: 'bg-purple-50 border-purple-200 hover:bg-purple-100',
    iconColor: 'text-purple-600',
  },
  {
    title: 'Schedules',
    description: 'Edit default templates for audit schedules',
    href: '/methodology-admin/audit-methodology/schedules',
    icon: Calendar,
    color: 'bg-amber-50 border-amber-200 hover:bg-amber-100',
    iconColor: 'text-amber-600',
  },
];

export function AuditMethodologyClient() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {tiles.map((tile) => (
        <Link
          key={tile.href}
          href={tile.href}
          className={`block p-6 rounded-lg border transition-colors ${tile.color}`}
        >
          <tile.icon className={`h-8 w-8 ${tile.iconColor} mb-3`} />
          <h2 className="text-lg font-semibold text-slate-900 mb-1">{tile.title}</h2>
          <p className="text-sm text-slate-600">{tile.description}</p>
        </Link>
      ))}
    </div>
  );
}
