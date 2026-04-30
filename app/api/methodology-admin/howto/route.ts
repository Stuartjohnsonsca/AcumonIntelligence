import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { buildRegistryPrompt, sanitiseStepPlan } from '@/lib/howto/registry';

const MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  const currentUrl = typeof body?.currentUrl === 'string' ? body.currentUrl : '';
  if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 });
  if (question.length > 500) return NextResponse.json({ error: 'question too long' }, { status: 400 });

  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });

  const registry = buildRegistryPrompt();

  const systemPrompt = `You are a UI navigation coach for Acumon's audit methodology platform. The user asks "how do I X?" and you produce a short interactive walkthrough: a yellow dot points at the next element, the user clicks it themselves, and the tour advances when they do.

You can ONLY point at elements listed in the registry below. Do NOT invent element IDs.

Output format: respond with a JSON array of steps. No prose, no markdown, just JSON.
Each step has:
  - "page":      the page key (e.g. "performance-dashboard-admin")
  - "howtoId":   an element ID from the registry (e.g. "pa.tab.csfs")
  - "narration": an action instruction (max 180 chars).

How to write narrations — these are coaching instructions, not descriptions:
  - Start with a verb in second person: "Click", "Open", "Select", "Type in".
  - For interactive elements: "Click 'Add CSF' to open the form."
  - For section overviews: "This is where each pillar's score is shown — review and click anywhere to continue."
  - Tell the user *what to expect after the click* if it matters: "Click 'CSFs' to switch tabs — the CSF list will appear below."
  - Keep it short and direct. No hedging, no jargon.

Rules:
  - Output between 1 and 8 steps. Fewer is better.
  - The first step is normally on the page the user is currently on. If the answer requires a different page, the FIRST step should point at the navigation target that gets them there (e.g. the Performance Dashboard tile, or the "Manage data" button).
  - The tour is interactive — when the user clicks the highlighted element, the tour advances automatically. Plan steps assuming the user actually performs each action.
  - Do NOT include "Save"/"Delete"/"Submit" as a dot target. Stop one step before — at "fill in the form" or pointing at the form area — and let the user complete the action themselves.
  - If the question is unanswerable from the registry, return [].

REGISTRY:
${registry}

The user is currently at URL: ${currentUrl || '(unknown)'}

Return JSON only.`;

  let aiResponse: Response;
  try {
    aiResponse = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question },
        ],
        max_tokens: 800,
        temperature: 0.1,
      }),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'AI request failed' }, { status: 502 });
  }

  if (!aiResponse.ok) {
    const text = await aiResponse.text().catch(() => '');
    return NextResponse.json({ error: `AI error: ${aiResponse.status}`, detail: text.slice(0, 200) }, { status: 502 });
  }

  const aiData = await aiResponse.json();
  const content = aiData?.choices?.[0]?.message?.content || '[]';

  let parsed: unknown;
  try {
    const cleaned = String(content).replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    // Find the first '[' and last ']' to handle preamble/trailing chatter the
    // model occasionally emits despite instructions.
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start === -1 || end === -1) {
      parsed = [];
    } else {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    }
  } catch {
    parsed = [];
  }

  const steps = sanitiseStepPlan(parsed);
  return NextResponse.json({ steps });
}
