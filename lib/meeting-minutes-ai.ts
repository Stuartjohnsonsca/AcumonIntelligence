/**
 * AI-powered meeting minutes extraction.
 * Takes a transcript or meeting notes and extracts structured minutes.
 */

export interface MeetingMinutes {
  summary: string;
  agenda: string[];
  decisions: { decision: string; madeBy: string }[];
  actionItems: { action: string; assignedTo: string; deadline: string | null }[];
  issues: { issue: string; raisedBy: string; status: 'open' | 'resolved' }[];
  keyDiscussions: { topic: string; points: string[] }[];
  nextSteps: string[];
  /**
   * Preparer-authored free-form grid. The AI never produces this field;
   * it's populated manually in MeetingsPanel via the BespokeSpreadsheet.
   */
  custom?: { title?: string; rows: string[][]; columns: string[] };
}

const SYSTEM_PROMPT = `You are an expert meeting minutes writer for a UK audit firm. Given a meeting transcript or notes, extract structured minutes.

Return ONLY valid JSON with this exact structure:
{
  "summary": "2-3 sentence overview of the meeting",
  "agenda": ["topic 1", "topic 2"],
  "decisions": [{"decision": "what was decided", "madeBy": "who decided"}],
  "actionItems": [{"action": "what needs to be done", "assignedTo": "who", "deadline": "date or null"}],
  "issues": [{"issue": "the issue", "raisedBy": "who raised it", "status": "open or resolved"}],
  "keyDiscussions": [{"topic": "topic name", "points": ["key point 1", "key point 2"]}],
  "nextSteps": ["next step 1", "next step 2"]
}

Rules:
- Be concise but capture all important points
- Use professional audit terminology where appropriate
- If a field has no items, use an empty array
- For "madeBy"/"assignedTo"/"raisedBy", use the person's name from the transcript
- If you cannot determine who, use "Team" or "Not specified"
- Deadlines should be in DD/MM/YYYY format if specific, or descriptive ("next week", "before fieldwork") if approximate
- Return ONLY the JSON object, no markdown wrapping`;

/**
 * Extract structured meeting minutes from transcript text using Together API.
 */
export async function extractMeetingMinutes(
  transcript: string,
  meetingTitle?: string,
  meetingDate?: string
): Promise<MeetingMinutes> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) throw new Error('TOGETHER_API_KEY not configured');

  const userMessage = [
    meetingTitle ? `Meeting: ${meetingTitle}` : '',
    meetingDate ? `Date: ${meetingDate}` : '',
    '',
    'Transcript / Notes:',
    transcript.slice(0, 12000), // Limit to ~12k chars for context window
  ].filter(Boolean).join('\n');

  const res = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 3000,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`AI minutes extraction failed: ${res.status} ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  let content = data.choices?.[0]?.message?.content?.trim() || '{}';

  // Strip markdown wrapping if present
  content = content.replace(/^```json?\n?/, '').replace(/\n?```$/, '');

  try {
    const parsed = JSON.parse(content);
    return {
      summary: parsed.summary || '',
      agenda: parsed.agenda || [],
      decisions: parsed.decisions || [],
      actionItems: parsed.actionItems || [],
      issues: parsed.issues || [],
      keyDiscussions: parsed.keyDiscussions || [],
      nextSteps: parsed.nextSteps || [],
    };
  } catch {
    // Fallback: return basic structure with the raw response as summary
    return {
      summary: content.slice(0, 500),
      agenda: [],
      decisions: [],
      actionItems: [],
      issues: [],
      keyDiscussions: [],
      nextSteps: [],
    };
  }
}
