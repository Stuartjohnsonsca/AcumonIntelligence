import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifySummaryJobAccess } from '@/lib/client-access';
import OpenAI from 'openai';

export const maxDuration = 30;

/**
 * Quick party extraction from the first uploaded file in a job.
 * Returns a list of party names found in the document.
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
      where: { jobId, status: { in: ['uploaded', 'analysed'] } },
      orderBy: { createdAt: 'asc' },
    });

    if (!file) {
      return NextResponse.json({ parties: [] });
    }

    // Download and extract text from the first few pages
    const { BlobServiceClient } = await import('@azure/storage-blob');
    const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connStr) {
      return NextResponse.json({ parties: [] });
    }

    const blobClient = BlobServiceClient.fromConnectionString(connStr);
    const containerClient = blobClient.getContainerClient(file.containerName);
    const blob = containerClient.getBlobClient(file.storagePath);
    const downloadResponse = await blob.download();
    const chunks: Buffer[] = [];
    for await (const chunk of downloadResponse.readableStreamBody as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    const pdfBuffer = Buffer.concat(chunks);

    // Extract text from PDF
    const { extractText } = await import('unpdf');
    const pdfData = new Uint8Array(pdfBuffer);
    const pdfResult = await extractText(pdfData);
    const textPages = Array.isArray(pdfResult.text) ? pdfResult.text : [String(pdfResult.text || '')];
    // Use first 3 pages or all text up to ~4000 chars
    const sampleText = textPages.slice(0, 3).join('\n').slice(0, 4000);

    if (sampleText.length < 20) {
      // Too short to extract parties (likely scanned PDF)
      return NextResponse.json({ parties: [], note: 'Document appears to be scanned — parties could not be auto-detected.' });
    }

    // Quick AI call to extract party names
    const apiKey = process.env.TOGETHER_DOC_SUMMARY_KEY || process.env.TOGETHER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ parties: [] });
    }

    const client = new OpenAI({ apiKey, baseURL: 'https://api.together.xyz/v1' });
    const result = await client.chat.completions.create({
      model: 'Qwen/Qwen3-235B-A22B',
      messages: [
        {
          role: 'user',
          content: `Extract ONLY the names of all parties (companies, individuals, or entities) that are parties to or mentioned as key stakeholders in this legal/commercial document. Return ONLY valid JSON: {"parties": ["Party A name", "Party B name", ...]}

Do NOT include law firms, agents, or witnesses — only actual parties to the agreement or transaction.

--- DOCUMENT TEXT (first pages) ---
${sampleText}`,
        },
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

    return NextResponse.json({ parties: [] });
  } catch (error) {
    console.error('[DocSummary:DetectParties] Error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ parties: [] });
  }
}
