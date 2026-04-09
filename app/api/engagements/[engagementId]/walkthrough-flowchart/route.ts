import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import OpenAI from 'openai';
import JSZip from 'jszip';
import { downloadBlob } from '@/lib/azure-blob';
import { processPdf } from '@/lib/pdf-to-images';

const apiKey = process.env.TOGETHER_API_KEY || process.env.TOGETHER_DOC_SUMMARY_KEY || '';
const MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

// Rough char-to-token ratio; keep well within 128k context
const MAX_DOC_CHARS = 80_000;

/**
 * POST /api/engagements/[engagementId]/walkthrough-flowchart
 * Takes process narrative + controls (and optionally evidence files) and generates a structured flowchart.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();

  // Handle transcript summarisation action
  if (body.action === 'summarise_transcript') {
    const { transcript, processLabel: procLabel } = body;
    if (!transcript) return NextResponse.json({ error: 'transcript required' }, { status: 400 });

    const client = new OpenAI({ apiKey, baseURL: 'https://api.together.xyz/v1' });
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: `You are an audit process analyst. Extract a structured business process description from this walkthrough call transcript. Focus on: how transactions are initiated, what authorisation is required, how they are recorded, what reconciliations are performed, and what systems are used. Write it as a clear, numbered process narrative suitable for generating a flowchart. Use only information explicitly discussed in the call.` },
          { role: 'user', content: `Process: ${procLabel || 'Business Process'}\n\nTranscript:\n${transcript.substring(0, 15000)}` },
        ],
        max_tokens: 2048,
        temperature: 0.2,
      });
      const narrative = completion.choices[0]?.message?.content?.trim() || '';
      return NextResponse.json({ narrative });
    } catch (err: any) {
      return NextResponse.json({ error: 'Summarisation failed: ' + err.message }, { status: 500 });
    }
  }

  const { processKey, processLabel, narrative, controls, evidenceFiles } = body;

  let documentText = narrative?.trim() || '';
  let extractedNarrative = '';
  const extractionErrors: string[] = [];

  // If evidence files provided, extract text from them
  if (evidenceFiles && Array.isArray(evidenceFiles) && evidenceFiles.length > 0) {
    const extractedParts: string[] = [];

    for (const file of evidenceFiles) {
      try {
        console.log('[walkthrough-flowchart] Downloading:', file.name, file.storagePath);
        const buffer = await downloadBlob(file.storagePath, 'upload-inbox');
        const mime = (file.mimeType || file.name || '').toLowerCase();

        if (mime.includes('pdf') || file.name?.toLowerCase().endsWith('.pdf')) {
          const result = await processPdf(buffer, 20);
          if (result.mode === 'text' && result.text) {
            console.log('[walkthrough-flowchart] Extracted', result.text.length, 'chars from PDF:', file.name);
            extractedParts.push(`--- ${file.name} (${result.pageCount} pages) ---\n${result.text}`);
          } else {
            extractionErrors.push(`${file.name}: PDF had no extractable text`);
          }
        } else if (mime.includes('text') || mime.includes('csv') || file.name?.toLowerCase().endsWith('.txt') || file.name?.toLowerCase().endsWith('.csv')) {
          const text = buffer.toString('utf-8').trim();
          if (text.length > 10) {
            extractedParts.push(`--- ${file.name} ---\n${text}`);
          }
        } else if (mime.includes('word') || mime.includes('docx') || file.name?.toLowerCase().endsWith('.docx') || file.name?.toLowerCase().endsWith('.doc')) {
          // DOCX files are ZIP archives — extract word/document.xml and pull text from <w:t> tags
          try {
            const zip = await JSZip.loadAsync(buffer);
            const docXml = await zip.file('word/document.xml')?.async('string');
            if (docXml) {
              const wMatches = docXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
              if (wMatches && wMatches.length > 0) {
                const text = wMatches.map(m => m.replace(/<[^>]+>/g, '')).join(' ').trim();
                if (text.length > 20) {
                  console.log('[walkthrough-flowchart] Extracted', text.length, 'chars from DOCX:', file.name);
                  extractedParts.push(`--- ${file.name} ---\n${text}`);
                } else {
                  extractionErrors.push(`${file.name}: DOCX had minimal extractable text`);
                }
              } else {
                extractionErrors.push(`${file.name}: no text content found in DOCX`);
              }
            } else {
              extractionErrors.push(`${file.name}: could not find document.xml in DOCX`);
            }
          } catch (zipErr: any) {
            console.error('[walkthrough-flowchart] DOCX unzip failed for', file.name, zipErr.message);
            extractionErrors.push(`${file.name}: failed to read DOCX — ${zipErr.message}`);
          }
        } else {
          extractionErrors.push(`${file.name}: unsupported file type (${mime})`);
        }
      } catch (err: any) {
        console.error(`[walkthrough-flowchart] Failed to extract ${file.name}:`, err.message);
        extractionErrors.push(`${file.name}: ${err.message}`);
      }
    }

    if (extractedParts.length > 0) {
      extractedNarrative = extractedParts.join('\n\n');
      // Truncate if too long for model context
      if (extractedNarrative.length > MAX_DOC_CHARS) {
        console.log('[walkthrough-flowchart] Truncating extracted text from', extractedNarrative.length, 'to', MAX_DOC_CHARS);
        extractedNarrative = extractedNarrative.substring(0, MAX_DOC_CHARS) + '\n\n[... truncated for length ...]';
      }
      documentText = documentText
        ? `${documentText}\n\n--- Extracted from client documents ---\n${extractedNarrative}`
        : extractedNarrative;
    }
  }

  if (!documentText) {
    const reason = extractionErrors.length > 0
      ? `Could not extract text from the selected files:\n${extractionErrors.join('\n')}`
      : 'No documentation available. Please provide a narrative or upload documents with extractable text.';
    return NextResponse.json({ error: reason }, { status: 400 });
  }

  console.log('[walkthrough-flowchart] Total document text:', documentText.length, 'chars');

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

Return ONLY a valid JSON array of steps (no markdown, no explanation, no preamble). Each step has:
- id: unique string (e.g. "step_1", "decision_1")
- label: short description of the step (max 50 words) — must be derived from the provided text
- type: one of "start", "action", "decision", "end"
- next: array of step IDs this connects to
- condition: (only for decisions) the condition text from the documentation
- sourceDoc: (optional) the input document, form, or trigger for this step (e.g. "Purchase Order", "Customer Email")
- outputDoc: (optional) the document, report, or output produced by this step (e.g. "Invoice", "Approval Form")
- responsible: (optional) the person, role, or department responsible (e.g. "Accounts Payable Clerk", "Finance Manager")

Rules:
- Always start with exactly one "start" step
- Always end with at least one "end" step
- Decisions must have 2+ next steps with conditions
- Include controls as actions where they occur in the process
- ONLY include steps that are described in the client documentation
- If the documentation is vague, include only what is explicitly stated
- Extract sourceDoc, outputDoc, and responsible where mentioned in the documentation
- Return ONLY the JSON array — no text before or after it`,
        },
        {
          role: 'user',
          content: `Process: ${processLabel}

Documentation:
${documentText}

${controlsText ? `Controls identified:\n${controlsText}` : ''}

Generate a structured flowchart JSON array for this process.`,
        },
      ],
      max_tokens: 4096,
      temperature: 0.2,
    });

    const responseText = completion.choices[0]?.message?.content || '';
    console.log('[walkthrough-flowchart] AI response length:', responseText.length, 'first 200 chars:', responseText.substring(0, 200));

    let jsonStr = responseText.trim();
    // Strip markdown code fences
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    // Strip any leading text before the JSON array
    const arrayStart = jsonStr.indexOf('[');
    const arrayEnd = jsonStr.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      jsonStr = jsonStr.substring(arrayStart, arrayEnd + 1);
    }

    let steps: any[];
    try {
      steps = JSON.parse(jsonStr);
    } catch (parseErr: any) {
      console.error('[walkthrough-flowchart] JSON parse failed:', parseErr.message, 'Raw response:', responseText.substring(0, 500));
      return NextResponse.json({
        error: `AI returned invalid JSON. This can happen with very large documents. Try selecting fewer files.`,
        extractionErrors: extractionErrors.length > 0 ? extractionErrors : undefined,
      }, { status: 500 });
    }

    if (!Array.isArray(steps) || steps.length === 0) {
      console.error('[walkthrough-flowchart] Empty or non-array result:', typeof steps);
      return NextResponse.json({
        error: 'AI could not generate a flowchart from the provided documents. The content may not describe a clear process. Try selecting specific process documentation files.',
        extractionErrors: extractionErrors.length > 0 ? extractionErrors : undefined,
      }, { status: 500 });
    }

    console.log('[walkthrough-flowchart] Generated flowchart with', steps.length, 'steps');

    return NextResponse.json({
      steps,
      processKey,
      extractedNarrative: extractedNarrative || undefined,
      extractionErrors: extractionErrors.length > 0 ? extractionErrors : undefined,
    });
  } catch (err: any) {
    console.error('[walkthrough-flowchart] AI generation failed:', err.message);
    return NextResponse.json({ error: 'Failed to generate flowchart: ' + err.message }, { status: 500 });
  }
}
