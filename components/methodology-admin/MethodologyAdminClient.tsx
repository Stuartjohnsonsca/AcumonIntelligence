'use client';

import Link from 'next/link';
import { BookOpen, Settings, FileText, ClipboardCheck, Users, FileStack, Mail, AlertTriangle, ShieldAlert, Brain, ShieldCheck, ShieldOff, Search, Gauge, Trash2, Cloud } from 'lucide-react';

// Map href → registry howto-id so the global guide can point at any tile.
// Keep these in sync with HOWTO_ELEMENTS in lib/howto/registry.ts.
const HOWTO_BY_HREF: Record<string, string> = {
  '/methodology-admin/firm-assumptions':       'tile.firm-assumptions',
  '/methodology-admin/validation-rules':       'tile.validation-rules',
  '/methodology-admin/independence-questions': 'tile.independence-questions',
  '/methodology-admin/independence-bars':      'tile.independence-bars',
  '/methodology-admin/specialist-roles':       'tile.specialist-roles',
  '/methodology-admin/tb-ai-corpus':           'tile.tb-ai-corpus',
  '/methodology-admin/audit-methodology':      'tile.audit-methodology',
  '/methodology-admin/technical-guidance':     'tile.technical-guidance',
  '/methodology-admin/file-review':            'tile.file-review',
  '/methodology-admin/user-performance':       'tile.user-performance',
  '/methodology-admin/performance-dashboard':  'tile.performance-dashboard',
  '/methodology-admin/error-log':              'tile.error-log',
  '/methodology-admin/portal-searches':        'tile.portal-searches',
  '/methodology-admin/template-documents':     'tile.template-documents',
  '/methodology-admin/internal-communication': 'tile.internal-communication',
  '/methodology-admin/data-purge':             'tile.data-purge',
};

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
    title: 'Independence Questions',
    description: 'Firm-wide questions every team member must confirm before accessing an engagement',
    href: '/methodology-admin/independence-questions',
    icon: ShieldCheck,
    color: 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100',
    iconColor: 'text-emerald-600',
  },
  {
    title: 'Independence Bars',
    description: 'Review and clear Independence-related lockouts (per User × Client/Period). Every unbar is recorded in the audit trail.',
    href: '/methodology-admin/independence-bars',
    icon: ShieldOff,
    color: 'bg-red-50 border-red-200 hover:bg-red-100',
    iconColor: 'text-red-600',
  },
  {
    title: 'Specialist Roles',
    description: 'Ethics Partner / MRLO / Management Board / ACP — for the "Send for specialist review" button on schedules',
    href: '/methodology-admin/specialist-roles',
    icon: Users,
    color: 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100',
    iconColor: 'text-indigo-600',
  },
  {
    title: 'TB AI Corpus',
    description: 'Firm-wide learning from past TB classifications — descriptions, consensus answers, and AI accept/override rates',
    href: '/methodology-admin/tb-ai-corpus',
    icon: Brain,
    color: 'bg-fuchsia-50 border-fuchsia-200 hover:bg-fuchsia-100',
    iconColor: 'text-fuchsia-600',
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
    title: 'Performance Dashboard',
    description: 'AQT management view of audit team performance against the G3Q operational model — quality monitoring, RCA, remediation, CSFs and ISQM1 readiness',
    href: '/methodology-admin/performance-dashboard',
    icon: Gauge,
    color: 'bg-lime-50 border-lime-200 hover:bg-lime-100',
    iconColor: 'text-lime-600',
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
    title: 'Portal Searches',
    description: 'Review the free-text searches portal users run on their dashboards — promote the useful ones to featured quick-filter chips for the whole firm',
    href: '/methodology-admin/portal-searches',
    icon: Search,
    color: 'bg-cyan-50 border-cyan-200 hover:bg-cyan-100',
    iconColor: 'text-cyan-600',
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
  {
    title: 'Reset Tab Data',
    description: 'Wipe all data for a chosen tab across every engagement in your firm. Destructive — used to clean up after methodology changes or testing.',
    href: '/methodology-admin/data-purge',
    icon: Trash2,
    color: 'bg-red-50 border-red-200 hover:bg-red-100',
    iconColor: 'text-red-600',
  },
  {
    title: 'Cloud Audit Connectors',
    description: 'Connection recipes for fetching prior audit files from MyWorkPapers and other cloud audit software during the Import Options flow.',
    href: '/methodology-admin/cloud-audit-connectors',
    icon: Cloud,
    color: 'bg-sky-50 border-sky-200 hover:bg-sky-100',
    iconColor: 'text-sky-600',
  },
];

export function MethodologyAdminClient() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {tiles.map((tile) => (
        <Link
          key={tile.href}
          href={tile.href}
          data-howto-id={HOWTO_BY_HREF[tile.href]}
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
