import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

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
    const { transcript, curveballs, scenario, protocol, useProtocol } = await req.json();

    const protocolNote = (useProtocol && protocol?.trim())
      ? `\nThe organisation had the following protocol in place:\n${protocol}`
      : '\nNo formal protocol was provided for this exercise.';

    const systemPrompt = `You are a senior risk consultant producing a board-ready debrief. Respond ONLY with valid JSON — no markdown fences, no preamble, no explanation. Just the raw JSON object.`;

    const userPrompt = `Scenario: ${scenario.description}
Curveballs introduced: ${curveballs || 'None'}
${protocolNote}

Simulation transcript:
${transcript}

Analyse the HUMAN BEHAVIOUR shown — not theoretical best practice. Look at what people actually did, what they missed, where they helped, where they made things worse.

Return a JSON object with exactly this structure:
{
  "overallRating": "RED|AMBER|GREEN",
  "ratingRationale": "one sentence explaining the rating",
  "executiveSummary": "2-3 sentences for the board — frank, not reassuring",
  "planDeficiencies": [
    {"title": "...", "whatHappened": "specific behaviour observed in transcript", "impact": "what this means in a real event"}
  ],
  "humanBehaviourInsights": [
    {"person": "name + role", "behaviourObserved": "specific thing they did or said", "underPressurePattern": "what this reveals about how they behave in crisis", "trainingRecommendation": "specific, practical, not generic"}
  ],
  "curveballResponses": [
    {"curveball": "...", "howHandled": "...", "gap": "..."}
  ],
  "protocolAdherence": "how well did people follow protocol, or note if none existed",
  "boardReassurance": ["genuine positive finding 1", "genuine positive finding 2"],
  "immediateActions": [
    {"priority": "HIGH|MEDIUM", "action": "...", "owner": "role"}
  ]
}`;

    const response = await fetch(TOGETHER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Together API error:', err);
      return NextResponse.json({ error: 'AI service error' }, { status: 502 });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '{}';

    let debrief;
    try {
      debrief = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch {
      debrief = {
        overallRating: 'AMBER',
        ratingRationale: 'Analysis generated but could not be fully parsed.',
        executiveSummary: raw.substring(0, 300),
        planDeficiencies: [],
        humanBehaviourInsights: [],
        curveballResponses: [],
        protocolAdherence: 'Unable to assess.',
        boardReassurance: [],
        immediateActions: [],
      };
    }

    return NextResponse.json({ debrief });
  } catch (error) {
    console.error('Risk Forum debrief error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
