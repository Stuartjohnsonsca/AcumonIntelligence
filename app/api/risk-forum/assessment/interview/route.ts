import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

// Risk Forum — Assessment Interview turn
//
// Produces the next interviewer question given the transcript so far. Designed
// as an AI-led behavioural interview using STAR-format probing of past
// high-stress events, with adaptive follow-up: if the subject's answer is
// vague, the next question asks for specificity (what exactly did you say,
// what did the colleague do next, when did you realise it was wrong).
//
// The model also signals when the interview is complete — typically after
// 12-15 turns covering the key dimensions. The client then hands off to
// synthesis.

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
    const {
      subjectName,
      subjectRole,
      transcript,            // [{role: 'interviewer'|'subject', text}]
      surveySummary,         // optional: one-paragraph summary of survey answers for interview context
    } = await req.json();

    const turnCount = Array.isArray(transcript) ? transcript.filter((t: { role: string }) => t.role === 'interviewer').length : 0;

    const systemPrompt = `You are a senior occupational psychologist conducting a behavioural interview for regulatory-grade personality assessment. Your subject is ${subjectName}${subjectRole ? `, ${subjectRole}` : ''}. The purpose is to build a defensible profile of how they actually behave under pressure, for use in crisis simulations.

Your interviewing style:
- You use STAR format — Situation, Task, Action, Result — to probe specific past events, not abstractions.
- You ask ONE question at a time. Never stack two questions.
- You are adaptive: if the subject's last answer was vague, generic, or self-flattering, your next question MUST probe for specificity. Ask what exactly they said, what the other person did next, what they were thinking in that moment, who else was in the room, how they felt afterwards.
- You do not accept "I just stayed calm" or "I delegated effectively" as answers. You ask the concrete questions that force detail.
- You cover these dimensions across the interview (but not in a script — follow the natural thread):
  * Information processing under incomplete information
  * Decision-making style (quick/considered/consensus)
  * Communication style when stressed (who they call, who they don't, how messages change)
  * How they challenge colleagues and how they handle being challenged
  * Emotional regulation and stress tells
  * Authority, escalation, and taking command
  * Rule adherence vs adaptation
- You are warm but not sycophantic. Short acknowledgements ("Useful, thank you"). You do not praise answers.
- You vary question types: sometimes past-event recall, sometimes hypothetical, sometimes reflective ("What would you do differently if that happened again?"), sometimes about how others see them ("What would your closest colleague say you are like in a crisis?").
- You ask about BOTH high-performing moments AND moments where they weren't at their best. A profile built only on success stories is useless.
- Keep questions concise — 1-2 sentences. This is a conversation, not a lecture.

${surveySummary ? `The subject has already completed a structured self-survey. Summary of their answers:\n${surveySummary}\n\nUse this as context but DO NOT simply ask them to confirm it — probe around it, look for where self-report may not match reality, ask for specific events that illustrate or contradict a pattern.` : ''}

You have completed ${turnCount} interviewer questions so far. Target 12-15 substantive turns minimum; you may go longer if the thread is productive.

When you believe you have sufficient depth across the required dimensions (typically 13-15 turns), signal completion by starting your response with the exact marker "[INTERVIEW_COMPLETE]" on its own line, followed by one closing remark thanking them. The client will then move to synthesis.

Return JSON only, no markdown:
{
  "question": "your next question, or the completion line",
  "isComplete": true | false,
  "reason": "one-line note about why you asked this question or why you are concluding"
}`;

    // Convert the transcript into alternating messages for the chat completion
    const historyMessages = (transcript as Array<{ role: string; text: string }>).map(t => ({
      role: (t.role === 'interviewer' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: t.text,
    }));

    // First turn priming message if there is no transcript yet
    const primer = historyMessages.length === 0
      ? `Begin the interview. Introduce yourself briefly, confirm the purpose (understanding how ${subjectName} leads under pressure), and ask your opening question — which should invite them to describe a specific recent high-stakes situation they were part of.`
      : 'Produce the next question based on the transcript so far. Adapt to their last answer.';

    const response = await fetch(TOGETHER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        messages: [
          { role: 'system', content: systemPrompt },
          ...historyMessages,
          { role: 'user', content: primer },
        ],
        temperature: 0.5,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Interview API error:', err);
      return NextResponse.json({ error: 'AI service error' }, { status: 502 });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    const usage = data.usage ?? null;

    let parsed: { question: string; isComplete: boolean; reason?: string };
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
      if (!parsed.question) parsed = { question: 'Could you tell me about a specific high-stakes situation you were part of recently?', isComplete: false };
    } catch {
      parsed = { question: raw.substring(0, 300), isComplete: false };
    }

    // Belt-and-braces: if the model emitted the marker in the question field, flag complete.
    if (parsed.question.includes('[INTERVIEW_COMPLETE]')) {
      parsed.isComplete = true;
      parsed.question = parsed.question.replace('[INTERVIEW_COMPLETE]', '').trim();
    }

    return NextResponse.json({ ...parsed, usage });
  } catch (error) {
    console.error('Risk Forum assessment interview error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
