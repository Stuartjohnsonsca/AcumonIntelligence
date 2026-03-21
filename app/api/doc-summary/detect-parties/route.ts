import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifySummaryJobAccess } from '@/lib/client-access';
import OpenAI from 'openai';

export const maxDuration = 45;

const PARTY_PROMPT = `Extract ALL parties to this legal/commercial document. For each party, provide their name if available, or their role if no name is given.

Rules:
- Include BOTH named parties (e.g. "ABC Ltd", "John Smith") AND role-only parties (e.g. "the Tenant", "the Landlord", "the Borrower")
- If a party has both a name and a role, format as "Name (Role)" — e.g. "ABC Ltd (Tenant)"
- Do NOT include law firms, agents, witnesses, or signatories who are not parties
- Only include actual parties to the agreement or transaction

Return ONLY valid JSON: {"parties": ["Party A", "Party B", ...]}`;

/**
 * Party extraction from the first uploaded file in a job.
 * Priority: 1) stored extractedText (from OCR/analysis), 2) live text extraction, 3) wait message
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { jobId } = await req.json();
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  const jobAccess = await verifySummaryJobAccess(
    session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
    jobId,
  );
  if (!jobAccess.allowed) {
    return NextResponse.json({ error: jobAccess.reason || 'Forbidden' }, { status: 403 });
  }

  try {
    // Get the first uploaded file for the job
    const file = await prisma.docSummaryFile.findFirst({
      where: { jobId, status: { in: ['uploaded', 'processing', 'analysed'] } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        originalName: true,
        storagePath: true,
        containerName: true,
        status: true,
        extractedText: true,
      },
    });

    if (!file) {
      return NextResponse.json({ parties: [] });
    }

    const apiKey = process.env.TOGETHER_DOC_SUMMARY_KEY || process.env.TOGETHER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ parties: [] });
    }

    const client = new OpenAI({ apiKey, baseURL: 'https://api.together.xyz/v1' });
    let sampleText = '';

    // Priority 1: Use stored extracted text (available after worker processes the file, including OCR)
    if (file.extractedText && file.extractedText.length >= 20) {
      sampleText = file.extractedText.slice(0, 4000);
      console.log(`[DocSummary:DetectParties] Using stored extractedText (${file.extractedText.length} chars) for ${file.originalName}`);
    } else {
      // Priority 2: Try live text extraction from PDF
      try {
        const { BlobServiceClient } = await import('@azure/storage-blob');
        const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
        if (connStr) {
          const blobClient = BlobServiceClient.fromConnectionString(connStr);
          const containerClient = blobClient.getContainerClient(file.containerName);
          const blob = containerClient.getBlobClient(file.storagePath);
          const downloadResponse = await blob.download();
          const chunks: Buffer[] = [];
          for await (const chunk of downloadResponse.readableStreamBody as AsyncIterable<Buffer>) {
            chunks.push(chunk);
          }
          const pdfBuffer = Buffer.concat(chunks);

          const { extractText } = await import('unpdf');
          const pdfData = new Uint8Array(pdfBuffer);
          const pdfResult = await extractText(pdfData);
          const textPages = Array.isArray(pdfResult.text) ? pdfResult.text : [String(pdfResult.text || '')];
          sampleText = textPages.slice(0, 3).join('\n').slice(0, 4000);
        }
      } catch (err) {
        console.error('[DocSummary:DetectParties] PDF extraction error:', err instanceof Error ? err.message : err);
      }
    }

    // If we have enough text, detect parties via AI
    if (sampleText.length >= 20) {
      const result = await client.chat.completions.create({
        model: 'Qwen/Qwen3-235B-A22B',
        messages: [
          { role: 'user', content: `${PARTY_PROMPT}\n\n--- DOCUMENT TEXT ---\n${sampleText}` },
        ],
        max_tokens: 500,
        temperature: 0.1,
      });
      const content = result.choices?.[0]?.message?.content?.trim() || '';

      // Parse JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const parties: string[] = Array.isArray(parsed.parties) ? parsed.parties : [];
        return NextResponse.json({ parties, fileName: file.originalName });
      }
    }

    // Priority 3: Not enough text yet — scanned PDF still processing
    if (file.status === 'uploaded' || file.status === 'processing') {
      return NextResponse.json({
        parties: [],
        pending: true,
        note: 'This document appears to be scanned. Parties will be identified once OCR processing completes.',
      });
    }

    // Analysed but still no usable text — very unusual
    return NextResponse.json({
      parties: [],
      note: 'Could not identify parties from this document. Please enter the party name manually.',
    });
  } catch (error) {
    console.error('[DocSummary:DetectParties] Error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ parties: [] });
  }
}
