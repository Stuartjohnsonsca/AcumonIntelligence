import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

// POST /api/engagements/[engagementId]/rmm/ai-summary
// Generate AI summary of inherent risk sub-components for an RMM row
export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { rowId, complexityText, subjectivityText, changeText, uncertaintyText, susceptibilityText, lineItem } = body;

  // rowId may be empty for unsaved rows — that's OK, we just won't persist to DB

  // Build prompt from the 5 sub-components
  const components = [
    complexityText && `Complexity: ${complexityText}`,
    subjectivityText && `Subjectivity: ${subjectivityText}`,
    changeText && `Change: ${changeText}`,
    uncertaintyText && `Uncertainty: ${uncertaintyText}`,
    susceptibilityText && `Susceptibility: ${susceptibilityText}`,
  ].filter(Boolean).join('\n');

  if (!components) {
    return NextResponse.json({ error: 'No risk component text to summarise' }, { status: 400 });
  }

  try {
    const apiKey = process.env.TOGETHER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });
    }

    const response = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
        messages: [
          {
            role: 'system',
            content: 'You are an audit risk assessment assistant. Summarise the inherent risk assessment for the given line item based on the risk component assessments provided. Be concise (2-4 sentences), professional, and focus on the key risk drivers. Output only the summary text, no preamble.',
          },
          {
            role: 'user',
            content: `Line item: ${lineItem || 'Unknown'}\n\nInherent risk component assessments:\n${components}\n\nProvide a concise risk summation.`,
          },
        ],
        max_tokens: 300,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI API returned ${response.status}`);
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim() || '';

    // Update the RMM row with the AI summary (only if row is saved)
    if (rowId) {
      await prisma.auditRMMRow.update({
        where: { id: rowId },
        data: { aiSummary: summary, isAiEdited: false },
      });
    }

    return NextResponse.json({ summary });
  } catch (err) {
    console.error('AI summary generation failed:', err);
    return NextResponse.json({ error: 'Failed to generate summary' }, { status: 500 });
  }
}
