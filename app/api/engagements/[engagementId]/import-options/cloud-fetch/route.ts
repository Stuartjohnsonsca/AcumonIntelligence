import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { uploadToInbox } from '@/lib/azure-blob';
import { processPdf } from '@/lib/pdf-to-images';
import { aiExtractProposals } from '@/lib/import-options/ai-extractor';
import { fetchPriorAuditFile, type CloudFetchCredentials, CloudConnectorError } from '@/lib/import-options/cloud-fetch';
import {
  AI_POPULATE_EXCLUDED_TABS,
  type CloudConnectorConfig,
  type ImportOptionsState,
  type ImportSelection,
} from '@/lib/import-options/types';

const PRIOR_PERIOD_ARCHIVE_TAG = '__prior_period_archive__';

const ALLOWED_TAB_KEYS = [
  'opening', 'prior-period', 'permanent-file', 'ethics', 'continuance',
  'new-client', 'materiality', 'par', 'walkthroughs', 'documents',
  'outstanding', 'communication', 'tax-technical', 'subsequent-events',
];

// POST /api/engagements/[id]/import-options/cloud-fetch
export async function POST(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: {
      id: true, firmId: true, clientId: true, periodId: true, importOptions: true,
      client: { select: { clientName: true } },
      period: { select: { endDate: true } },
    },
  });
  if (!engagement || engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({})) as {
    connectorId?: string;
    credentials?: CloudFetchCredentials;
    selections?: ImportSelection[];
  };
  const connectorId = body.connectorId || '';
  const selections = body.selections || [];

  const connector = await prisma.cloudAuditConnector.findUnique({ where: { id: connectorId } });
  if (!connector || connector.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Connector not found' }, { status: 404 });
  }

  const config = connector.config as unknown as CloudConnectorConfig;
  let archiveDocId: string | undefined;
  let textContent = '';
  let structuredData: unknown;
  try {
    const result = await fetchPriorAuditFile(config, body.credentials || {}, {
      clientName: engagement.client?.clientName,
      periodEnd: engagement.period?.endDate?.toISOString().slice(0, 10),
      engagementId: engagement.id,
    });
    if (result.archiveBytes) {
      const buf = Buffer.from(result.archiveBytes);
      const ext = (result.archiveContentType || '').includes('pdf') ? 'pdf' : 'zip';
      const fileName = `${result.archiveSuggestedFileName || 'cloud-archive'}.${ext}`;
      const blobName = `documents/${engagement.clientId}/${engagementId}/${Date.now()}_cloud_${fileName}`;
      await uploadToInbox(blobName, buf, result.archiveContentType || 'application/octet-stream');
      const archiveDoc = await prisma.auditDocument.create({
        data: {
          engagementId,
          documentName: `Prior Period Archive — ${connector.label} (${fileName})`,
          storagePath: blobName,
          uploadedDate: new Date(),
          uploadedById: session.user.id,
          fileSize: buf.length,
          mimeType: result.archiveContentType || null,
          receivedByName: connector.label,
          receivedAt: new Date(),
          mappedItems: [PRIOR_PERIOD_ARCHIVE_TAG],
          usageLocation: 'Prior Period',
          documentType: 'Prior Period Audit File',
          source: 'Third Party',
        },
      });
      archiveDocId = archiveDoc.id;
      if (ext === 'pdf') {
        try {
          const pdf = await processPdf(buf, 50);
          textContent = pdf.text || '';
        } catch (err) {
          console.warn('[cloud-fetch] PDF text extraction failed:', err);
        }
      }
    }
    if (result.data) structuredData = result.data;
  } catch (err) {
    if (err instanceof CloudConnectorError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 502 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloud fetch failed' }, { status: 502 });
  }

  // AI extraction off whatever we got. Falls back to empty proposals
  // gracefully — see ai-extractor.ts. No fabrication.
  let extractionId: string | undefined;
  if (selections.includes('import_data') && (textContent || structuredData)) {
    const allowedTabKeys = ALLOWED_TAB_KEYS.filter(k => !AI_POPULATE_EXCLUDED_TABS.has(k));
    try {
      const ext = await aiExtractProposals({ textContent, structured: structuredData, allowedTabKeys });
      const proposal = await prisma.importExtractionProposal.create({
        data: {
          engagementId,
          sourceType: 'cloud',
          sourceLabel: `${connector.label} — ${engagement.client?.clientName || ''}`.trim(),
          sourceArchiveDocumentId: archiveDocId,
          proposals: ext.proposals as unknown as object,
          aiModel: ext.model,
          rawAiResponse: ext.rawAiResponse?.slice(0, 50000),
          status: 'pending',
          createdById: session.user.id,
        },
      });
      extractionId = proposal.id;
    } catch (err) {
      console.warn('[cloud-fetch] AI extraction failed:', err);
    }
  }

  const at = new Date().toISOString();
  const me = { userId: session.user.id, userName: session.user.name || session.user.email || null };
  const prev = (engagement.importOptions as ImportOptionsState | null) || null;
  const next: ImportOptionsState = {
    prompted: true,
    selections,
    source: { type: 'cloud', connectorId: connector.id, vendorLabel: connector.label, sourceFileDocumentId: archiveDocId },
    byUserId: me.userId,
    byUserName: me.userName,
    at,
    status: extractionId ? 'extracted' : 'pending',
    extractionId,
    history: [
      ...(prev?.history || []),
      { event: 'cloud_fetched', at, by: me, note: connector.label },
      ...(extractionId ? [{ event: 'extracted' as const, at, by: me }] : []),
    ],
  };
  await prisma.auditEngagement.update({ where: { id: engagementId }, data: { importOptions: next as unknown as object } });

  return NextResponse.json({ importOptions: next, extractionId, archiveDocumentId: archiveDocId });
}
