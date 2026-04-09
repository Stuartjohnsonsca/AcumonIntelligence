import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import OpenAI from 'openai';
import { downloadBlob } from '@/lib/azure-blob';
import { processPdf } from '@/lib/pdf-to-images';

const apiKey = process.env.TOGETHER_API_KEY || process.env.TOGETHER_DOC_SUMMARY_KEY || '';
const MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

/**
 * POST /api/engagements/[engagementId]/walkthrough-flowchart
 * Takes process narrative + controls (and optionally evidence files) and generates a structured flowchart.
 * When evidenceFiles are provided, downloads them from Azure Blob, extracts text, and uses that for generation.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { processKey, processLabel, narrative, controls, evidenceFiles } = await req.json();

  let documentText = narrative?.trim() || '';
  let extractedNarrative = '';

  // If evidence files provided, extract text from them
  if (evidenceFiles && Array.isArray(evidenceFiles) && evidenceFiles.length > 0) {
    const extractedParts: string[] = [];

    for (const file of evidenceFiles) {
      try {
        const buffer = await downloadBlob(file.storagePath, 'upload-inbox');
        const mime = (file.mimeType || '').toLowerCase();

        if (mime.includes('pdf')) {
          const result = await processPdf(buffer, 20);
          if (result.mode === 'text' && result.text) {
            extractedParts.push(`--- ${file.name} ---\n${result.text}`);
          }
        } else if (mime.includes('text') || mime.includes('csv')) {
          extractedParts.push(`--- ${file.name} ---\n${buffer.toString('utf-8')}`);
        } else if (mime.includes('word') || mime.includes('docx')) {
          // Try basic text extraction from docx
          try {
            const text = buffer.toString('utf-8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            if (text.length > 50) extractedParts.push(`--- ${file.name} ---\n${text}`);
          } catch {}
        }
        // Images (jpg, png) — skip text extraction, they'd need vision model
      } catch (err: any) {
        console.error(`[walkthrough-flowchart] Failed to extract ${file.name}:`, err.message);
      }
    }

    if (extractedParts.length > 0) {
      extractedNarrative = extractedParts.join('\n\n');
      documentText = documentText
        ? `${documentText}\n\n--- Extracted from client documents ---\n${extractedNarrative}`
        : extractedNarrative;
    }
  }

  if (!documentText) {
    return NextResponse.json({ error: 'No documentation available. Please provide a narrative or upload documents with extractable text.' }, { status: 400 });
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

Documentation:
${documentText}

${controlsText ? `Controls identified:\n${controlsText}` : ''}

Generate a structured flowchart for this process.`,
        },
      ],
      max_tokens: 4096,
      temperature: 0.2,
    });

    const responseText = completion.choices[0]?.message?.content || '';
    let jsonStr = responseText.trim();
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```json?\n?/, '').replace(/\n?```$/, '');

    const steps = JSON.parse(jsonStr);

    if (!Array.isArray(steps) || steps.length === 0) {
      return NextResponse.json({ error: 'Invalid flowchart generated' }, { status: 500 });
    }

    return NextResponse.json({ steps, processKey, extractedNarrative: extractedNarrative || undefined });
  } catch (err: any) {
    console.error('[walkthrough-flowchart] AI generation failed:', err.message);
    return NextResponse.json({ error: 'Failed to generate flowchart: ' + err.message }, { status: 500 });
  }
}
