'use client';

import { useState, useEffect, useCallback } from 'react';
import { DynamicAppendixForm } from '../DynamicAppendixForm';
import { useActionTriggers } from '@/hooks/useActionTriggers';
import type { TemplateQuestion, TemplateSectionMeta } from '@/types/methodology';
import { normaliseTemplateItems } from '@/lib/template-items';

interface Props {
  engagementId: string;
}

export function EthicsTab({ engagementId }: Props) {
  const [data, setData] = useState<Record<string, unknown>>({});
  const [questions, setQuestions] = useState<TemplateQuestion[]>([]);
  const [sectionMeta, setSectionMeta] = useState<Record<string, TemplateSectionMeta>>({});
  const [loading, setLoading] = useState(true);
  const actionTriggers = useActionTriggers();

  const loadData = useCallback(async () => {
    try {
      const [dataRes, templateRes] = await Promise.all([
        fetch(`/api/engagements/${engagementId}/ethics`),
        fetch(`/api/methodology-admin/templates?templateType=ethics_questions&engagementId=${encodeURIComponent(engagementId)}`),
      ]);

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
        // Items may be stored as either a flat TemplateQuestion[] OR
        // { questions, sectionMeta } — normaliseTemplateItems handles
        // both shapes. Pulling sectionMeta here is what lets the
        // admin-configured 4-col / 5-col layouts actually render.
        const { questions: qs, sectionMeta: sm } = normaliseTemplateItems(json.template?.items || json.items);
        if (qs.length > 0) setQuestions(qs);
        setSectionMeta(sm);
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

  // firm_fees (and any other firm-wide variables) are auto-loaded inside
  // DynamicAppendixForm via useFirmVariables() — no per-tab plumbing needed.
  return (
    <DynamicAppendixForm
      engagementId={engagementId}
      endpoint="ethics"
      questions={questions}
      initialData={data as Record<string, string | number | boolean | null>}
      sectionMeta={sectionMeta}
      showActionTriggers
      actionTriggerOptions={actionTriggers}
    />
  );
}
