import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { buildRegistryPrompt, sanitiseStepPlan, HOWTO_ELEMENTS, HOWTO_PAGES } from '@/lib/howto/registry';

const MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  const currentUrl = typeof body?.currentUrl === 'string' ? body.currentUrl : '';
  const visibleHowtoIds: string[] = Array.isArray(body?.visibleHowtoIds)
    ? body.visibleHowtoIds.filter((s: unknown): s is string => typeof s === 'string')
    : [];
  if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 });
  if (question.length > 500) return NextResponse.json({ error: 'question too long' }, { status: 400 });

  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });

  // ── Situational awareness — what is on screen RIGHT NOW ────────────
  // The single biggest planning failure mode is the model assuming the
  // user is at the site root and walking them all the way through. We
  // counter that by:
  //   1. Naming the page the user is on (resolved from currentUrl or
  //      from any visible page-body element they sent us).
  //   2. Listing the data-howto-ids actually visible on screen, so the
  //      model can prefer them as starting points.
  // The model is then explicitly told to start from these whenever it
  // reasonably can.
  const registry = buildRegistryPrompt();

  // Resolve "current page" — first try URL match, then fall back to
  // checking which registry page contains a visible element.
  let currentPageKey: string | null = null;
  let currentPageTitle: string | null = null;
  for (const [key, page] of Object.entries(HOWTO_PAGES)) {
    if (page.url === currentUrl) { currentPageKey = key; currentPageTitle = page.title; break; }
  }
  if (!currentPageKey && visibleHowtoIds.length > 0) {
    const pageVotes = new Map<string, number>();
    for (const id of visibleHowtoIds) {
      const el = HOWTO_ELEMENTS[id];
      if (!el) continue;
      if (el.page === 'global') continue; // navbar — present everywhere, doesn't help
      pageVotes.set(el.page, (pageVotes.get(el.page) || 0) + 1);
    }
    if (pageVotes.size > 0) {
      const winner = [...pageVotes.entries()].sort((a, b) => b[1] - a[1])[0][0];
      currentPageKey = winner;
      currentPageTitle = HOWTO_PAGES[winner]?.title || null;
    }
  }

  // Filter to only registered, known visible IDs
  const knownVisibleIds = visibleHowtoIds.filter((id) => HOWTO_ELEMENTS[id]);

  const visibleSection = knownVisibleIds.length > 0
    ? `\n\nELEMENTS CURRENTLY VISIBLE ON THE USER'S SCREEN (right now):\n${knownVisibleIds.map((id) => `  - ${id} — ${HOWTO_ELEMENTS[id].description}`).join('\n')}`
    : '\n\n(No registered elements currently visible — the user may be on a page outside the registry.)';

  const systemPrompt = `You are a UI navigation coach for Acumon's audit methodology platform. The user asks "how do I X?" and you produce a short interactive walkthrough: a yellow dot points at the next element, the user clicks it themselves, and the tour advances when they do.

You can ONLY point at elements listed in the registry below. Do NOT invent element IDs.

CONTEXT — WHERE THE USER IS RIGHT NOW
  Current URL: ${currentUrl || '(unknown)'}
  Resolved page: ${currentPageTitle ? `${currentPageTitle} (key: ${currentPageKey})` : '(could not resolve)'}
${visibleSection}

CRITICAL: START FROM WHERE THEY ARE.
  - If the answer can be reached from the user's current screen, your FIRST step MUST point at one of the elements currently visible (listed above). Do NOT walk them back to a hub page or the navbar if a more direct path exists.
  - If the user is already on the right screen for the answer, give a single short step pointing at the relevant element on that screen — not a multi-step tour from the start.
  - Only use the navbar / hub-tile elements if the user is genuinely not in the right area yet AND no in-page navigation exists.

OUTPUT FORMAT — JSON array, no prose, no markdown.
Each step:
  - "page":      page key (e.g. "performance-dashboard-admin")
  - "howtoId":   an element ID from the registry (must exist exactly)
  - "narration": coaching instruction, max 180 chars, second person, action-led

NARRATION STYLE — concrete, action-led, specific:
  - "Click 'Add CSF' to open the form."
  - "Open the AI Reliance tab — you'll see Tool registry, Usage log and Validation tests sub-tabs."
  - For non-clickable section pointers: "This is the CSFs list — find the row you want and click its Edit link."

RULES:
  - 1–6 steps. Fewer is better — if the user is already where they need to be, ONE step is correct.
  - Never include destructive actions (Save / Delete / Submit) as a dot target. Stop one step before; the user completes the action themselves.
  - If the question is genuinely unanswerable from the registry, return [].
  - Engagement-workspace elements (page key 'engagement', any 'eng.*' id) require the user to already be inside an engagement. If they're not, route them through Sessions in the navbar or explain they need to open a client/period first.
  - Pages with url '*' (global, engagement) live "wherever the user already is" — DO NOT assume they need to navigate.

REGISTRY (all known pages and elements):
${registry}

Return JSON only — start with [ and end with ].`;

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
  const rawContent = String(aiData?.choices?.[0]?.message?.content || '');

  let parsed: unknown;
  let parseError: string | null = null;
  try {
    const cleaned = rawContent.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    // Find the first '[' and last ']' to handle preamble/trailing chatter
    // the model occasionally emits despite instructions.
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start === -1 || end === -1) {
      parsed = [];
      parseError = 'no JSON array in response';
    } else {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    }
  } catch (e) {
    parsed = [];
    parseError = e instanceof Error ? e.message : 'JSON parse failed';
  }

  const steps = sanitiseStepPlan(parsed);

  // If we got nothing back, return a debug hint so the client can show
  // a more useful error than just "no walkthrough." Don't leak the raw
  // model output (could include user PII) — just a category.
  if (steps.length === 0) {
    let debug: string;
    if (parseError) debug = `model output didn't parse: ${parseError}`;
    else if (Array.isArray(parsed) && parsed.length === 0) debug = 'model returned empty plan — question may not match any registered screens';
    else debug = `model returned ${Array.isArray(parsed) ? parsed.length : 0} steps but none were valid (unknown IDs or page mismatches)`;
    return NextResponse.json({ steps: [], debug });
  }

  return NextResponse.json({ steps });
}
