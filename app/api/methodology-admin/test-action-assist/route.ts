import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import OpenAI from 'openai';

function getClient() {
  const key = process.env.TOGETHER_DOC_SUMMARY_KEY || process.env.TOGETHER_API_KEY;
  if (!key) throw new Error('No Together AI key configured');
  return new OpenAI({ apiKey: key, baseURL: 'https://api.together.xyz/v1' });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { actionType, description, knownInputs } = await req.json();

  if (!description?.trim()) {
    return NextResponse.json({ error: 'Description is required' }, { status: 400 });
  }

  const actionLabel = actionType === 'ai_action' ? 'AI' : actionType === 'client_action' ? 'Client' : 'Team';

  const systemPrompt = `You are a UK statutory audit methodology expert helping configure test action execution definitions.

The user will describe what a test action should do. You must suggest:
1. The INPUT keys needed (from the known list below)
2. A SYSTEM INSTRUCTION (the AI's role/context)
3. A PROMPT TEMPLATE (the actual task with {{input.<key>}} placeholders)

KNOWN INPUTS (use these exact keys):
${knownInputs.join('\n')}

You can also use these template placeholders in prompts:
{{test.description}} - Test description
{{test.fsLine}} - FS line being tested
{{test.assertion}} - Assertion being tested
{{engagement.clientName}} - Client name
{{engagement.periodEnd}} - Period end date
{{engagement.materiality}} - Overall materiality
{{engagement.performanceMateriality}} - Performance materiality
{{engagement.clearlyTrivial}} - Clearly trivial threshold
{{loop.currentItem}} - Current item in a For-Each loop
{{loop.index}} - Loop iteration index

IMPORTANT RULES:
- For AI actions: suggest systemInstruction AND promptTemplate
- For Client actions: suggest systemInstruction as the request message template
- For Team actions: suggest systemInstruction as instructions for the team member
- Always pick inputs from the KNOWN INPUTS list where possible
- Use {{input.<key>}} in the prompt to reference inputs
- Be specific to UK statutory audit (ISA UK standards)
- Reference specific figures and show working in prompts

Respond ONLY with valid JSON in this exact format:
{
  "inputs": [{ "key": "...", "label": "..." }],
  "systemInstruction": "...",
  "promptTemplate": "..."
}`;

  try {
    const client = getClient();
    const response = await client.chat.completions.create({
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Action Type: ${actionLabel}\n\nDescription: ${description}` },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });

    const text = response.choices[0]?.message?.content || '';

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Could not parse AI response' }, { status: 500 });
    }

    const result = JSON.parse(jsonMatch[0]);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'AI request failed' }, { status: 500 });
  }
}
