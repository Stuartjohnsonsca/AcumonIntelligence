'use client';

import { BookOpen } from 'lucide-react';
import type { AuditType } from '@/types/methodology';
import { AUDIT_TYPE_LABELS } from '@/types/methodology';

interface Props {
  auditType: AuditType;
}

export function AuditStubClient({ auditType }: Props) {
  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">{AUDIT_TYPE_LABELS[auditType]}</h1>
        <p className="text-slate-600 mt-1">Audit engagement management</p>
      </div>
      <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-slate-300 rounded-lg">
        <BookOpen className="h-12 w-12 text-slate-300 mb-4" />
        <p className="text-lg text-slate-400 font-medium">Select a Client and Period to Begin</p>
        <p className="text-sm text-slate-400 mt-1">
          The full audit engagement interface will be available in the next release
        </p>
      </div>
    </div>
  );
}
