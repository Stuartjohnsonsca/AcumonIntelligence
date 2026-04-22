'use client';

import { useState, useEffect, useCallback } from 'react';
import { DynamicAppendixForm } from '../DynamicAppendixForm';
import { useActionTriggers } from '@/hooks/useActionTriggers';
import type { TemplateQuestion } from '@/types/methodology';

interface Props {
  engagementId: string;
}

export function NewClientTab({ engagementId }: Props) {
  const [data, setData] = useState<Record<string, unknown>>({});
  const [questions, setQuestions] = useState<TemplateQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const actionTriggers = useActionTriggers();

  const loadData = useCallback(async () => {
    try {
      const [dataRes, templateRes] = await Promise.all([
        fetch(`/api/engagements/${engagementId}/new-client-takeon`),
        // Pass engagementId so the server picks the template for this
        // engagement's audit type (SME / GRANT / …), falling back to
        // ALL when no specific template exists. Avoids the old blank
        // tab when the admin saved questions against a specific
        // audit type rather than ALL.
        fetch(`/api/methodology-admin/templates?templateType=new_client_takeon_questions&engagementId=${encodeURIComponent(engagementId)}`),
      ]);

      if (dataRes.ok) {
        const json = await dataRes.json();
        const d = (json.data || {}) as Record<string, unknown>;
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
      console.error('Failed to load new client take-on:', err);
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading New Client Take-On...</div>;

  if (questions.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-slate-500">No questions configured for New Client Take-On.</p>
        <p className="text-xs text-slate-400 mt-1">The Methodology Administrator needs to set up the New Client Take-On schedule.</p>
      </div>
    );
  }

  return (
    <DynamicAppendixForm
      engagementId={engagementId}
      endpoint="new-client-takeon"
      questions={questions}
      initialData={data as Record<string, string | number | boolean | null>}
      showActionTriggers
      actionTriggerOptions={actionTriggers}
    />
  );
}
