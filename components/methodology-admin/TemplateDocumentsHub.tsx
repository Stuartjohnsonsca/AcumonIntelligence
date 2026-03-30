'use client';

import Link from 'next/link';
import { Mail, FileText } from 'lucide-react';
import { BackButton } from './BackButton';

const options = [
  {
    title: 'Email Templates',
    description: 'Create and manage email templates with merge fields populated from system data',
    href: '/methodology-admin/template-documents/emails',
    icon: Mail,
    color: 'bg-teal-50 border-teal-200 hover:bg-teal-100 hover:border-teal-300',
    iconColor: 'text-teal-600',
    iconBg: 'bg-teal-100',
  },
  {
    title: 'Template Documents',
    description: 'Upload and manage document templates that can be populated from system data',
    href: '/methodology-admin/template-documents/documents',
    icon: FileText,
    color: 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100 hover:border-indigo-300',
    iconColor: 'text-indigo-600',
    iconBg: 'bg-indigo-100',
  },
];

export function TemplateDocumentsHub() {
  return (
    <div className="max-w-4xl mx-auto">
      <BackButton href="/methodology-admin" label="Back to Methodology Admin" />
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Templates</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage email templates and document templates for your firm
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {options.map((opt) => (
          <Link
            key={opt.href}
            href={opt.href}
            className={`group block p-8 rounded-xl border-2 transition-all shadow-sm hover:shadow-md ${opt.color}`}
          >
            <div className={`inline-flex items-center justify-center w-14 h-14 rounded-xl ${opt.iconBg} mb-4 group-hover:scale-110 transition-transform`}>
              <opt.icon className={`h-7 w-7 ${opt.iconColor}`} />
            </div>
            <h2 className="text-lg font-semibold text-slate-900 mb-1">{opt.title}</h2>
            <p className="text-sm text-slate-600">{opt.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
