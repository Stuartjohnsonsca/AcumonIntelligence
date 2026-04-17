import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

// Orchestrator — a supervisory LLM call that reads the transcript across all
// active threads and decides structural actions to take:
//   - spawn_breakout: pull named participants into a sidebar on a named topic
//   - summon_external: bring a role-based external persona into the main room
//   - conclude_breakout: end a sub-thread; a named participant reports back
//   - advance_time: jump the simulated clock forward to the next beat
//   - none: do nothing; conversation continues
//
// The orchestrator is intentionally separate from persona responses. Agents
// speak in character and make suggestions ("let's step out with Priya");
// the orchestrator reads the room and enacts the structural change.

const TOGETHER_API_URL = 'https://api.together.xyz/v1/chat/completions';
const MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

interface OrchestratorAction {
  type: 'spawn_breakout' | 'summon_external' | 'conclude_breakout' | 'advance_time' | 'none';
  participants?: string[];        // persona ids for breakout or summary author
  topic?: string;                 // purpose of breakout
  threadName?: string;            // display name for a spawned breakout
  benchId?: string;               // external persona id when summoning
  calledBy?: string;              // persona id who requested the external
  threadId?: string;              // existing thread to conclude
  summarizer?: string;            // persona id who will post summary
  summary?: string;               // summary text to post into main
  reason?: string;                // freeform — for debrief audit trail
}

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
      threadsTranscript,    // array of { threadId, threadName, status, recentMessages: [{name, role, text}] }
      availablePersonas,    // array of { id, name, role } currently in main
      availableExternals,   // array of { id, name, role, summonTriggers }
      activeBreakoutIds,    // array of breakout thread ids currently running
      scenarioDescription,  // for context
      simulatedClockLabel,  // e.g. "T+3h 14min"
    } = await req.json();

    // Build a compact transcript view for the orchestrator
    const transcriptBlock = threadsTranscript.map((t: {
      threadId: string; threadName: string; status: string;
      recentMessages: { name: string; role: string; text: string }[];
    }) => {
      const msgs = t.recentMessages
        .map(m => `  [${m.name} · ${m.role}]: ${m.text}`)
        .join('\n');
      return `=== THREAD "${t.threadName}" (${t.status}, id:${t.threadId}) ===\n${msgs || '  (no messages yet)'}`;
    }).join('\n\n');

    const personaList = availablePersonas.map((p: { id: string; name: string; role: string }) =>
      `  ${p.id}: ${p.name} (${p.role})`
    ).join('\n');

    const externalList = availableExternals.map((e: { id: string; name: string; role: string; summonTriggers: string[] }) =>
      `  ${e.id}: ${e.name} (${e.role}) — typical triggers: ${e.summonTriggers.join(', ')}`
    ).join('\n');

    const systemPrompt = `You are the supervisory orchestrator for a live crisis simulation between multiple leadership agents. Your job is to read the ongoing conversation across all threads and decide whether a structural change should happen NOW based on what people have just said.

You do NOT write what people say. Agents speak for themselves. You only decide structural actions.

Return ONLY a valid JSON object. No markdown, no preamble.

The structural actions available to you:

1. "spawn_breakout" — When two or more agents in the room have AGREED they need to step out for a sub-conversation (e.g. "Marcus, let's talk through the technical side", "Priya and I will draft the holding statement"). Requires at least two specific named participants from the main room and a clear topic. Do NOT spawn if people are just ruminating aloud — there must be explicit intent to pull out.

2. "summon_external" — When an agent has explicitly named or requested an external role (e.g. "get General Counsel on this", "we need to call our cyber IR firm", "I'll phone the bank"). Match to the closest bench id by role. Do NOT summon speculatively — it must be an action someone has clearly said they are taking or want taken.

3. "conclude_breakout" — When an active breakout thread has reached a natural conclusion: a decision reached, a path agreed, or the conversation has visibly wound down. A named participant from the breakout posts a summary back to main. Only conclude breakouts that have had at least 4-5 messages. If no one in the breakout committed to report back, you may still conclude it, but note in "reason" that the summary-back was not formally agreed (this matters for the debrief).

4. "advance_time" — When a natural pause has been reached and the conversation across all threads is waiting for the next beat of the scenario. Use sparingly.

5. "none" — Most of the time. The conversation should keep flowing. Only take structural action when the transcript specifically warrants it.

Return this JSON shape:
{
  "actions": [
    {
      "type": "spawn_breakout" | "summon_external" | "conclude_breakout" | "advance_time" | "none",
      "participants": ["persona_id_1", "persona_id_2"],  // for spawn_breakout
      "topic": "short description",                       // for spawn_breakout
      "threadName": "e.g. Technical Breakout",            // for spawn_breakout
      "benchId": "ext-counsel",                           // for summon_external
      "calledBy": "persona_id",                           // for summon_external
      "threadId": "thread_id_to_close",                   // for conclude_breakout
      "summarizer": "persona_id",                         // for conclude_breakout
      "summary": "short summary they post back to main",  // for conclude_breakout
      "reason": "why you took this action — audit trail"
    }
  ]
}

Return AT MOST ONE action per call. If nothing should happen, return {"actions": [{"type": "none", "reason": "conversation flowing naturally"}]}.`;

    const userPrompt = `SCENARIO: ${scenarioDescription}
CURRENT SIM TIME: ${simulatedClockLabel}

PARTICIPANTS IN MAIN ROOM (ids and roles):
${personaList}

EXTERNAL BENCH AVAILABLE TO SUMMON:
${externalList}

ACTIVE BREAKOUT THREAD IDS: ${activeBreakoutIds.length > 0 ? activeBreakoutIds.join(', ') : 'none'}

CONVERSATION ACROSS ALL THREADS (most recent messages):

${transcriptBlock}

Read the transcript carefully. What structural action (if any) should happen NOW based on what has just been said? Return JSON.`;

    const response = await fetch(TOGETHER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Orchestrator Together API error:', err);
      return NextResponse.json({ actions: [{ type: 'none', reason: 'orchestrator unavailable' }] });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    const usage = data.usage ?? null;

    let parsed: { actions: OrchestratorAction[] };
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
      if (!Array.isArray(parsed.actions)) parsed = { actions: [{ type: 'none', reason: 'invalid shape' }] };
    } catch {
      parsed = { actions: [{ type: 'none', reason: 'unparseable orchestrator response' }] };
    }

    return NextResponse.json({ ...parsed, usage });
  } catch (error) {
    console.error('Risk Forum orchestrate error:', error);
    return NextResponse.json({ actions: [{ type: 'none', reason: 'orchestrator error' }] });
  }
}
