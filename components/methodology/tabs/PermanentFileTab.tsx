'use client';

import { useState, useEffect, useCallback } from 'react';
import { DynamicAppendixForm } from '../DynamicAppendixForm';
import { useActionTriggers } from '@/hooks/useActionTriggers';
import type { TemplateQuestion } from '@/types/methodology';

interface Props {
  engagementId: string;
}

export function PermanentFileTab({ engagementId }: Props) {
  const [data, setData] = useState<Record<string, unknown>>({});
  const [questions, setQuestions] = useState<TemplateQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const actionTriggers = useActionTriggers();

  const loadData = useCallback(async () => {
    try {
      // Load form data and methodology template questions in parallel
      const [dataRes, templateRes] = await Promise.all([
        fetch(`/api/engagements/${engagementId}/permanent-file`),
        fetch(`/api/methodology-admin/templates?templateType=permanent_file_questions&engagementId=${encodeURIComponent(engagementId)}`),
      ]);

      if (dataRes.ok) {
        const json = await dataRes.json();
        const flat: Record<string, unknown> = {};
        for (const [, sectionData] of Object.entries(json.data || {})) {
          if (typeof sectionData === 'object' && sectionData) Object.assign(flat, sectionData);
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
      console.error('Failed to load permanent file:', err);
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading...</div>;

  if (questions.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-slate-500">No questions configured for this schedule.</p>
        <p className="text-xs text-slate-400 mt-1">The Methodology Administrator needs to set up the Permanent File schedule.</p>
      </div>
    );
  }

  return (
    <DynamicAppendixForm
      engagementId={engagementId}
      endpoint="permanent-file"
      questions={questions}
      initialData={data as Record<string, string | number | boolean | null>}
      showActionTriggers
      actionTriggerOptions={actionTriggers}
    />
  );
}
