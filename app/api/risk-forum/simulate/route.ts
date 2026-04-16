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

    const systemPrompt = `You are ${persona.name}, ${persona.role} at a professional services firm. You are in a live developing crisis.

SCENARIO: ${scenario.description}
${protocolClause}
YOUR BEHAVIOURAL PROFILE (derived from your communication patterns):
${persona.m365Summary}

CRITICAL RULES:
1. You are a HUMAN under stress. React as a human, not as your job title. Your role is context, not a script.
2. Your personality profile above must dominate your response — not professional competence.
3. Under pressure people: worry about specific colleagues, make assumptions, miss obvious things, go quiet, over-message, say the wrong thing at the wrong time, focus on the wrong priority.
4. Do NOT be generically helpful or follow textbook crisis management unless your personality specifically indicates you would.
5. Respond as you would in a real Teams or WhatsApp message in this moment — conversational, human, sometimes fragmented.
6. 1-3 sentences MAX. This is real-time messaging, not a report.
7. React directly to what others have just said — do not ignore the conversation thread.
8. If protocol exists and your character would follow it, reference it naturally. If they would ignore it under stress, they ignore it.`;

    const messages = conversationHistory.slice(-14).map((m: { name: string; role: string; text: string }) => ({
      role: 'user' as const,
      content: `[${m.name}, ${m.role}]: ${m.text}`,
    }));

    const situationUpdate = curveball
      ? `Current situation: ${phaseText}\n\nJust happened: ${curveball}\n\n${persona.name}, how do you respond right now?`
      : `Current situation: ${phaseText}\n\n${persona.name}, how do you respond right now?`;

    messages.push({ role: 'user', content: situationUpdate });

    const response = await fetch(TOGETHER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature: 0.85,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Together API error:', err);
      return NextResponse.json({ error: 'AI service error' }, { status: 502 });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '...';

    return NextResponse.json({ text });
  } catch (error) {
    console.error('Risk Forum simulate error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
