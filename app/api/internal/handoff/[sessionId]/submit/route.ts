// POST /api/internal/handoff/[sessionId]/submit
// Multipart: file=@archive.zip, fileName=..., mimeType=...
//
// Orchestrator submits the prior-period archive once it has finished
// downloading from the vendor. Persists as AuditDocument tagged Prior
// Period Archive, runs AI extraction, creates ImportExtractionProposal,
// and flips the session status to 'submitted' so the user's modal
// auto-advances to the Review pop-up.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { uploadToInbox } from '@/lib/azure-blob';
import { processPdf } from '@/lib/pdf-to-images';
import { aiExtractProposals } from '@/lib/import-options/ai-extractor';
import { verifyOrchestratorSecret } from '@/lib/import-options/internal-auth';
import { AI_POPULATE_EXCLUDED_TABS, type ImportOptionsState } from '@/lib/import-options/types';

const PRIOR_PERIOD_ARCHIVE_TAG = '__prior_period_archive__';
const ALLOWED_TAB_KEYS = [
  'opening', 'prior-period', 'permanent-file', 'ethics', 'continuance',
  'new-client', 'materiality', 'par', 'walkthroughs', 'documents',
  'outstanding', 'communication', 'tax-technical', 'subsequent-events',
];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  if (!verifyOrchestratorSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { sessionId } = await params;

  const handoff = await prisma.importHandoffSession.findUnique({ where: { id: sessionId } });
  if (!handoff) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (handoff.status !== 'pending') {
    return NextResponse.json({ error: `Session ${handoff.status}` }, { status: 409 });
  }

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const fileName = (formData.get('fileName') as string) || file?.name || 'prior-audit-file';
  const mimeType = (formData.get('mimeType') as string) || file?.type || 'application/octet-stream';
  if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) return NextResponse.json({ error: 'empty file' }, { status: 400 });
  if (buffer.length > 50 * 1024 * 1024) {
    return NextResponse.json({ error: 'file too large (max 50 MB)' }, { status: 413 });
  }

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: handoff.engagementId },
    select: { id: true, clientId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });

  await prisma.importHandoffSession.update({
    where: { id: sessionId },
    data: { progressStage: 'uploading', progressMessage: 'Uploading archive', progressAt: new Date() },
  });

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const blobName = `documents/${engagement.clientId}/${engagement.id}/${Date.now()}_orchestrator_${safeName}`;
  await uploadToInbox(blobName, buffer, mimeType);

  const archiveDoc = await prisma.auditDocument.create({
    data: {
      engagementId: engagement.id,
      documentName: `Prior Period Archive — ${handoff.vendorLabel} (server-driven import) — ${fileName}`,
      storagePath: blobName,
      uploadedDate: new Date(),
      uploadedById: handoff.createdById,
      fileSize: buffer.length,
      mimeType,
      receivedByName: `Acumon orchestrator (${handoff.vendorLabel})`,
      receivedAt: new Date(),
      mappedItems: [PRIOR_PERIOD_ARCHIVE_TAG],
      usageLocation: 'Prior Period',
      documentType: 'Prior Period Audit File',
      source: 'Third Party',
    },
  });

  await prisma.importHandoffSession.update({
    where: { id: sessionId },
    data: { progressStage: 'extracting', progressMessage: 'Running AI extraction…', progressAt: new Date() },
  });

  let textContent = '';
  if (mimeType.includes('pdf') || /\.pdf$/i.test(fileName)) {
    try {
      const pdf = await processPdf(buffer, 50);
      textContent = pdf.text || '';
    } catch (err) { console.warn('[orchestrator/submit] PDF text extract failed:', err); }
  }
  const allowedTabKeys = ALLOWED_TAB_KEYS.filter(k => !AI_POPULATE_EXCLUDED_TABS.has(k));
  let proposalId: string;
  try {
    const result = await aiExtractProposals({ textContent, allowedTabKeys });
    const proposal = await prisma.importExtractionProposal.create({
      data: {
        engagementId: engagement.id,
        sourceType: 'cloud',
        sourceLabel: `${handoff.vendorLabel} (server-driven) — ${fileName}`,
        sourceArchiveDocumentId: archiveDoc.id,
        proposals: result.proposals as unknown as object,
        aiModel: result.model,
        rawAiResponse: result.rawAiResponse?.slice(0, 50000),
        status: 'pending',
        createdById: handoff.createdById,
      },
    });
    proposalId = proposal.id;
  } catch (err) {
    console.warn('[orchestrator/submit] AI extraction failed:', err);
    const proposal = await prisma.importExtractionProposal.create({
      data: {
        engagementId: engagement.id,
        sourceType: 'cloud',
        sourceLabel: `${handoff.vendorLabel} (server-driven) — ${fileName}`,
        sourceArchiveDocumentId: archiveDoc.id,
        proposals: [],
        status: 'pending',
        createdById: handoff.createdById,
      },
    });
    proposalId = proposal.id;
  }

  const submittedAt = new Date();
  await prisma.importHandoffSession.update({
    where: { id: sessionId },
    data: {
      status: 'submitted',
      submittedAt,
      submittedDocumentId: archiveDoc.id,
      submittedExtractionId: proposalId,
      progressStage: 'submitted',
      progressMessage: 'Extraction complete. Ready for your review.',
      progressAt: submittedAt,
      // Defence-in-depth: nuke any leftover credentials.
      pendingPromptAnswer: undefined,
    },
  });

  // Mirror engagement.importOptions history.
  const eng = await prisma.auditEngagement.findUnique({
    where: { id: engagement.id },
    select: { importOptions: true },
  });
  const prev = (eng?.importOptions as ImportOptionsState | null) || null;
  const at = submittedAt.toISOString();
  const next: ImportOptionsState = {
    prompted: true,
    selections: prev?.selections || ['import_data'],
    source: { type: 'cloud', sourceFileDocumentId: archiveDoc.id, vendorLabel: handoff.vendorLabel },
    byUserId: prev?.byUserId || handoff.createdById,
    byUserName: prev?.byUserName,
    at,
    status: 'extracted',
    extractionId: proposalId,
    history: [
      ...(prev?.history || []),
      { event: 'cloud_fetched', at, note: `Acumon orchestrator (${handoff.vendorLabel}) — ${fileName}` },
      { event: 'extracted', at },
    ],
  };
  await prisma.auditEngagement.update({
    where: { id: engagement.id },
    data: { importOptions: next as unknown as object },
  });

  return NextResponse.json({
    ok: true,
    archiveDocumentId: archiveDoc.id,
    extractionId: proposalId,
  });
}
