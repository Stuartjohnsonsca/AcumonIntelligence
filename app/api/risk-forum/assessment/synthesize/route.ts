import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

// Risk Forum — Assessment Synthesis
//
// Takes structured survey answers and an interview transcript, produces:
//   - A distilled behavioural summary suitable for direct use as a simulation
//     persona profile (compatible with the existing m365Summary shape).
//   - Decomposed attributes, each with source citations showing which
//     survey item or interview quote drove the conclusion.
//   - Per-dimension narrative notes (information processing, decision style,
//     communication under stress, interpersonal dynamics, emotional
//     regulation, authority/escalation, rule adherence).
//
// The output is structured JSON so the client can render it with evidence
// trails, which is what distinguishes this from a generic personality
// paragraph.

const TOGETHER_API_URL = 'https://api.together.xyz/v1/chat/completions';
const MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'AI service not configured' }, { status: 500 });
  }

  try {
    const {
      subjectName,
      subjectRole,
      surveyAnswers,         // { likert: {q_id: 1..5}, forcedChoice: {q_id: 'a'|'b'...} }
      surveyQuestionText,    // { q_id: "question text" } — so model can cite by text, not id
      interviewTranscript,   // [{role, text}]
    } = await req.json();

    const surveyBlock = Object.entries(surveyAnswers.likert ?? {}).map(([qid, v]) => {
      const text = surveyQuestionText?.[qid] ?? qid;
      return `- [LIKERT ${qid}] "${text}" → answered ${v}/5`;
    }).concat(Object.entries(surveyAnswers.forcedChoice ?? {}).map(([qid, v]) => {
      const text = surveyQuestionText?.[qid] ?? qid;
      return `- [CHOICE ${qid}] "${text}" → chose option "${v}"`;
    })).join('\n');

    const interviewBlock = (interviewTranscript as Array<{ role: string; text: string }>)
      .map(t => `${t.role === 'interviewer' ? 'Q' : 'A'}: ${t.text}`)
      .join('\n\n');

    const systemPrompt = `You are a senior occupational psychologist synthesising a behavioural profile from two evidence sources: a structured self-survey and a behavioural interview transcript. Your output is regulator-grade and will be used to construct a virtual agent that behaves like this person under pressure in a crisis simulation.

Your synthesis principles:
- NEVER produce generic trait statements. Every attribute you surface must be grounded in specific evidence (a survey answer and/or an interview quote).
- When self-report contradicts interview behaviour, favour interview evidence and note the discrepancy.
- Do not assume more than the evidence supports. "low" confidence is acceptable when only one source speaks to something.
- Produce a behavioural summary that reads like the existing simulation persona format — observation-oriented, 6-10 sentences, describing how this person behaves, communicates, and reacts under pressure. NOT a list of traits.
- Do not produce recommendations or advice. This is an observational profile.
- Avoid psychological jargon; describe patterns in plain language.

Return ONLY valid JSON. No markdown fences. Structure:

{
  "behaviouralSummary": "6-10 sentence paragraph written in observational prose, matching the style of existing simulation profiles — describes communication patterns, stress responses, decision-making tendencies, interpersonal style, and behavioural blind spots. Use third person.",
  "attributes": [
    {
      "statement": "short behavioural trait statement, e.g. 'Hesitates on irreversible decisions'",
      "confidence": "high" | "medium" | "low",
      "citations": [
        {
          "source": "survey" | "interview",
          "reference": "question id OR short interview quote",
          "evidence": "why this source supports the statement"
        }
      ]
    }
  ],
  "dimensionNotes": {
    "information_processing": "1-2 sentence narrative on how they process information under pressure, with specifics from evidence",
    "decision_style": "...",
    "communication_under_stress": "...",
    "interpersonal_dynamics": "...",
    "emotional_regulation": "...",
    "authority_escalation": "...",
    "rule_adherence": "..."
  }
}

Produce 6-10 attributes. Not every dimension needs multiple attributes; depth matters more than coverage.`;

    const userPrompt = `SUBJECT: ${subjectName}${subjectRole ? ` (${subjectRole})` : ''}

=== STRUCTURED SURVEY ANSWERS ===
${surveyBlock || '(no survey answers provided)'}

=== INTERVIEW TRANSCRIPT ===
${interviewBlock || '(no interview transcript provided)'}

Synthesise the profile now. Return JSON only.`;

    const response = await fetch(TOGETHER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2500,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Synthesis API error:', err);
      return NextResponse.json({ error: 'AI service error' }, { status: 502 });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    const usage = data.usage ?? null;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch {
      return NextResponse.json({ error: 'Synthesis output could not be parsed', raw, usage }, { status: 502 });
    }

    return NextResponse.json({ profile: parsed, usage });
  } catch (error) {
    console.error('Risk Forum assessment synthesize error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
