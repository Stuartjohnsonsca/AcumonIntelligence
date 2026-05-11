import { NextRequest, NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import OpenAI from 'openai';
import JSZip from 'jszip';
import { downloadBlob } from '@/lib/azure-blob';
import { processPdf } from '@/lib/pdf-to-images';
import { prisma } from '@/lib/db';

const apiKey = process.env.TOGETHER_API_KEY || process.env.TOGETHER_DOC_SUMMARY_KEY || '';
const MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

// Rough char-to-token ratio; keep well within 128k context
const MAX_DOC_CHARS = 80_000;

// Pull every <Text>…</Text> body out of a Visio page XML. Visio
// stores shape labels in <Shape><Text>…</Text></Shape> with sub-tags
// (<cp/>, <pp/>) for formatting that we strip. Order is document-order,
// which is shape-creation-order, which is "close enough" to flow order
// for an LLM to reconstruct the process.
function extractVisioPageText(xml: string): string {
  const out: string[] = [];
  const textBlockRe = /<Text\b[^>]*>([\s\S]*?)<\/Text>/g;
  let m: RegExpExecArray | null;
  while ((m = textBlockRe.exec(xml)) !== null) {
    const inner = m[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (inner.length > 0) out.push(inner);
  }
  return out.join('\n');
}

// Pull labels out of any XML-based diagram format we recognise. Yanks
// value="…", name="…", label="…" attributes plus <name>…</name> /
// <label>…</label> bodies. Covers draw.io (mxCell @value), BPMN
// (@name on tasks/events/gateways), and most Lucidchart XML exports.
function extractDiagramLabels(xml: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const v = raw
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (v.length === 0) return;
    // Skip noise — single chars, pure-numeric ids, things that look
    // like IDs rather than labels.
    if (v.length < 2) return;
    if (/^[a-z0-9_-]+$/i.test(v) && v.length < 8) return;
    if (seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };
  for (const attr of ['value', 'name', 'label']) {
    const re = new RegExp(`\\b${attr}="([^"]+)"`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) push(m[1]);
  }
  for (const tag of ['name', 'label', 'documentation']) {
    const re = new RegExp(`<(?:[^>]*:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[^>]*:)?${tag}>`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) push(m[1]);
  }
  return out;
}

/**
 * POST /api/engagements/[engagementId]/walkthrough-flowchart
 * Takes process narrative + controls (and optionally evidence files) and generates a structured flowchart.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

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

  const { processKey, processLabel, narrative, controls, evidenceFiles, documentIds } = body;

  let documentText = narrative?.trim() || '';
  let extractedNarrative = '';
  const extractionErrors: string[] = [];

  // Resolve any `documentIds` (AuditDocument IDs, typically uploaded
  // via the per-tab TabDocumentsFooter) into the same {storagePath,
  // containerName, name, mimeType} shape the existing extractor
  // already understands. Keeps storage paths server-side and lets
  // the walkthrough flowchart pipeline ingest files attached via the
  // standard tab-documents flow without going via /api/walkthrough/upload.
  type FilePtr = { storagePath: string; containerName?: string | null; name: string; mimeType?: string | null };
  const resolvedFiles: FilePtr[] = [];

  if (Array.isArray(evidenceFiles)) {
    for (const f of evidenceFiles) {
      if (f?.storagePath && f?.name) {
        resolvedFiles.push({
          storagePath: f.storagePath,
          containerName: f.containerName ?? null,
          name: f.name,
          mimeType: f.mimeType ?? null,
        });
      }
    }
  }

  if (Array.isArray(documentIds) && documentIds.length > 0) {
    try {
      const docs = await prisma.auditDocument.findMany({
        where: { id: { in: documentIds }, engagementId },
        select: {
          id: true,
          documentName: true,
          storagePath: true,
          containerName: true,
          mimeType: true,
        },
      });
      for (const d of docs) {
        if (d.storagePath) {
          resolvedFiles.push({
            storagePath: d.storagePath,
            containerName: d.containerName ?? 'audit-documents',
            name: d.documentName,
            mimeType: d.mimeType,
          });
        }
      }
      const missingContent = documentIds.length - resolvedFiles.length;
      if (missingContent > 0 && docs.length < documentIds.length) {
        extractionErrors.push(`${documentIds.length - docs.length} document id(s) not found on this engagement`);
      }
    } catch (err: any) {
      extractionErrors.push(`Failed to resolve uploaded documents: ${err?.message || 'unknown error'}`);
    }
  }

  // If any files resolved (either path-based or id-based), extract
  // text from them.
  if (resolvedFiles.length > 0) {
    const extractedParts: string[] = [];

    for (const file of resolvedFiles) {
      try {
        const container = file.containerName || 'upload-inbox';
        console.log('[walkthrough-flowchart] Downloading:', file.name, file.storagePath, 'from', container);
        const buffer = await downloadBlob(file.storagePath, container);
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
        } else if (
          mime.includes('spreadsheet')
          || mime.includes('excel')
          || mime.includes('sheet')
          || file.name?.toLowerCase().endsWith('.xlsx')
          || file.name?.toLowerCase().endsWith('.xls')
          || file.name?.toLowerCase().endsWith('.xlsm')
        ) {
          // Excel — read every sheet as CSV-flavoured text so the AI
          // sees the data row-by-row in a flat form. Matches the
          // pattern in lib/assurance-doc-processor.ts.
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const XLSX = require('xlsx');
            const wb = XLSX.read(buffer, { type: 'buffer' });
            const sheetsText = wb.SheetNames
              .map((name: string) => {
                const sheet = wb.Sheets[name];
                const csv = XLSX.utils.sheet_to_csv(sheet);
                return csv && csv.trim().length > 0
                  ? `=== Sheet: ${name} ===\n${csv}`
                  : '';
              })
              .filter((s: string) => s.length > 0)
              .join('\n\n');
            if (sheetsText.trim().length > 10) {
              console.log('[walkthrough-flowchart] Extracted', sheetsText.length, 'chars from XLSX:', file.name);
              extractedParts.push(`--- ${file.name} ---\n${sheetsText}`);
            } else {
              extractionErrors.push(`${file.name}: XLSX had no extractable content`);
            }
          } catch (xlsErr: any) {
            console.error('[walkthrough-flowchart] XLSX parse failed for', file.name, xlsErr.message);
            extractionErrors.push(`${file.name}: failed to read XLSX — ${xlsErr.message}`);
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
        } else if (file.name?.toLowerCase().endsWith('.vsdx') || mime.includes('visio')) {
          // Visio .vsdx — ZIP container, one XML per page under visio/pages/.
          // We pull every text element so the AI sees shape labels in
          // their connector order (good enough for the LLM to infer flow
          // without us parsing the actual shape geometry).
          try {
            const zip = await JSZip.loadAsync(buffer);
            const pageNames = Object.keys(zip.files)
              .filter(k => /^visio\/pages\/page\d+\.xml$/i.test(k))
              .sort();
            const pageTexts: string[] = [];
            for (const pageName of pageNames) {
              const xml = await zip.file(pageName)?.async('string');
              if (!xml) continue;
              const text = extractVisioPageText(xml);
              if (text) pageTexts.push(`[Page: ${pageName.split('/').pop()}]\n${text}`);
            }
            const joined = pageTexts.join('\n\n');
            if (joined.length > 10) {
              console.log('[walkthrough-flowchart] Extracted', joined.length, 'chars from VSDX:', file.name);
              extractedParts.push(`--- ${file.name} (Visio) ---\n${joined}`);
            } else {
              extractionErrors.push(`${file.name}: Visio had no extractable text labels`);
            }
          } catch (vsdErr: any) {
            console.error('[walkthrough-flowchart] VSDX unzip failed for', file.name, vsdErr.message);
            extractionErrors.push(`${file.name}: failed to read Visio — ${vsdErr.message}`);
          }
        } else if (
          file.name?.toLowerCase().endsWith('.drawio')
          || file.name?.toLowerCase().endsWith('.xml')
          || file.name?.toLowerCase().endsWith('.bpmn')
        ) {
          // draw.io / Lucidchart-XML / BPMN. All XML. draw.io stores
          // shape labels in mxCell @value; BPMN uses @name on tasks/
          // events; we conservatively yank every value=, name=, label=
          // attribute and emit them in document order so the LLM gets a
          // node-by-node list that follows the flow.
          try {
            const xml = buffer.toString('utf-8');
            const labels = extractDiagramLabels(xml);
            if (labels.length > 0) {
              const text = labels.join('\n');
              console.log('[walkthrough-flowchart] Extracted', text.length, 'chars from diagram XML:', file.name);
              extractedParts.push(`--- ${file.name} (diagram XML) ---\n${text}`);
            } else {
              extractionErrors.push(`${file.name}: diagram XML had no shape labels`);
            }
          } catch (xmlErr: any) {
            extractionErrors.push(`${file.name}: failed to read diagram XML — ${xmlErr.message}`);
          }
        } else if (
          file.name?.toLowerCase().endsWith('.mmd')
          || file.name?.toLowerCase().endsWith('.mermaid')
          || file.name?.toLowerCase().endsWith('.puml')
          || file.name?.toLowerCase().endsWith('.plantuml')
          || file.name?.toLowerCase().endsWith('.dot')
          || file.name?.toLowerCase().endsWith('.gv')
        ) {
          // Mermaid / PlantUML / Graphviz — plain text already. The LLM
          // can read the DSL directly to follow the flow.
          const text = buffer.toString('utf-8').trim();
          if (text.length > 10) {
            console.log('[walkthrough-flowchart] Extracted', text.length, 'chars from diagram DSL:', file.name);
            extractedParts.push(`--- ${file.name} (diagram source) ---\n${text}`);
          } else {
            extractionErrors.push(`${file.name}: diagram source was empty`);
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

  // Extract-text-only mode — drives the auto-ingest on TabDocuments
  // footer upload: the client wants the file's text content pulled
  // into the active process's narrative without triggering a fresh
  // AI flowchart call. Skip the rest of the pipeline and return.
  if (body.action === 'extract_text') {
    return NextResponse.json({
      extractedNarrative: extractedNarrative || '',
      extractionErrors,
    });
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
- id: unique string (e.g. "step_1", "decision_1", "control_1")
- label: short description of the step (max 50 words) — must be derived from the provided text
- type: one of "start", "action", "decision", "end"
- next: array of step IDs this connects to
- condition: (only for decisions) the condition text from the documentation
- sourceDoc: (optional) the input document, form, or trigger for this step (e.g. "Purchase Order", "Customer Email")
- outputDoc: (optional) the document, report, or output produced by this step (e.g. "Invoice", "Approval Form")
- responsible: (optional) the person, role, or department responsible (e.g. "Accounts Payable Clerk", "Finance Manager")
- isSignificantControl: (boolean, optional) true ONLY for steps that represent a control (preventative, detective, manual review, system validation, segregation of duties, authorisation, reconciliation, etc.)

────────────────────────────────────────
ONE SHAPE PER CONTROL — MANDATORY
────────────────────────────────────────
Every control mentioned in the documentation OR listed in the "Controls identified" section MUST become its own dedicated flowchart shape with isSignificantControl: true. NEVER merge two controls into one shape, even when they happen at the same point in the process. Two controls = two shapes. Three controls = three shapes.

If a control is a decision (e.g. "approver checks the value is below £10,000"), use type: "decision" with the condition. If it is an action (e.g. "manager signs the invoice"), use type: "action". Either way, set isSignificantControl: true.

Example — documentation says: "When the invoice is received, the AP clerk matches it to the PO (Control A) and the Finance Manager approves invoices over £5,000 (Control B), then it is posted." This must produce THREE shapes for the control area:
  1. action "AP clerk matches invoice to PO" (isSignificantControl: true, responsible "AP Clerk")
  2. decision "Finance Manager approves" with condition "Invoice value > £5,000" (isSignificantControl: true, responsible "Finance Manager")
  3. action "Post invoice to ledger" (regular action, not a control)

NOT one combined shape "match invoice and approve". NOT a merged "Controls A and B" step.

────────────────────────────────────────

Other rules:
- Always start with exactly one "start" step
- Always end with at least one "end" step
- Decisions must have 2+ next steps with conditions
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

${controlsText ? `Controls identified (${(controls || []).length} total — each must have its own flowchart shape with isSignificantControl: true):\n${controlsText}\n\nReminder: produce at least ${(controls || []).length} shape(s) marked isSignificantControl: true. Do NOT combine any of these controls into a single step.\n` : ''}

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
