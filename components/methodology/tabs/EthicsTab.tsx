'use client';

import { useState, useEffect, useCallback } from 'react';
import { DynamicAppendixForm } from '../DynamicAppendixForm';
import { useActionTriggers } from '@/hooks/useActionTriggers';
import type { TemplateQuestion } from '@/types/methodology';

interface Props {
  engagementId: string;
}

export function EthicsTab({ engagementId }: Props) {
  const [data, setData] = useState<Record<string, unknown>>({});
  const [questions, setQuestions] = useState<TemplateQuestion[]>([]);
  const [firmFees, setFirmFees] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const actionTriggers = useActionTriggers();

  const loadData = useCallback(async () => {
    try {
      const [dataRes, templateRes, riskTablesRes] = await Promise.all([
        fetch(`/api/engagements/${engagementId}/ethics`),
        fetch(`/api/methodology-admin/templates?templateType=ethics_questions&auditType=ALL`),
        // Pull firm-wide assumptions so we can expose firm_fees to formulas
        fetch('/api/methodology-admin/risk-tables'),
      ]);

      if (riskTablesRes.ok) {
        try {
          const tablesJson = await riskTablesRes.json();
          // Accept either { tables: {...} } (batch shape) or a raw map.
          const map: Record<string, any> = tablesJson.tables || tablesJson || {};
          const val = map.firm_fees?.amount;
          if (typeof val === 'number') setFirmFees(val);
          else if (typeof val === 'string' && !Number.isNaN(Number(val))) setFirmFees(Number(val));
        } catch { /* ignore parse errors */ }
      }

      if (dataRes.ok) {
        const json = await dataRes.json();
        const d = (json.data || {}) as Record<string, unknown>;
        // Flatten: remove __signoffs and __fieldmeta
        const flat: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(d)) {
          if (!k.startsWith('__')) flat[k] = v;
        }
        setData(flat);
      }

      if (templateRes.ok) {
        const json = await templateRes.json();
        const items = json.template?.items || json.items || [];
        if (Array.isArray(items) && items.length > 0) {
          setQuestions(items as TemplateQuestion[]);
        }
      }
    } catch (err) {
      console.error('Failed to load ethics:', err);
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading Ethics...</div>;

  if (questions.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-slate-500">No questions configured for Ethics.</p>
        <p className="text-xs text-slate-400 mt-1">The Methodology Administrator needs to set up the Ethics schedule.</p>
      </div>
    );
  }

  return (
    <DynamicAppendixForm
      engagementId={engagementId}
      endpoint="ethics"
      questions={questions}
      initialData={data as Record<string, string | number | boolean | null>}
      // firm_fees is defined in Methodology Admin → Firm-Wide Assumptions and is passed as
      // a read-only formula variable. It's not saved to the engagement so future changes to
      // the firm-wide value flow through to every engagement automatically.
      externalValues={{ firm_fees: firmFees }}
      showActionTriggers
      actionTriggerOptions={actionTriggers}
    />
  );
}
