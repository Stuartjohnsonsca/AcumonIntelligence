import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import OpenAI from 'openai';

const apiKey = process.env.TOGETHER_API_KEY || process.env.TOGETHER_DOC_SUMMARY_KEY || '';
const MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

/**
 * POST /api/engagements/[engagementId]/walkthrough-flowchart
 * Takes process narrative + controls and generates a structured flowchart
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { processKey, processLabel, narrative, controls } = await req.json();

  if (!narrative?.trim()) {
    return NextResponse.json({ error: 'Client-provided process documentation is required before generating a flowchart. The narrative must contain information received from the client.' }, { status: 400 });
  }

  const controlsText = (controls || []).map((c: any, i: number) =>
    `${i + 1}. ${c.description} (${c.type}, ${c.frequency})`
  ).join('\n');

  const client = new OpenAI({ apiKey, baseURL: 'https://api.together.xyz/v1' });

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: `You are an audit process analyst. You are given client-provided documentation describing a business process and its controls. Your job is to EXTRACT and structure the described process into a flowchart.

CRITICAL: You must ONLY use information explicitly stated in the client's documentation. Do NOT invent, assume, or fabricate any steps, controls, or details that are not in the provided text. If the documentation is insufficient, return fewer steps rather than making things up.

Return ONLY a JSON array of steps. Each step has:
- id: unique string (e.g. "step_1", "decision_1")
- label: short description of the step (max 50 words) — must be derived from the provided text
- type: one of "start", "action", "decision", "end"
- next: array of step IDs this connects to
- condition: (only for decisions) the condition text from the documentation

Rules:
- Always start with exactly one "start" step
- Always end with at least one "end" step
- Decisions must have 2+ next steps with conditions
- Include controls as actions where they occur in the process
- ONLY include steps that are described in the client documentation
- If the documentation is vague, include only what is explicitly stated
- Return ONLY the JSON array, no other text`,
        },
        {
          role: 'user',
          content: `Process: ${processLabel}

Narrative:
${narrative}

${controlsText ? `Controls identified:\n${controlsText}` : ''}

Generate a structured flowchart for this process.`,
        },
      ],
      max_tokens: 2048,
      temperature: 0.2,
    });

    const responseText = completion.choices[0]?.message?.content || '';
    let jsonStr = responseText.trim();
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```json?\n?/, '').replace(/\n?```$/, '');

    const steps = JSON.parse(jsonStr);

    // Validate structure
    if (!Array.isArray(steps) || steps.length === 0) {
      return NextResponse.json({ error: 'Invalid flowchart generated' }, { status: 500 });
    }

    return NextResponse.json({ steps, processKey });
  } catch (err: any) {
    console.error('[walkthrough-flowchart] AI generation failed:', err.message);
    return NextResponse.json({ error: 'Failed to generate flowchart: ' + err.message }, { status: 500 });
  }
}
