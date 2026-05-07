// Acumon MCP server — speaks the Model Context Protocol (JSON-RPC 2.0
// over HTTP) so external AI assistants like Claude Cowork can drive a
// prior-period import without a human paste-copying prompts.
//
// Authentication: each request carries an `Authorization: Bearer <token>`
// header where <token> is an ImportHandoffSession.id. Tokens are
// one-time, scoped to a single engagement, and expire after 30 minutes.
// On submit_archive() the session is closed (status='submitted') and
// any further calls with the same token are rejected.
//
// We deliberately do NOT use @modelcontextprotocol/sdk here — the SDK's
// transports assume a long-lived server (stdio or SSE). For a serverless
// Vercel function the cleanest path is a hand-written JSON-RPC handler
// over plain HTTP (this is the "Streamable HTTP" pattern from the MCP
// spec, restricted to single request-response which is all our tools
// need).

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { uploadToInbox } from '@/lib/azure-blob';
import { processPdf } from '@/lib/pdf-to-images';
import { aiExtractProposals } from '@/lib/import-options/ai-extractor';
import {
  AI_POPULATE_EXCLUDED_TABS,
  type ImportOptionsState,
} from '@/lib/import-options/types';

const PRIOR_PERIOD_ARCHIVE_TAG = '__prior_period_archive__';
const ALLOWED_TAB_KEYS = [
  'opening', 'prior-period', 'permanent-file', 'ethics', 'continuance',
  'new-client', 'materiality', 'par', 'walkthroughs', 'documents',
  'outstanding', 'communication', 'tax-technical', 'subsequent-events',
];

const SERVER_INFO = {
  name: 'acumon-import',
  title: 'Acumon Audit Import',
  version: '1.0.0',
};

// Tool catalogue — kept stable so external assistants can introspect
// once and reuse. NEW tools should be added here without renaming or
// removing existing entries (clients cache the catalogue).
const TOOLS = [
  {
    name: 'get_session_context',
    description:
      'Return the engagement context for the current import session: client name, period end, '
      + 'audit type label, and the vendor the user has chosen to import from. Call this first so '
      + 'you know which client, period, and vendor to operate on.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'submit_archive',
    description:
      'Submit the prior-period audit archive you have downloaded from the vendor. The file is '
      + 'persisted as the engagement\'s Prior Period Archive document, AI extraction is run, '
      + 'and the user is advanced to the Review screen in their browser. After this returns, '
      + 'the session is closed — do not call any further tools.',
    inputSchema: {
      type: 'object',
      properties: {
        fileName: { type: 'string', description: 'Original filename (e.g. "engagement-2024.zip")' },
        mimeType: { type: 'string', description: 'MIME type — application/zip, application/pdf, etc.' },
        contentBase64: {
          type: 'string',
          description: 'Base64-encoded file bytes. Keep under 25 MB; for larger files split into the most relevant single archive (ideally the financial statements + working papers PDF).',
        },
      },
      required: ['fileName', 'contentBase64'],
      additionalProperties: false,
    },
  },
];

function jsonRpcResult(id: unknown, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, result });
}
function jsonRpcError(id: unknown, code: number, message: string) {
  return NextResponse.json({ jsonrpc: '2.0', id, error: { code, message } });
}

interface SessionRow {
  id: string;
  engagementId: string;
  firmId: string;
  createdById: string;
  vendorLabel: string;
  status: string;
  expiresAt: Date;
}

async function loadSessionFromAuth(req: Request): Promise<SessionRow | { error: string; status: number }> {
  const auth = req.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return { error: 'Missing Authorization: Bearer <token>', status: 401 };
  const token = m[1].trim();
  if (!token || token.length < 16) return { error: 'Invalid token', status: 401 };
  const session = await prisma.importHandoffSession.findUnique({ where: { id: token } });
  if (!session) return { error: 'Session not found', status: 401 };
  if (session.status !== 'pending') return { error: `Session ${session.status}`, status: 410 };
  if (session.expiresAt < new Date()) {
    await prisma.importHandoffSession.update({
      where: { id: token },
      data: { status: 'expired' },
    });
    return { error: 'Session expired', status: 410 };
  }
  return session;
}

export async function GET() {
  // Discovery / health. No auth required; returns the server descriptor
  // so admins can sanity-check the URL.
  return NextResponse.json({
    serverInfo: SERVER_INFO,
    protocolVersions: ['2024-11-05', '2025-06-18'],
    note:
      'Send POST application/json JSON-RPC 2.0 requests with Authorization: Bearer <session token>. '
      + 'See https://acumonintelligence.com/methodology-admin/cloud-audit-connectors/mcp-setup for setup.',
    tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
  });
}

export async function POST(req: Request) {
  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return jsonRpcError(null, -32700, 'Parse error');
  }
  if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return jsonRpcError(body.id ?? null, -32600, 'Invalid Request');
  }
  const id = body.id ?? null;

  // initialize / tools/list don't need an authenticated session — they
  // describe the server. Everything else does.
  if (body.method === 'initialize') {
    return jsonRpcResult(id, {
      protocolVersion: (body.params?.protocolVersion as string) || '2024-11-05',
      serverInfo: SERVER_INFO,
      capabilities: { tools: {} },
    });
  }
  if (body.method === 'tools/list') {
    return jsonRpcResult(id, { tools: TOOLS });
  }

  if (body.method === 'tools/call') {
    const sessionOrErr = await loadSessionFromAuth(req);
    if ('error' in sessionOrErr) {
      return jsonRpcError(id, -32001, sessionOrErr.error);
    }
    const session = sessionOrErr;
    const params = body.params || {};
    const toolName = params.name as string;
    const args = (params.arguments || {}) as Record<string, unknown>;

    if (toolName === 'get_session_context') {
      const engagement = await prisma.auditEngagement.findUnique({
        where: { id: session.engagementId },
        select: {
          auditType: true,
          framework: true,
          client: { select: { clientName: true } },
          period: { select: { startDate: true, endDate: true } },
        },
      });
      const text = JSON.stringify({
        clientName: engagement?.client?.clientName,
        periodStart: engagement?.period?.startDate?.toISOString().slice(0, 10),
        periodEnd: engagement?.period?.endDate?.toISOString().slice(0, 10),
        auditType: engagement?.auditType,
        framework: engagement?.framework,
        vendor: session.vendorLabel,
        instructions:
          'Navigate the active browser tab to the vendor\'s site, find the prior-period audit '
          + 'file for this client, download it, then call submit_archive with the file content.',
      }, null, 2);
      return jsonRpcResult(id, {
        content: [{ type: 'text', text }],
      });
    }

    if (toolName === 'submit_archive') {
      const fileName = String(args.fileName || 'prior-audit-file');
      const mimeType = String(args.mimeType || 'application/octet-stream');
      const contentBase64 = String(args.contentBase64 || '');
      if (!contentBase64) {
        return jsonRpcError(id, -32602, 'submit_archive requires contentBase64');
      }
      const buffer = Buffer.from(contentBase64, 'base64');
      if (buffer.length === 0) {
        return jsonRpcError(id, -32602, 'contentBase64 decoded to empty buffer');
      }
      if (buffer.length > 25 * 1024 * 1024) {
        return jsonRpcError(id, -32602, 'submit_archive maximum file size is 25 MB');
      }

      // Load the engagement so we know clientId for the blob path.
      const engagement = await prisma.auditEngagement.findUnique({
        where: { id: session.engagementId },
        select: { id: true, clientId: true },
      });
      if (!engagement) {
        return jsonRpcError(id, -32603, 'Engagement not found');
      }

      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const blobName = `documents/${engagement.clientId}/${engagement.id}/${Date.now()}_handoff_${safeName}`;
      await uploadToInbox(blobName, buffer, mimeType);

      const archiveDoc = await prisma.auditDocument.create({
        data: {
          engagementId: engagement.id,
          documentName: `Prior Period Archive — ${session.vendorLabel} (via Acumon MCP) — ${fileName}`,
          storagePath: blobName,
          uploadedDate: new Date(),
          uploadedById: session.createdById,
          fileSize: buffer.length,
          mimeType,
          receivedByName: `Acumon MCP (${session.vendorLabel})`,
          receivedAt: new Date(),
          mappedItems: [PRIOR_PERIOD_ARCHIVE_TAG],
          usageLocation: 'Prior Period',
          documentType: 'Prior Period Audit File',
          source: 'Third Party',
        },
      });

      // Run AI extraction off the file (PDF text where possible).
      let textContent = '';
      if (mimeType.includes('pdf') || /\.pdf$/i.test(fileName)) {
        try {
          const pdf = await processPdf(buffer, 50);
          textContent = pdf.text || '';
        } catch (err) {
          console.warn('[mcp] PDF text extraction failed:', err);
        }
      }
      const allowedTabKeys = ALLOWED_TAB_KEYS.filter(k => !AI_POPULATE_EXCLUDED_TABS.has(k));
      let proposalId: string;
      try {
        const result = await aiExtractProposals({ textContent, allowedTabKeys });
        const proposal = await prisma.importExtractionProposal.create({
          data: {
            engagementId: engagement.id,
            sourceType: 'cloud',
            sourceLabel: `${session.vendorLabel} (via Acumon MCP) — ${fileName}`,
            sourceArchiveDocumentId: archiveDoc.id,
            proposals: result.proposals as unknown as object,
            aiModel: result.model,
            rawAiResponse: result.rawAiResponse?.slice(0, 50000),
            status: 'pending',
            createdById: session.createdById,
          },
        });
        proposalId = proposal.id;
      } catch (err) {
        console.warn('[mcp] AI extraction failed:', err);
        const proposal = await prisma.importExtractionProposal.create({
          data: {
            engagementId: engagement.id,
            sourceType: 'cloud',
            sourceLabel: `${session.vendorLabel} (via Acumon MCP) — ${fileName}`,
            sourceArchiveDocumentId: archiveDoc.id,
            proposals: [],
            status: 'pending',
            createdById: session.createdById,
          },
        });
        proposalId = proposal.id;
      }

      // Close the handoff session so the modal polling status sees the flip.
      await prisma.importHandoffSession.update({
        where: { id: session.id },
        data: {
          status: 'submitted',
          submittedAt: new Date(),
          submittedDocumentId: archiveDoc.id,
          submittedExtractionId: proposalId,
        },
      });

      // Mirror engagement.importOptions history so the audit trail records the MCP submission.
      const eng = await prisma.auditEngagement.findUnique({
        where: { id: engagement.id },
        select: { importOptions: true },
      });
      const prev = (eng?.importOptions as ImportOptionsState | null) || null;
      const at = new Date().toISOString();
      const next: ImportOptionsState = {
        prompted: true,
        selections: prev?.selections || ['import_data'],
        source: { type: 'cloud', sourceFileDocumentId: archiveDoc.id, vendorLabel: session.vendorLabel },
        byUserId: prev?.byUserId || session.createdById,
        byUserName: prev?.byUserName,
        at,
        status: 'extracted',
        extractionId: proposalId,
        history: [
          ...(prev?.history || []),
          { event: 'cloud_fetched', at, note: `Acumon MCP (${session.vendorLabel}) — ${fileName}` },
          { event: 'extracted', at },
        ],
      };
      await prisma.auditEngagement.update({
        where: { id: engagement.id },
        data: { importOptions: next as unknown as object },
      });

      return jsonRpcResult(id, {
        content: [{
          type: 'text',
          text:
            `Archive received (${(buffer.length / 1024).toFixed(0)} KB) and queued for review.\n`
            + `Document id: ${archiveDoc.id}\n`
            + `Extraction id: ${proposalId}\n`
            + 'The user will see the Review screen automatically. Stop here.',
        }],
      });
    }

    return jsonRpcError(id, -32601, `Unknown tool: ${toolName}`);
  }

  return jsonRpcError(id, -32601, `Unknown method: ${body.method}`);
}
