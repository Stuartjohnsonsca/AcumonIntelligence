import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { slugifyQuestionText } from '@/lib/formula-engine';

/**
 * POST /api/methodology-admin/ai-formula-field
 *
 * Given a natural-language description ("the hard close date from the
 * Opening tab", "audit fee from firm variables"), returns a list of
 * candidate formula identifiers the admin can click-to-insert into a
 * formula expression.
 *
 * Grounding strategy: the model is given the FULL catalogue of
 * identifiers it's allowed to produce — sibling questions on the
 * current schedule, appendix keys + sample fields, firm variables,
 * and the synthetic `engagement` bucket's field list. Any suggestion
 * that isn't in the catalogue is dropped post-hoc, so the model
 * cannot hallucinate a non-existent field.
 *
 * Falls back to a simple keyword match if the AI service is
 * unavailable so the button still produces useful hits offline.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.firmId) return NextResponse.json({ error: 'No firm' }, { status: 400 });
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Methodology-admin access required.' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const templateType = typeof body.templateType === 'string' ? body.templateType : '';
  const siblingQuestions = Array.isArray(body.siblingQuestions) ? body.siblingQuestions : [];
  if (!description) return NextResponse.json({ error: 'description required' }, { status: 400 });

  // Build the identifier catalogue the model is allowed to return.
  //   1. siblings — questions on the CURRENT schedule, by slug
  //   2. appendix cross-refs — every other questionnaire's field set
  //   3. engagement bucket — Opening-tab data (hard-coded shape
  //      mirrors buildEngagementBucket in /questionnaires/route.ts)
  //   4. firm variables — if the firm has a variables template
  const catalogue: Array<{ id: string; label: string; source: string }> = [];

  // 1. Siblings (same schedule).
  for (const s of siblingQuestions) {
    if (!s || typeof s !== 'object') continue;
    const slug = slugifyQuestionText(s.questionText);
    if (slug) catalogue.push({ id: slug, label: `${s.questionText} (this schedule)`, source: 'sibling' });
  }

  // 2. Other appendices. Only include them at the appendix level so
  //    we don't balloon the prompt; the model returns `<appendix>.<field>`
  //    and we post-validate the field portion separately.
  const APPENDICES: Array<{ key: string; templateType: string; label: string }> = [
    { key: 'ethics',            templateType: 'ethics_questions',            label: 'Ethics / Appendix B' },
    { key: 'continuance',       templateType: 'continuance_questions',       label: 'Continuance / Appendix C' },
    { key: 'permanentFile',     templateType: 'permanent_file_questions',    label: 'Permanent File / Appendix A' },
    { key: 'materiality',       templateType: 'materiality_questions',       label: 'Materiality / Appendix E' },
    { key: 'newClientTakeOn',   templateType: 'new_client_takeon_questions', label: 'New Client Take-on' },
    { key: 'subsequentEvents',  templateType: 'subsequent_events_questions', label: 'Subsequent Events' },
  ];
  const appendixFields: Record<string, string[]> = {};
  const templates = await prisma.methodologyTemplate.findMany({
    where: { firmId: session.user.firmId, templateType: { in: APPENDICES.map(a => a.templateType) } },
    select: { templateType: true, items: true },
  }).catch(() => []);
  for (const a of APPENDICES) {
    const t = templates.find(tt => tt.templateType === a.templateType);
    const items = Array.isArray(t?.items) ? (t!.items as any[]) : [];
    const fields: string[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const key = typeof item.key === 'string' && item.key.trim()
        ? item.key.trim()
        : slugifyQuestionText(item.questionText);
      if (!key) continue;
      if (!fields.includes(key)) fields.push(key);
      catalogue.push({
        id: `${a.key}.${key}`,
        label: `${a.label} → ${item.questionText || key}`,
        source: 'appendix',
      });
    }
    if (fields.length > 0) appendixFields[a.key] = fields;
  }

  // 3. Engagement bucket — hard-coded list keeps the prompt small
  //    AND accurate regardless of whether a particular engagement has
  //    the field set (we want suggestions for fields that COULD be
  //    populated, not just those that are).
  const ENGAGEMENT_FIELDS: Array<{ id: string; label: string }> = [
    { id: 'engagement.audit_type',        label: 'Opening tab — Audit type (SME/PIE/…)' },
    { id: 'engagement.status',            label: 'Opening tab — Engagement status' },
    { id: 'engagement.is_group_audit',    label: 'Opening tab — Is group audit' },
    { id: 'engagement.is_new_client',     label: 'Opening tab — Is new client (first-year)' },
    { id: 'engagement.info_request_type', label: 'Opening tab — Information request type' },
    { id: 'engagement.hard_close_date',   label: 'Opening tab — Hard close date' },
    { id: 'engagement.started_at',        label: 'Opening tab — Engagement started at' },
    { id: 'engagement.completed_at',      label: 'Opening tab — Engagement completed at' },
    { id: 'engagement.period_start',      label: 'Opening tab — Period start (ISO)' },
    { id: 'engagement.period_end',        label: 'Opening tab — Period end (ISO)' },
    { id: 'engagement.period_start_date', label: 'Opening tab — Period start (yyyy-MM-dd)' },
    { id: 'engagement.period_end_date',   label: 'Opening tab — Period end (yyyy-MM-dd)' },
    { id: 'engagement.client_name',       label: 'Opening tab — Client name' },
    { id: 'engagement.client_sector',     label: 'Opening tab — Client sector' },
    { id: 'engagement.client_is_pie',     label: 'Opening tab — Client is PIE' },
    { id: 'engagement.client_is_listed',  label: 'Opening tab — Client is listed' },
    { id: 'engagement.firm_name',         label: 'Opening tab — Firm name' },
    // Timetable (agreed dates) — shape depends on admin's own labels.
    // We describe the pattern rather than enumerating every dated row.
    { id: 'engagement.<agreed-date-slug>',                label: 'Opening tab — any agreed-date target (e.g. engagement.hard_close)' },
    { id: 'engagement.<agreed-date-slug>_progress',       label: 'Opening tab — any agreed-date progress label' },
    // Team (per role).
    { id: 'engagement.team_<role>_name',  label: 'Opening tab — team member name by role (e.g. team_ri_name)' },
    { id: 'engagement.team_<role>_email', label: 'Opening tab — team member email by role' },
    { id: 'engagement.team_<role>_title', label: 'Opening tab — team member job title by role' },
    // Specialists.
    { id: 'engagement.specialist_<type>_name',  label: 'Opening tab — specialist name by type' },
    { id: 'engagement.specialist_<type>_email', label: 'Opening tab — specialist email by type' },
    { id: 'engagement.specialist_<type>_firm',  label: 'Opening tab — specialist firm by type' },
  ];
  for (const f of ENGAGEMENT_FIELDS) catalogue.push({ id: f.id, label: f.label, source: 'engagement' });

  // 4. Firm variables — pulled from the firm_variables risk-table
  //    row + the legacy firm_variables methodology template (older
  //    firms may still hold variables there). Shape is { name }[].
  try {
    const fvTemplate = await prisma.methodologyTemplate.findFirst({
      where: { firmId: session.user.firmId, templateType: 'firm_variables' },
      select: { items: true },
    });
    const items = Array.isArray(fvTemplate?.items) ? fvTemplate!.items as any[] : [];
    for (const item of items) {
      if (!item?.name) continue;
      catalogue.push({ id: String(item.name), label: `Firm variable — ${item.name}`, source: 'firm' });
    }
  } catch {}
  // 5. Min-fee-per-hour by audit type (Firm Wide Assumptions →
  //    "Minimum Average Fee per Hour"). Surface every audit type
  //    so formulas can pick the right one for the engagement context.
  try {
    const minRow = await prisma.methodologyRiskTable.findFirst({
      where: { firmId: session.user.firmId, tableType: 'min_avg_fee_per_hour' },
      select: { data: true },
    });
    const byAuditType = (minRow?.data as any)?.byAuditType;
    if (byAuditType && typeof byAuditType === 'object') {
      for (const auditType of Object.keys(byAuditType)) {
        const name = `min_avg_fee_per_hour_${String(auditType).toLowerCase()}`;
        catalogue.push({ id: name, label: `Min average fee/hour — ${auditType}`, source: 'firm' });
      }
      catalogue.push({ id: 'min_avg_fee_per_hour', label: 'Min average fee/hour (default = SME)', source: 'firm' });
    }
  } catch {}

  const apiKey = process.env.TOGETHER_API_KEY;
  // Offline / no-AI fallback: token-overlap keyword match.
  function keywordFallback(): Array<{ id: string; label: string; reasoning: string }> {
    const q = description.toLowerCase();
    const terms = q.split(/\s+/).filter((w: string) => w.length > 2);
    const scored = catalogue.map(c => {
      const blob = `${c.id} ${c.label}`.toLowerCase();
      let score = 0;
      for (const t of terms) if (blob.includes(t)) score += 1;
      return { ...c, score };
    }).filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
    return scored.map(c => ({ id: c.id, label: c.label, reasoning: 'Keyword match on field label.' }));
  }

  if (!apiKey) {
    return NextResponse.json({ suggestions: keywordFallback(), source: 'fallback' });
  }

  const catalogueForPrompt = catalogue.map(c => `  ${c.id}  —  ${c.label}`).join('\n').slice(0, 14000);
  const system =
    'You are a formula-reference suggester for an audit-methodology schedule designer. ' +
    'Return ONLY JSON — no prose, no markdown fences. Only use identifiers that appear in the provided catalogue. ' +
    'Never invent field names. When the admin\'s description mentions a patterned field (e.g. an agreed date, a team role, a specialist type), ' +
    'emit the pattern with the placeholder expanded using the admin\'s wording slugified (e.g. `engagement.hard_close` from "hard close date"). ' +
    'Return at most 5 suggestions, best first.';
  const user = `Admin description:\n"""${description.slice(0, 500)}"""\n\nTemplate type: ${templateType || 'unknown'}\n\nCatalogue (id — label):\n${catalogueForPrompt}\n\nReturn JSON:\n{\n  "suggestions": [\n    { "id": "engagement.hard_close", "reasoning": "one-line explanation" }\n  ]\n}`;

  try {
    const r = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: 600,
        temperature: 0.1,
      }),
    });
    if (!r.ok) throw new Error(`AI returned ${r.status}`);
    const data = await r.json();
    const text = (data.choices?.[0]?.message?.content || '').trim().replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
    const json = JSON.parse(match ? match[1] : text);

    const rawSuggestions = Array.isArray(json.suggestions) ? json.suggestions : [];
    // Post-validate: require that every suggested id either appears
    // in the catalogue OR matches a pattern (engagement.<some_slug>,
    // team_<role>_name, etc.). Drop anything else.
    const catalogueIds = new Set(catalogue.map(c => c.id));
    const validPatterns: RegExp[] = [
      /^engagement\.[a-z0-9_]+$/,
      /^engagement\.team_[a-z0-9_]+_(name|email|title)$/,
      /^engagement\.specialist_[a-z0-9_]+_(name|email|firm)$/,
      /^engagement\.(agreed_)?[a-z0-9_]+(_date|_progress)?$/,
      /^(ethics|continuance|permanentFile|materiality|newClientTakeOn|subsequentEvents)\.[a-z0-9_]+$/,
      /^[a-z0-9_]+$/,
    ];
    const validated: Array<{ id: string; label: string; reasoning: string }> = [];
    for (const s of rawSuggestions) {
      const id = typeof s?.id === 'string' ? s.id.trim() : '';
      if (!id) continue;
      if (catalogueIds.has(id) || validPatterns.some(p => p.test(id))) {
        // Look up the label from the catalogue when we have it,
        // else synthesise one from the pattern.
        const cat = catalogue.find(c => c.id === id);
        const label = cat?.label || `Custom — ${id}`;
        const reasoning = typeof s?.reasoning === 'string' ? String(s.reasoning).slice(0, 200) : '';
        validated.push({ id, label, reasoning });
      }
    }
    // If the model produced nothing usable, fall back to keyword match.
    return NextResponse.json({ suggestions: validated.length > 0 ? validated : keywordFallback(), source: validated.length > 0 ? 'ai' : 'fallback' });
  } catch (err) {
    console.error('[ai-formula-field] failed, using fallback:', (err as any)?.message || err);
    return NextResponse.json({ suggestions: keywordFallback(), source: 'fallback' });
  }
}
