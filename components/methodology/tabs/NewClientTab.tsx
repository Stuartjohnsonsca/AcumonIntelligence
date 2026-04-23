'use client';

import { useState, useEffect, useCallback } from 'react';
import { DynamicAppendixForm } from '../DynamicAppendixForm';
import { useActionTriggers } from '@/hooks/useActionTriggers';
import type { TemplateQuestion, TemplateSectionMeta } from '@/types/methodology';

interface Props {
  engagementId: string;
}

export function NewClientTab({ engagementId }: Props) {
  const [data, setData] = useState<Record<string, unknown>>({});
  const [questions, setQuestions] = useState<TemplateQuestion[]>([]);
  const [sectionMeta, setSectionMeta] = useState<Record<string, TemplateSectionMeta>>({});
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
    /** Shape of the resolved template's `items` — so the admin can
     *  see whether it's a truly-empty array, a nested object with a
     *  sections/questions split, or something the loader isn't
     *  unwrapping. Captured as a short JSON preview (≤500 chars). */
    itemsShape: string | null;
    itemsLength: number | null;
    /** Every firm-scoped template's templateType + item count, so the
     *  admin can see at a glance which row actually has questions. */
    templateSummary: Array<{ templateType: string; auditType: string; itemCount: number }>;
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
      let itemsShape: string | null = null;
      let itemsLength: number | null = null;
      if (templateRes.ok) {
        const json = await templateRes.json();
        resolvedTemplateType = json.resolvedTemplateType ?? json.template?.templateType ?? null;
        resolvedAuditType = json.resolvedAuditType ?? json.template?.auditType ?? null;
        candidateCount = Array.isArray(json.templates) ? json.templates.length : 0;
        const rawItems = json.template?.items;
        // Capture the items shape for the diagnostic. The admin needs
        // to know whether the resolved template has a truly-empty
        // items array, a nested { sections, questions } object the
        // loader isn't unwrapping, or something unexpected.
        if (Array.isArray(rawItems)) {
          itemsLength = rawItems.length;
          itemsShape = `Array[${rawItems.length}]`;
          if (rawItems.length > 0) {
            const firstKeys = Object.keys(rawItems[0] || {}).slice(0, 6).join(', ');
            itemsShape += firstKeys ? ` — first item keys: ${firstKeys}` : '';
          }
        } else if (rawItems && typeof rawItems === 'object') {
          const keys = Object.keys(rawItems).slice(0, 8).join(', ');
          itemsShape = `Object { ${keys} }`;
          // Common legacy shape: { sections: [...], questions: [...] }
          const nested = (rawItems as any).questions;
          if (Array.isArray(nested)) {
            itemsLength = nested.length;
            itemsShape += ` — nested questions[${nested.length}]`;
          }
        } else {
          itemsShape = `${typeof rawItems} (${JSON.stringify(rawItems).slice(0, 60)})`;
          itemsLength = 0;
        }
        // Accept flat arrays OR nested-under-.questions OR .items.
        const items = Array.isArray(rawItems)
          ? rawItems
          : Array.isArray((rawItems as any)?.questions)
            ? (rawItems as any).questions
            : Array.isArray((rawItems as any)?.items)
              ? (rawItems as any).items
              : [];
        if (Array.isArray(items) && items.length > 0) {
          setQuestions(items as TemplateQuestion[]);
        }
        // Preserve any sectionMeta embedded in the raw items blob so
        // admin-configured 4-col/5-col layouts take effect here too.
        if (rawItems && typeof rawItems === 'object' && !Array.isArray(rawItems)) {
          const sm = (rawItems as any).sectionMeta;
          if (sm && typeof sm === 'object') setSectionMeta(sm);
        }
      }

      let availableTypes: string[] = [];
      let templateSummary: Array<{ templateType: string; auditType: string; itemCount: number }> = [];
      if (allTemplatesRes.ok) {
        const j = await allTemplatesRes.json();
        const arr = Array.isArray(j.templates) ? j.templates : [];
        availableTypes = (Array.from(new Set(arr.map((t: any) => String(t.templateType)).filter(Boolean))) as string[]).sort();
        // Compact summary row per template so the admin can spot
        // which one ACTUALLY has questions without having to open
        // each one in the methodology admin UI.
        templateSummary = arr.map((t: any) => {
          const raw = t?.items;
          let n = 0;
          if (Array.isArray(raw)) n = raw.length;
          else if (Array.isArray(raw?.questions)) n = raw.questions.length;
          else if (Array.isArray(raw?.items)) n = raw.items.length;
          return {
            templateType: String(t.templateType || ''),
            auditType: String(t.auditType || ''),
            itemCount: n,
          };
        }).sort((a: any, b: any) => a.templateType.localeCompare(b.templateType));
      }
      setDiag({ resolvedTemplateType, resolvedAuditType, candidateCount, availableTypes, itemsShape, itemsLength, templateSummary });
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
              <div>
                <span className="text-slate-500">Resolved items shape:</span>{' '}
                <span className={diag.itemsLength && diag.itemsLength > 0 ? 'text-green-700' : 'text-red-700'}>
                  {diag.itemsShape || '(no template)'}
                </span>
              </div>
              {diag.itemsLength === 0 && diag.resolvedTemplateType && (
                <div className="pt-1 border-t border-slate-200 text-[10px] font-sans text-amber-700 leading-relaxed">
                  <span className="font-semibold">Diagnosis:</span> the template row exists but has no questions saved in it.
                  Open <span className="font-mono">{diag.resolvedTemplateType}</span> in Methodology Admin →
                  Schedules and add the questions there. Also check the <span className="font-semibold">All firm templateTypes</span> list
                  below — if another row has a non-zero item count, the admin saved questions under a different
                  templateType and may need to copy them across.
                </div>
              )}
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
              {diag.templateSummary.length > 0 && (
                <details className="pt-1 border-t border-slate-200">
                  <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-slate-500 font-sans font-semibold">
                    All firm templates ({diag.templateSummary.length}) — with item counts
                  </summary>
                  <div className="mt-1 max-h-40 overflow-y-auto border border-slate-200 rounded bg-white">
                    <table className="w-full text-[10px]">
                      <thead className="bg-slate-100 sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-1 font-semibold">templateType</th>
                          <th className="text-left px-2 py-1 font-semibold">auditType</th>
                          <th className="text-right px-2 py-1 font-semibold">items</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diag.templateSummary.map((r, i) => (
                          <tr key={i} className={`border-t border-slate-100 ${r.itemCount > 0 ? 'bg-green-50/30' : ''}`}>
                            <td className="px-2 py-1 text-slate-800">{r.templateType}</td>
                            <td className="px-2 py-1 text-slate-600">{r.auditType}</td>
                            <td className={`px-2 py-1 text-right font-semibold ${r.itemCount > 0 ? 'text-green-700' : 'text-slate-400'}`}>{r.itemCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
      sectionMeta={sectionMeta}
      showActionTriggers
      actionTriggerOptions={actionTriggers}
    />
  );
}
