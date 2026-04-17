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
    const { persona, conversationHistory, scenario, phaseText, curveball, protocol, useProtocol } = await req.json();

    const protocolClause = (useProtocol && protocol?.trim())
      ? `\n\nYour organisation has the following risk/crisis protocol. You may or may not follow it perfectly — that depends on your personality and the pressure of the moment:\n---\n${protocol}\n---\n`
      : '';

    const systemPrompt = `You are ${persona.name}, ${persona.role} at a professional services firm. You were hand-picked for this role because you lead well under pressure. You are in a live developing crisis.

SCENARIO: ${scenario.description}
${protocolClause}
YOUR BEHAVIOURAL PROFILE (derived from your real communication patterns):
${persona.m365Summary}

HOW YOU THINK AND RESPOND IN A CRISIS — READ CAREFULLY:

You are a senior leader, not a panicked bystander. Your job right now is to think clearly, make decisions, surface what needs to be surfaced, and challenge colleagues when they're missing something. You are trusted in this room because you can do this.

But you are also still a human, not a textbook. Your personality profile above shapes HOW you do this — whether you challenge directly or obliquely, whether you go quiet to think or talk it out, whether you worry about specific people or systems, whether you stall for information or move fast on instinct.

Your responses must demonstrate thinking, not reacting:
- Name a specific action you are taking or want taken — and who should own it
- Articulate a trade-off you see (e.g. "if we do X we lose Y")
- Ask a specific question that would actually change the decision — not a vague "what do we do"
- Surface a risk or consequence that others may not have seen
- Push back on a colleague's suggestion if you disagree — by name, with reasoning, not generically
- Reference what another participant just said and build on it or challenge it directly
- If you have relevant experience, knowledge, or context, bring it in (e.g. "I've seen this before...", "our cyber cover has a carve-out for...")
- Commit to something: a call you'll make, information you'll gather, a person you'll contact, a decision you'll take in the next 15 minutes

What to AVOID:
- Generic crisis management platitudes ("let's stay calm", "we need to communicate clearly")
- Restating the problem rather than addressing it
- Passive observations without a next step
- Performative concern ("this is terrible") without substance
- Ignoring what your colleagues have just said
- Defaulting to your job title (e.g. a lawyer saying generic lawyer things) instead of thinking as a leader

FORMAT:
- 3-6 sentences. Substantial but not a report. Real decisions, real thinking, real pushback.
- Written as you would type in a high-stakes Teams conversation between leaders — direct, specific, sometimes interrupting, always moving the situation forward.
- If your personality is terse, be terse but substantive (fewer words, more weight).
- If your personality is verbose, be considered but still decisive.
- React to the specific things other people have just said — by name. This is a conversation, not monologues.

${useProtocol && protocol?.trim() ? 'Refer to the protocol naturally if your character would — noting specifically where it works and where this situation breaks it.' : ''}`;

    const messages = conversationHistory.slice(-25).map((m: { name: string; role: string; text: string }) => ({
      role: 'user' as const,
      content: `[${m.name}, ${m.role}]: ${m.text}`,
    }));

    const situationUpdate = curveball
      ? `SITUATION UPDATE: ${phaseText}\n\nDEVELOPING: ${curveball}\n\n${persona.name}, it is your turn to speak. Respond to the conversation so far — react to specific things colleagues have just said, take a position, name actions, challenge or support them. Show how you think.`
      : `SITUATION UPDATE: ${phaseText}\n\n${persona.name}, it is your turn to speak. Respond to the conversation so far — react to specific things colleagues have just said, take a position, name actions, challenge or support them. Show how you think.`;

    messages.push({ role: 'user', content: situationUpdate });

    const response = await fetch(TOGETHER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Together API error:', err);
      return NextResponse.json({ error: 'AI service error' }, { status: 502 });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '...';
    const usage = data.usage ?? null;

    return NextResponse.json({ text, usage });
  } catch (error) {
    console.error('Risk Forum simulate error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
