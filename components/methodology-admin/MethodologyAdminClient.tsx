'use client';

import Link from 'next/link';
import { BookOpen, Settings, FileText, ClipboardCheck, Users, FileStack, Mail, AlertTriangle, ShieldAlert } from 'lucide-react';

const tiles = [
  {
    title: 'Firm Wide Assumptions',
    description: 'Risk tables, confidence levels, and assertion mappings',
    href: '/methodology-admin/firm-assumptions',
    icon: Settings,
    color: 'bg-blue-50 border-blue-200 hover:bg-blue-100',
    iconColor: 'text-blue-600',
  },
  {
    title: 'Validation Rules',
    description: 'Firm-wide checks that flag issues on schedules (e.g. audit-fee thresholds)',
    href: '/methodology-admin/validation-rules',
    icon: ShieldAlert,
    color: 'bg-rose-50 border-rose-200 hover:bg-rose-100',
    iconColor: 'text-rose-600',
  },
  {
    title: 'Audit Methodology',
    description: 'Tools, industries, test bank, and schedules',
    href: '/methodology-admin/audit-methodology',
    icon: BookOpen,
    color: 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100',
    iconColor: 'text-emerald-600',
  },
  {
    title: 'Audit Technical Guidance',
    description: 'Technical guidance documentation and standards',
    href: '/methodology-admin/technical-guidance',
    icon: FileText,
    color: 'bg-purple-50 border-purple-200 hover:bg-purple-100',
    iconColor: 'text-purple-600',
  },
  {
    title: 'Audit File Review Selection',
    description: 'Configure file review criteria and selection',
    href: '/methodology-admin/file-review',
    icon: ClipboardCheck,
    color: 'bg-amber-50 border-amber-200 hover:bg-amber-100',
    iconColor: 'text-amber-600',
  },
  {
    title: 'User Performance Reports',
    description: 'View and configure user performance metrics',
    href: '/methodology-admin/user-performance',
    icon: Users,
    color: 'bg-rose-50 border-rose-200 hover:bg-rose-100',
    iconColor: 'text-rose-600',
  },
  {
    title: 'Error Log',
    description: 'Centralised error tracking across all engagements — diagnose and resolve issues',
    href: '/methodology-admin/error-log',
    icon: AlertTriangle,
    color: 'bg-red-50 border-red-200 hover:bg-red-100',
    iconColor: 'text-red-600',
  },
  {
    title: 'Template Documents',
    description: 'Create and manage document templates with merge fields populated from system data',
    href: '/methodology-admin/template-documents',
    icon: FileStack,
    color: 'bg-teal-50 border-teal-200 hover:bg-teal-100',
    iconColor: 'text-teal-600',
  },
  {
    title: 'Internal Communication',
    description: 'Email templates for internal audit team communications',
    href: '/methodology-admin/internal-communication',
    icon: Mail,
    color: 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100',
    iconColor: 'text-indigo-600',
  },
];

export function MethodologyAdminClient() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
