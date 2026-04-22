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
  // Diagnostic info captured from the template lookup response.
  // Shown in the empty state so the admin can see WHICH template
  // was resolved (if any) and WHAT templateTypes exist on the firm,
  // rather than guessing why the tab is blank.
  const [diag, setDiag] = useState<{
    resolvedTemplateType: string | null;
    resolvedAuditType: string | null;
    candidateCount: number;
    availableTypes: string[];
  } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [dataRes, templateRes, allTemplatesRes] = await Promise.all([
        fetch(`/api/engagements/${engagementId}/new-client-takeon`),
        // Pass engagementId so the server picks the template for this
        // engagement's audit type (SME / GRANT / …), falling back to
        // ALL when no specific template exists. Avoids the old blank
        // tab when the admin saved questions against a specific
        // audit type rather than ALL.
        fetch(`/api/methodology-admin/templates?templateType=new_client_takeon_questions&engagementId=${encodeURIComponent(engagementId)}`),
        // Diagnostic-only — list every template type on the firm so
        // the empty state can surface them if the primary lookup
        // finds nothing. Auth-gated; returns [] for non-admins,
        // which is fine — diagnostic block just stays empty.
        fetch('/api/methodology-admin/templates'),
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

      let resolvedTemplateType: string | null = null;
      let resolvedAuditType: string | null = null;
      let candidateCount = 0;
      if (templateRes.ok) {
        const json = await templateRes.json();
        resolvedTemplateType = json.resolvedTemplateType ?? json.template?.templateType ?? null;
        resolvedAuditType = json.resolvedAuditType ?? json.template?.auditType ?? null;
        candidateCount = Array.isArray(json.templates) ? json.templates.length : 0;
        const items = json.template?.items || json.items || [];
        if (Array.isArray(items) && items.length > 0) {
          setQuestions(items as TemplateQuestion[]);
        }
      }

      let availableTypes: string[] = [];
      if (allTemplatesRes.ok) {
        const j = await allTemplatesRes.json();
        const arr = Array.isArray(j.templates) ? j.templates : [];
        // Dedupe; only care about the distinct type strings.
        availableTypes = (Array.from(new Set(arr.map((t: any) => String(t.templateType)).filter(Boolean))) as string[]).sort();
      }
      setDiag({ resolvedTemplateType, resolvedAuditType, candidateCount, availableTypes });
    } catch (err) {
      console.error('Failed to load new client take-on:', err);
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading New Client Take-On...</div>;

  if (questions.length === 0) {
    // Diagnostic empty-state so the admin can see WHY nothing
    // matched. Lists every templateType that DOES exist on the
    // firm; usually the problem is a spelling mismatch (extra
    // underscore, slightly different suffix) and the answer is
    // right there in the list.
    const looksLikeNctType = (t: string) =>
      t.toLowerCase().replace(/[^a-z0-9]+/g, '').includes('newclienttakeon')
      || t.toLowerCase().replace(/[^a-z0-9]+/g, '').includes('newclienttakeon');
    const nearMatches = (diag?.availableTypes || []).filter(looksLikeNctType);
    return (
      <div className="py-12 px-6">
        <div className="max-w-xl mx-auto text-center">
          <p className="text-sm text-slate-700 font-medium">No questions configured for New Client Take-On.</p>
          <p className="text-xs text-slate-500 mt-1">
            The Methodology Administrator needs to set up the New Client Take-On schedule
            (Methodology Admin &rarr; Schedules).
          </p>
          {diag && (
            <div className="mt-6 text-left bg-slate-50 border border-slate-200 rounded p-3 text-[11px] space-y-1.5 font-mono">
              <div className="text-[10px] uppercase tracking-wide text-slate-500 font-sans font-semibold mb-1">
                Diagnostic
              </div>
              <div>
                <span className="text-slate-500">Tab requests:</span>{' '}
                <span className="text-slate-800">new_client_takeon_questions</span>
              </div>
              <div>
                <span className="text-slate-500">Resolved by server:</span>{' '}
                <span className={diag.resolvedTemplateType ? 'text-green-700' : 'text-red-700'}>
                  {diag.resolvedTemplateType || '(nothing)'}
                </span>
                {diag.resolvedAuditType && <span className="text-slate-500"> · auditType={diag.resolvedAuditType}</span>}
              </div>
              <div>
                <span className="text-slate-500">Candidates found:</span>{' '}
                <span className="text-slate-800">{diag.candidateCount}</span>
              </div>
              {nearMatches.length > 0 && (
                <div className="pt-1 border-t border-slate-200">
                  <div className="text-[10px] uppercase tracking-wide text-amber-700 font-sans font-semibold mb-0.5">
                    Near-match templateTypes on this firm
                  </div>
                  {nearMatches.map(t => (
                    <div key={t} className="text-amber-700">{t}</div>
                  ))}
                  <div className="text-[10px] text-slate-500 font-sans mt-1">
                    The server tries these automatically via normalised lookup.
                    If none has questions, open that template in
                    Methodology Admin &rarr; Schedules and add them there.
                  </div>
                </div>
              )}
              {diag.availableTypes.length > 0 && (
                <details className="pt-1 border-t border-slate-200">
                  <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-slate-500 font-sans font-semibold">
                    All firm templateTypes ({diag.availableTypes.length})
                  </summary>
                  <div className="mt-1 text-slate-700 max-h-32 overflow-y-auto">
                    {diag.availableTypes.map(t => (
                      <div key={t}>{t}</div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
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
