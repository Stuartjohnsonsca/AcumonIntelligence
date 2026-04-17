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

    const systemPrompt = `You are a senior risk consultant with 25 years of experience writing frank board-level crisis debriefs for listed companies, regulators, and major professional services firms. Your reports are known for being specific, evidence-driven, uncomfortable when necessary, and actionable.

You do NOT produce generic advice. Every single point you make must reference SPECIFIC behaviour, words, or decisions observed in the transcript — quoting or paraphrasing. Abstract recommendations are unacceptable.

Respond ONLY with valid JSON — no markdown fences, no preamble, no explanation. Just the raw JSON object.`;

    const userPrompt = `SCENARIO: ${scenario.description}

CURVEBALLS INJECTED DURING SIMULATION: ${curveballs || 'None'}
${protocolNote}

FULL SIMULATION TRANSCRIPT:
${transcript}

YOUR TASK:

Produce a board-ready debrief that a chair or non-executive director would find genuinely useful. The participants in this simulation are senior leaders hand-picked for their ability to operate under pressure. Assess whether they actually demonstrated that ability, based on what they said and did.

Your analysis must:
- Cite specific quotes, decisions, or silences from the transcript — not generic commentary
- Identify things that WORKED as well as things that didn't
- Name specific individuals where relevant — not "the team" or "leadership"
- Separate symptoms from root causes
- Call out moments where the group got the right answer vs moments where groupthink, escalation avoidance, or information hoarding happened
- Identify decisions that WEREN'T made but should have been
- Assess whether information flowed or stalled — and who the bottlenecks were
- Flag where protocol was followed, adapted, or ignored — with judgement on whether that was correct
- Highlight exchanges where one leader challenged another effectively, and exchanges where challenge was missing
- Produce training recommendations that are specific to the person and the observed behaviour, not generic "improve communication" advice

Return a JSON object with exactly this structure (produce 3-6 items in each array where content justifies it):

{
  "overallRating": "RED|AMBER|GREEN",
  "ratingRationale": "2-3 sentences — specific to what actually happened, not generic",
  "executiveSummary": "4-6 sentences for the board. Frank, uncomfortable if warranted, evidence-based. Open with the headline finding, then the 2-3 decisions that shaped the outcome (good or bad), then the residual risk if this were a real event.",
  "planDeficiencies": [
    {"title": "short punchy title", "whatHappened": "cite specific moment/quote from the transcript", "impact": "what this means if it happened in reality — concrete not abstract"}
  ],
  "humanBehaviourInsights": [
    {"person": "name and role", "behaviourObserved": "quote or paraphrase their specific contributions — when they spoke, when they didn't, what they prioritised, who they challenged", "underPressurePattern": "the leadership pattern this reveals — with evidence", "trainingRecommendation": "specific development action for THIS person based on what was observed — not generic"}
  ],
  "curveballResponses": [
    {"curveball": "the developing situation", "howHandled": "cite who addressed it and how, or note if it was missed", "gap": "what should have happened that didn't, or what was handled well"}
  ],
  "protocolAdherence": "3-4 sentences assessing whether protocol was followed, where it was adapted correctly, and where it was ignored at cost — or if no protocol existed, what the group defaulted to and whether that was coherent",
  "boardReassurance": ["genuine positive finding with evidence from transcript", "second such finding", "third such finding if one exists"],
  "immediateActions": [
    {"priority": "HIGH|MEDIUM", "action": "specific, concrete action — not 'improve X'", "owner": "role that should own this"}
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
        max_tokens: 4000,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.4,
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
