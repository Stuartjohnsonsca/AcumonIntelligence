import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

const TOGETHER_KEY = process.env.TOGETHER_API_KEY || '';
const AI_MODEL = 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8';

const SYSTEM_PROMPT = `You are a Dynamics 365 / Dataverse OData filter expert helping an auditing firm configure their client import filter.

The user will describe what clients they want to import in natural language. Your job is to:
1. Understand their intent
2. Ask clarifying questions if the intent is ambiguous
3. Generate the correct OData $filter expression for the Dataverse "accounts" entity

Available Dataverse account fields:
- name (string) - account/company name
- statecode (int) - 0=Active, 1=Inactive
- address1_city (string)
- address1_stateorprovince (string)
- address1_country (string)
- industrycode (int) - industry classification
- telephone1 (string)
- emailaddress1 (string)
- sic (string) - SIC code
- customertypecode (int) - relationship type
- accountcategorycode (int) - category

Available OData filter operators:
- eq, ne, gt, lt, ge, le
- contains(field,'value'), startswith(field,'value'), endswith(field,'value')
- and, or, not
- statecode eq 0 (active accounts)

When you have enough information, respond with a JSON block containing the filter:
\`\`\`json
{"filter": "your OData filter here", "description": "human readable description"}
\`\`\`

If you need more information, just ask the question naturally. Do NOT include the JSON block until you're confident about the filter.

Important:
- Always include "statecode eq 0" to exclude inactive accounts unless user specifically wants inactive ones
- Keep filters simple and correct
- Explain what the filter will do before providing it`;

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isFirmAdmin && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { messages } = body as { messages: Message[] };

  if (!messages || !Array.isArray(messages)) {
    return NextResponse.json({ error: 'messages array required' }, { status: 400 });
  }

  try {
    const aiMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages,
    ];

    const res = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOGETHER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: aiMessages,
        max_tokens: 500,
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      throw new Error(`AI API error: ${res.status}`);
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content || 'I couldn\'t process that. Could you try rephrasing?';

    // Check if reply contains a JSON filter block
    let compiledFilter: { filter: string; description: string } | null = null;
    const jsonMatch = reply.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);
    if (jsonMatch) {
      try {
        compiledFilter = JSON.parse(jsonMatch[1]);
      } catch { /* not valid JSON */ }
    }

    return NextResponse.json({
      reply,
      compiledFilter,
    });
  } catch (err: any) {
    console.error('Filter interpreter error:', err);
    return NextResponse.json({ error: err.message || 'AI interpretation failed' }, { status: 500 });
  }
}
