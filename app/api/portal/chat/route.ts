import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const apiKey = process.env.TOGETHER_API_KEY || '';

/**
 * POST /api/portal/chat
 * Service chatbot endpoint + meeting booking.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Meeting booking action
    if (body.action === 'book_meeting') {
      console.log('[Portal Meeting Request]', {
        serviceType: body.serviceType,
        name: body.name,
        email: body.email,
        message: body.message,
        preferredDate: body.preferredDate,
        chatSummary: body.chatSummary?.slice(0, 500),
      });
      return NextResponse.json({ success: true, message: 'Meeting request sent' });
    }

    // Chat completion
    const { systemPrompt, messages } = body;
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages required' }, { status: 400 });
    }

    if (!apiKey) {
      return NextResponse.json({ error: 'AI service not configured' }, { status: 500 });
    }

    const client = new OpenAI({ apiKey, baseURL: 'https://api.together.xyz/v1' });

    const response = await client.chat.completions.create({
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt || 'You are a helpful professional services assistant.' },
        ...messages.map((m: { role: string; content: string }) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ],
    });

    const text = response.choices?.[0]?.message?.content || 'No response generated.';

    return NextResponse.json({ response: text });
  } catch (error) {
    console.error('Portal chat error:', error);
    return NextResponse.json({ error: 'Chat failed' }, { status: 500 });
  }
}
