// AI proposal extractor for the Import Options pop-up. Given the raw
// text or JSON payload of a prior audit file, asks the LLM to suggest
// destination tab/field mappings as ProposalRow[]. Returns ONLY what
// the LLM extracted — no fabrication. If the LLM gives nothing, we
// return an empty array and the user sees "no rows" in the Review pop-up.

import type { ProposalRow } from './types';

interface ExtractInput {
  /** Plain-text dump of the prior audit file (PDF text, TXT, etc.). */
  textContent?: string;
  /** Already-structured JSON pulled via a cloud connector. */
  structured?: unknown;
  /** Tab keys we are willing to populate. RMM / TB are excluded by callers. */
  allowedTabKeys: string[];
}

export interface ExtractResult {
  proposals: ProposalRow[];
  rawAiResponse?: string;
  model?: string;
}

const SYSTEM_PROMPT = `You are extracting prior-period audit data so it can be used to seed the
current audit engagement. Read the supplied prior-period material and
produce a list of proposed values to populate fields on the current
engagement's tabs.

Rules:
- Output ONLY valid JSON: { "proposals": [...] }. No prose, no markdown.
- Each proposal item shape:
  {
    "id": "<unique short id>",
    "destination": { "kind": "json_blob" | "row_table",
                     "tabKey": "<one of the allowed tab keys>",
                     "sectionKey"?: "<section identifier when known>",
                     "fieldKey"?: "<field identifier>",
                     "rowId"?: "<row identifier for tabular tabs>",
                     "column"?: "<column name for tabular tabs>" },
    "fieldLabel": "<human readable destination label>",
    "sourceLocation": "<where in the source the value came from, e.g. 'Ethics > Independence > Q3'>",
    "proposedValue": "<the extracted value — string, number, boolean, or null>"
  }
- Use ONLY tabKey values from the allowed list provided. Skip any data
  whose target tab is not in the list.
- If you don't know a sectionKey or fieldKey for sure, leave it out
  (rather than guess). The applier will skip rows that lack a target.
- DO NOT fabricate values. If a field is blank in the source, skip it.
- Keep proposedValue concise — full paragraphs only when the source
  itself is a paragraph.`;

export async function aiExtractProposals(input: ExtractInput): Promise<ExtractResult> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    // No AI key — return empty proposals rather than fabricating. The
    // caller surfaces the empty Review pop-up; nothing is hallucinated.
    return { proposals: [], rawAiResponse: '', model: 'no-key' };
  }

  const userMessage = [
    `Allowed tab keys: ${input.allowedTabKeys.join(', ')}`,
    '',
    input.textContent
      ? ['Source (plain text):', input.textContent.slice(0, 60000)].join('\n')
      : '',
    input.structured
      ? ['Source (JSON):', JSON.stringify(input.structured).slice(0, 60000)].join('\n')
      : '',
  ].filter(Boolean).join('\n\n');

  const model = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
  const res = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 6000,
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`AI extraction failed: ${res.status} ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  let content: string = data.choices?.[0]?.message?.content?.trim() || '{"proposals":[]}';
  content = content.replace(/^```json?\n?/, '').replace(/\n?```$/, '');

  let proposals: ProposalRow[] = [];
  try {
    const parsed = JSON.parse(content) as { proposals?: ProposalRow[] };
    if (Array.isArray(parsed.proposals)) {
      proposals = parsed.proposals
        .filter(p => p && p.destination && input.allowedTabKeys.includes(p.destination.tabKey))
        .map((p, i) => ({
          id: p.id || `p_${i}_${Math.random().toString(36).slice(2, 8)}`,
          destination: p.destination,
          fieldLabel: p.fieldLabel || p.destination.fieldKey || '(unlabelled)',
          sourceLocation: p.sourceLocation || '',
          proposedValue: p.proposedValue ?? null,
          deleted: false,
        }));
    }
  } catch {
    // LLM produced unparseable output — return empty (don't hallucinate).
    proposals = [];
  }
  return { proposals, rawAiResponse: content, model };
}
