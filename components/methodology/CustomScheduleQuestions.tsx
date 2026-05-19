'use client';

import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { DynamicAppendixForm } from './DynamicAppendixForm';
import type { TemplateQuestion } from '@/types/methodology';

interface Props {
  engagementId: string;
  /** The master-schedule key for this panel (e.g. 'eqr_review',
   *  'fs_review'). Resolves to:
   *    - templateType lookup via /api/methodology-admin/templates
   *      (fuzzy-matched so `eqr_review` matches `eqr_review_questions`
   *      saved by the Schedule Designer).
   *    - DynamicAppendixForm's `endpoint` =
   *      `custom-schedule/${scheduleKey}` → routes to the generic
   *      save/load endpoint we added next to it. */
  scheduleKey: string;
  /** Optional heading shown above the form. Defaults to "Custom Firm
   *  Questions" which reads well on every panel. */
  heading?: string;
}

/**
 * Renders the firm's custom Schedule-Designer questions for a
 * built-in-tool panel (EQR Review, FS Review, etc.). Mounts nothing
 * if the firm hasn't built any questions for this schedule key, so
 * the panel stays clean by default and only "lights up" once an
 * admin has populated it under Methodology Admin → Schedule Designer.
 *
 * Used widely — drop it into the bottom of any panel whose master
 * schedule has `designerEnabled: true` (set via the Master Schedule
 * List checkbox).
 */
export function CustomScheduleQuestions({ engagementId, scheduleKey, heading }: Props) {
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState<TemplateQuestion[]>([]);
  const [sectionMeta, setSectionMeta] = useState<Record<string, any> | undefined>(undefined);
  const [initialData, setInitialData] = useState<Record<string, any>>({});
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        // Two parallel fetches:
        //   1. firm's question template for this schedule (Schedule Designer output)
        //   2. engagement's saved answers blob (from our generic endpoint)
        const [tplRes, dataRes] = await Promise.all([
          fetch(`/api/methodology-admin/templates?templateType=${encodeURIComponent(scheduleKey)}&engagementId=${encodeURIComponent(engagementId)}`),
          fetch(`/api/engagements/${engagementId}/custom-schedule/${encodeURIComponent(scheduleKey)}`),
        ]);
        if (cancelled) return;

        if (tplRes.ok) {
          const tplData = await tplRes.json();
          const template = tplData.template || (Array.isArray(tplData.templates) ? tplData.templates[0] : null);
          // items shape is either TemplateQuestion[] (legacy) or
          // { questions: [...], sectionMeta: {...} } — match how
          // SchedulesClient.handleAppendixSave writes it.
          const rawItems = template?.items;
          if (Array.isArray(rawItems)) {
            setQuestions(rawItems as TemplateQuestion[]);
            setSectionMeta(undefined);
          } else if (rawItems && typeof rawItems === 'object') {
            const qs = (rawItems as any).questions;
            setQuestions(Array.isArray(qs) ? qs : []);
            setSectionMeta((rawItems as any).sectionMeta);
          } else {
            setQuestions([]);
          }
        } else {
          setQuestions([]);
        }

        if (dataRes.ok) {
          const json = await dataRes.json();
          setInitialData((json?.data && typeof json.data === 'object') ? json.data : {});
        }
      } catch {
        setErrored(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [engagementId, scheduleKey]);

  // Soft-fail: when there's no template configured, render nothing so
  // the panel stays clean. This is the no-op state for firms that
  // haven't ticked the schedule's Master Schedule List checkbox or
  // haven't added questions yet.
  if (loading) {
    return (
      <div className="mt-4 bg-white border border-slate-200 rounded-lg p-3">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading custom questions…
        </div>
      </div>
    );
  }
  if (errored || questions.length === 0) return null;

  return (
    <div className="mt-4 bg-white border border-slate-200 rounded-lg">
      <div className="px-4 py-2 border-b border-slate-100 flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
        <h3 className="text-sm font-semibold text-slate-800">
          {heading || 'Custom Firm Questions'}
        </h3>
        <span className="text-[10px] text-slate-400 ml-auto">
          Configured under Methodology Admin → Schedule Designer
        </span>
      </div>
      <div className="p-4">
        <DynamicAppendixForm
          engagementId={engagementId}
          endpoint={`custom-schedule/${scheduleKey}`}
          questions={questions}
          initialData={initialData}
          sectionMeta={sectionMeta as any}
        />
      </div>
    </div>
  );
}
