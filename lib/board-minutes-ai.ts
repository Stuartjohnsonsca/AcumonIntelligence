/**
 * AI-powered board minutes / TCWG extraction.
 * Extracts structured content from uploaded PDF text using firm-defined headings.
 */

export interface BoardMinutesExtraction {
  headings: Record<string, { content: string; flagged: boolean }>;
  otherMatters: string;
  /**
   * Meeting date extracted from the document text in YYYY-MM-DD form.
   * Empty string when the AI could not find a reliable date in the document.
   * Callers should fall back to a user-provided date or "now" when this is missing.
   */
  meetingDate: string;
}

export interface PeriodSummary {
  headings: Record<string, string>;
  overallSummary: string;
}

export interface CarryForwardItem {
  heading: string;
  issue: string;
  firstMentionedDate: string;
  latestMentionDate: string;
  status: 'recurring' | 'unresolved' | 'new';
}

/**
 * Extract structured content from board minutes / TCWG document text using firm-defined headings.
 */
export type MinutesDocType = 'board_minutes' | 'tcwg' | 'shareholders';

export async function extractBoardMinutes(
  documentText: string,
  headings: string[],
  documentType: MinutesDocType,
  meetingDate?: string,
): Promise<BoardMinutesExtraction> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) throw new Error('TOGETHER_API_KEY not configured');

  const headingsList = headings.map((h, i) => `${i + 1}. ${h}`).join('\n');
  const typeLabel =
    documentType === 'tcwg' ? 'Audit Committee / Those Charged With Governance (TCWG)' :
    documentType === 'shareholders' ? 'Shareholder Meeting Minutes (AGM / EGM / General Meeting)' :
    'Board Minutes';

  const systemPrompt = `You are an expert UK audit assistant analysing ${typeLabel} for an external audit. Your task is to produce DETAILED, thorough summaries under each firm-defined heading so the audit team can rely on them without re-reading the original document.

Headings to extract:
${headingsList}

Return ONLY valid JSON with this exact structure:
{
  "meetingDate": "YYYY-MM-DD",
  "headings": {
    "Heading Name": { "content": "detailed multi-paragraph or bulleted summary", "flagged": false },
    ...
  },
  "otherMatters": "detailed summary of any significant audit-relevant matters not covered by the headings above"
}

Meeting date extraction (IMPORTANT)
- Read the document carefully and identify the actual date of the meeting from the text (look in the header, title, "Date of meeting:", "Held on", minutes preamble, signatures, etc.).
- Return it in strict ISO format "YYYY-MM-DD".
- If the document references multiple dates (e.g. the meeting date plus the date the minutes were signed), use the DATE OF THE MEETING, not the signing date.
- If no reliable meeting date can be determined from the text, return "meetingDate": "" (empty string). Never guess or fabricate a date.

Content depth requirements (IMPORTANT)
- Each heading's "content" should be a DETAILED summary, not one sentence. Aim for 3-8 sentences or a bulleted list when the document contains substantive material on that topic.
- Capture specific facts: names of people, entities, counter-parties, dates, monetary amounts (in £ and any other currencies mentioned), percentages, deadlines, and reference numbers. Quote exact wording when the precise phrasing matters (e.g. a resolution passed, a specific undertaking, a disclosed figure).
- Record decisions made, votes cast, approvals granted or withheld, and any dissent.
- Record actions agreed, who is responsible, and target dates.
- Note any matters explicitly deferred, escalated, or referred elsewhere.
- When the topic touches on estimates, judgements, or assumptions, state what the judgement was and the basis for it.
- When the topic was only touched on briefly, summarise what was said and note that it was brief — don't invent detail.
- If a heading genuinely has no relevant content in the document, set content to "" and flagged to false.

Flagging rules
- Set "flagged": true for any content that could indicate: material misstatement risk, going concern concerns, fraud indicators or suspicions, significant litigation, regulatory investigation, covenant breaches, loss of key customer / supplier / personnel, control failures, related-party transactions on non-arm's-length terms, unusual or non-routine transactions, or post-balance-sheet events that affect the financial statements.
- When flagging, make sure the "content" explains WHY it's flagged and what the audit implication is.

Other matters
- The "otherMatters" field is for anything audit-relevant that doesn't fit the configured headings — new business lines, changes to accounting policy, key personnel changes, remuneration decisions for directors, tax disputes, insurance claims, major capex decisions, M&A discussions, etc.
- Make this detailed as well. Don't truncate.

Return format
- Return ONLY the JSON object, no markdown fencing, no commentary before or after.
- Use professional UK audit terminology (ISA (UK), FRC, FRS 102 / IFRS as relevant, "those charged with governance", "material", "significant risk", "estimate", "judgement", etc.).`;

  const userMessage = [
    meetingDate ? `(Hint only — user-provided meeting date: ${meetingDate}. Still confirm / extract the true date from the text.)` : '(No user-provided meeting date — extract the meeting date directly from the text.)',
    '',
    `${typeLabel} Text:`,
    documentText.slice(0, 60000),
  ].filter(Boolean).join('\n');

  const res = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 8000,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`AI board minutes extraction failed: ${res.status} ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  let content = data.choices?.[0]?.message?.content?.trim() || '{}';
  content = content.replace(/^```json?\n?/, '').replace(/\n?```$/, '');

  try {
    const parsed = JSON.parse(content);
    const rawDate = typeof parsed.meetingDate === 'string' ? parsed.meetingDate.trim() : '';
    const extractedDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : '';
    const result: BoardMinutesExtraction = {
      headings: {},
      otherMatters: parsed.otherMatters || '',
      meetingDate: extractedDate,
    };
    for (const h of headings) {
      const entry = parsed.headings?.[h];
      result.headings[h] = {
        content: entry?.content || '',
        flagged: entry?.flagged === true,
      };
    }
    return result;
  } catch {
    const fallback: BoardMinutesExtraction = { headings: {}, otherMatters: content.slice(0, 500), meetingDate: '' };
    for (const h of headings) fallback.headings[h] = { content: '', flagged: false };
    return fallback;
  }
}

/**
 * Generate a period summary across all board minutes / TCWG documents.
 */
export async function generatePeriodSummary(
  allExtractions: { meetingDate: string; headings: Record<string, { content: string; flagged: boolean }> }[],
  headings: string[],
  documentType: MinutesDocType,
): Promise<PeriodSummary> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) throw new Error('TOGETHER_API_KEY not configured');

  const typeLabel =
    documentType === 'tcwg' ? 'TCWG / Audit Committee' :
    documentType === 'shareholders' ? 'Shareholder Meetings' :
    'Board Minutes';

  const minutesSummaries = allExtractions
    .sort((a, b) => new Date(a.meetingDate).getTime() - new Date(b.meetingDate).getTime())
    .map(ext => {
      const lines = Object.entries(ext.headings)
        .filter(([, v]) => v.content)
        .map(([k, v]) => `  ${k}: ${v.content}`);
      return `Meeting ${ext.meetingDate}:\n${lines.join('\n')}`;
    })
    .join('\n\n');

  const systemPrompt = `You are an expert UK audit assistant. Given summaries from multiple ${typeLabel} across an audit period, produce a consolidated period summary for each heading and an overall summary for the audit file.

Return ONLY valid JSON:
{
  "headings": { "Heading Name": "consolidated summary across all meetings for this heading", ... },
  "overallSummary": "overall audit-relevant summary of all ${typeLabel.toLowerCase()} reviewed"
}

Rules:
- Highlight trends, recurring issues, and matters requiring audit attention
- Note any contradictions or changes between meetings
- Be concise but comprehensive
- Return ONLY the JSON object, no markdown wrapping`;

  const res = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Headings: ${headings.join(', ')}\n\n${minutesSummaries.slice(0, 30000)}` },
      ],
      max_tokens: 4000,
      temperature: 0.2,
    }),
  });

  if (!res.ok) throw new Error(`AI period summary failed: ${res.status}`);

  const data = await res.json();
  let content = data.choices?.[0]?.message?.content?.trim() || '{}';
  content = content.replace(/^```json?\n?/, '').replace(/\n?```$/, '');

  try {
    const parsed = JSON.parse(content);
    return {
      headings: parsed.headings || {},
      overallSummary: parsed.overallSummary || '',
    };
  } catch {
    return { headings: {}, overallSummary: content.slice(0, 500) };
  }
}

// ─── Communication Overall Summary ──────────────────────────────────
// Produces a consolidated Communication tab summary across Board Minutes,
// TCWG, Shareholder meetings, client/internal/expert meetings — anything
// the engagement team has captured under Communications. Organised under
// firm-configured headings (default seed:
//   Impacts Financial Statements
//   Impacts Going Concern
//   Impacts Profitability
//   Indicated Significant Decision
// ).

export interface CommunicationOverallInput {
  meetingType: string;
  meetingDate: string;
  title: string;
  headingsText: string;      // collapsed "heading: content" lines from structured extraction
  otherMatters: string;
  rawFallback: string;       // used for meetings without a structured heading blob
}

export interface CommunicationOverallSummary {
  headings: Record<string, { content: string; flagged: boolean; evidence: string[] }>;
  overallNarrative: string;
}

export async function generateCommunicationOverall(
  meetings: CommunicationOverallInput[],
  headings: string[],
): Promise<CommunicationOverallSummary> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) throw new Error('TOGETHER_API_KEY not configured');

  const headingsList = headings.map((h, i) => `${i + 1}. ${h}`).join('\n');

  const meetingLabel = (mt: string) => {
    if (mt === 'board_minutes') return 'Board Minutes';
    if (mt === 'tcwg') return 'Audit Committee / TCWG';
    if (mt === 'shareholders') return 'Shareholder Meeting';
    if (mt === 'client') return 'Client Meeting';
    if (mt === 'internal') return 'Internal Team Meeting';
    if (mt === 'expert') return 'Expert Meeting';
    return mt || 'Meeting';
  };

  const meetingBlocks = meetings.map((m, i) => {
    const parts: string[] = [];
    parts.push(`--- Meeting ${i + 1} [${meetingLabel(m.meetingType)}] — ${m.meetingDate} — ${m.title}`);
    if (m.headingsText) parts.push(m.headingsText);
    if (m.otherMatters) parts.push(`  Other matters: ${m.otherMatters}`);
    if (m.rawFallback) parts.push(`  (raw transcript / notes excerpt)\n  ${m.rawFallback}`);
    return parts.join('\n');
  }).join('\n\n');

  const systemPrompt = `You are an expert UK audit assistant consolidating every communication on an audit engagement — Board Minutes, Audit Committee / TCWG, Shareholder meetings, client meetings, internal team meetings, and expert consultations — into a single position paper for the audit file.

The firm's Communications Overall headings (these are what the audit team want you to report against):
${headingsList}

Return ONLY valid JSON with this exact structure:
{
  "headings": {
    "Heading Name": {
      "content": "detailed consolidated position across ALL meetings for this heading — what the audit team needs to know",
      "flagged": false,
      "evidence": ["YYYY-MM-DD — short label of which meeting/what said", "..."]
    },
    ...
  },
  "overallNarrative": "3-6 sentence plain-English overall picture tying the headings together, pointing at the most significant matters and their audit implications"
}

Content requirements (IMPORTANT)
- Each heading's "content" must synthesise what was said across MULTIPLE meetings, not just quote one. Include names, dates, monetary amounts, percentages, decisions and their effect. 4-8 sentences or a bullet list when the evidence supports it; short honest paragraph when only briefly mentioned.
- "evidence" is an array of short references showing WHICH meetings contributed to the conclusion. Use the date plus a 3-8 word label of the meeting / what was said. 2-6 items is ideal.
- Set "flagged": true if the heading surfaces: material misstatement risk, going concern concerns, fraud indicators, significant litigation, regulatory investigation, covenant breaches, loss of key customer / supplier / personnel, control failures, related-party transactions, unusual or non-routine transactions, or post-balance-sheet events affecting the financial statements. When flagged, the content MUST explain the audit implication.
- If a heading has genuinely no relevant evidence in ANY meeting, set content to "" and evidence to [].
- Do not invent facts or dates. If something is only touched on briefly, say so — don't embellish.
- Write in professional UK audit language (ISA (UK), FRC, "those charged with governance", "material", "significant risk", "estimate", "judgement", etc.).

Return format
- Return ONLY the JSON object, no markdown fencing, no commentary before or after.`;

  const userMessage = `All Communications on this engagement (chronological):\n\n${meetingBlocks.slice(0, 55000)}`;

  const res = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 6000,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`AI communication overall failed: ${res.status} ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  let content = data.choices?.[0]?.message?.content?.trim() || '{}';
  content = content.replace(/^```json?\n?/, '').replace(/\n?```$/, '');

  try {
    const parsed = JSON.parse(content);
    const result: CommunicationOverallSummary = {
      headings: {},
      overallNarrative: typeof parsed.overallNarrative === 'string' ? parsed.overallNarrative : '',
    };
    for (const h of headings) {
      const entry = parsed.headings?.[h];
      const evidence = Array.isArray(entry?.evidence)
        ? entry.evidence.filter((e: unknown) => typeof e === 'string')
        : [];
      result.headings[h] = {
        content: typeof entry?.content === 'string' ? entry.content : '',
        flagged: entry?.flagged === true,
        evidence,
      };
    }
    return result;
  } catch {
    const fallback: CommunicationOverallSummary = { headings: {}, overallNarrative: content.slice(0, 500) };
    for (const h of headings) fallback.headings[h] = { content: '', flagged: false, evidence: [] };
    return fallback;
  }
}

/**
 * Identify matters carried forward from earlier periods.
 */
export async function identifyCarryForward(
  allExtractions: { meetingDate: string; headings: Record<string, { content: string; flagged: boolean }> }[],
  headings: string[],
): Promise<CarryForwardItem[]> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) throw new Error('TOGETHER_API_KEY not configured');

  const minutesSummaries = allExtractions
    .sort((a, b) => new Date(a.meetingDate).getTime() - new Date(b.meetingDate).getTime())
    .map(ext => {
      const lines = Object.entries(ext.headings)
        .filter(([, v]) => v.content)
        .map(([k, v]) => `  ${k}: ${v.content}`);
      return `Meeting ${ext.meetingDate}:\n${lines.join('\n')}`;
    })
    .join('\n\n');

  const systemPrompt = `You are an expert UK audit assistant. Analyse board minutes across multiple meetings and identify matters that recur or remain unresolved across meetings — these are "carry-forward" matters that the audit team needs to track.

Return ONLY valid JSON array:
[
  {
    "heading": "which heading category this falls under",
    "issue": "brief description of the matter",
    "firstMentionedDate": "YYYY-MM-DD",
    "latestMentionDate": "YYYY-MM-DD",
    "status": "recurring or unresolved or new"
  }
]

Rules:
- "recurring" = mentioned in 2+ meetings with no resolution
- "unresolved" = mentioned but explicitly noted as pending/ongoing
- "new" = only mentioned in most recent meeting, flagged for follow-up
- Return empty array if no carry-forward items found
- Return ONLY the JSON array, no markdown wrapping`;

  const res = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: minutesSummaries.slice(0, 30000) },
      ],
      max_tokens: 3000,
      temperature: 0.2,
    }),
  });

  if (!res.ok) throw new Error(`AI carry-forward analysis failed: ${res.status}`);

  const data = await res.json();
  let content = data.choices?.[0]?.message?.content?.trim() || '[]';
  content = content.replace(/^```json?\n?/, '').replace(/\n?```$/, '');

  try {
    return JSON.parse(content);
  } catch {
    return [];
  }
}
