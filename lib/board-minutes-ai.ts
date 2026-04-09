/**
 * AI-powered board minutes / TCWG extraction.
 * Extracts structured content from uploaded PDF text using firm-defined headings.
 */

export interface BoardMinutesExtraction {
  headings: Record<string, { content: string; flagged: boolean }>;
  otherMatters: string;
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
export async function extractBoardMinutes(
  documentText: string,
  headings: string[],
  documentType: 'board_minutes' | 'tcwg',
  meetingDate?: string,
): Promise<BoardMinutesExtraction> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) throw new Error('TOGETHER_API_KEY not configured');

  const headingsList = headings.map((h, i) => `${i + 1}. ${h}`).join('\n');
  const typeLabel = documentType === 'tcwg' ? 'Audit Committee / Those Charged With Governance (TCWG)' : 'Board Minutes';

  const systemPrompt = `You are an expert UK audit assistant. Given the text of ${typeLabel}, extract content relevant to each of the following headings. For each heading, provide a concise summary of what the minutes say about that topic. If a heading contains content that may be of audit significance (e.g. litigation, fraud indicators, going concern issues, material transactions), set "flagged" to true.

Headings to extract:
${headingsList}

Return ONLY valid JSON with this exact structure:
{
  "headings": {
    "Heading Name": { "content": "summary of what the minutes say about this topic", "flagged": false },
    ...
  },
  "otherMatters": "any significant matters not covered by the headings above"
}

Rules:
- Use professional audit terminology
- Be concise but capture all audit-relevant points
- If a heading has no relevant content in the document, set content to "" and flagged to false
- Flag any content that could indicate material misstatement risk, going concern, or fraud
- Return ONLY the JSON object, no markdown wrapping`;

  const userMessage = [
    meetingDate ? `Meeting Date: ${meetingDate}` : '',
    '',
    `${typeLabel} Text:`,
    documentText.slice(0, 40000),
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
      max_tokens: 4000,
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
    const result: BoardMinutesExtraction = { headings: {}, otherMatters: parsed.otherMatters || '' };
    for (const h of headings) {
      const entry = parsed.headings?.[h];
      result.headings[h] = {
        content: entry?.content || '',
        flagged: entry?.flagged === true,
      };
    }
    return result;
  } catch {
    const fallback: BoardMinutesExtraction = { headings: {}, otherMatters: content.slice(0, 500) };
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
  documentType: 'board_minutes' | 'tcwg',
): Promise<PeriodSummary> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) throw new Error('TOGETHER_API_KEY not configured');

  const typeLabel = documentType === 'tcwg' ? 'TCWG / Audit Committee' : 'Board Minutes';

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
