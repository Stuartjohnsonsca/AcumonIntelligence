// Acumon MCP server — OAuth-authenticated.
//
// Auth model:
//   The user adds Acumon as a custom integration in their AI assistant.
//   The assistant runs the OAuth dance (DCR + auth code + PKCE), gets an
//   access token bound to the user, and uses it as Bearer for every MCP
//   call. We validate the token here and attach (userId, firmId) to the
//   request context.
//
// Session model:
//   "Sessions" are now just rows the assistant looks up by ID. Acumon's
//   UI (the Import Options modal) creates a pending session bound to the
//   user when they click Continue; the session stays pending until the
//   assistant calls submit_archive on it (or it expires). The session ID
//   is NOT auth — it's just an identifier the assistant carries forward.
//
// Tool catalogue:
//   - list_pending_sessions()       → sessions awaiting an archive
//   - get_session_context(sid)      → engagement context for one session
//   - submit_archive(sid, ...)      → close the session with a file
//
// Telling the assistant "run my Acumon import" is enough — it can call
// list_pending_sessions, find the most recent one, look up its context,
// and submit. No tokens or IDs need to be pasted into chat.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { uploadToInbox } from '@/lib/azure-blob';
import { processPdf } from '@/lib/pdf-to-images';
import { aiExtractProposals } from '@/lib/import-options/ai-extractor';
import { validateBearer, getBaseUrl } from '@/lib/oauth/server';
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
  version: '2.0.0',
};

const TOOLS = [
  {
    name: 'list_pending_sessions',
    description:
      'List the user\'s pending Acumon import sessions (oldest first). Each session is linked '
      + 'to a specific audit engagement. Call this first if the user did not give you a session id, '
      + 'and pick the most recent one (or ask the user which) before calling get_session_context.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_session_context',
    description:
      'Return the engagement context for a session: client name, period dates, audit type, '
      + 'and the vendor the user wants to import from. Use this to know what to look for on '
      + 'the vendor\'s site before downloading the prior audit file.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'The session id from list_pending_sessions.' },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'submit_archive',
    description:
      'Submit the prior-period audit archive you have downloaded from the vendor. The file is '
      + 'persisted as the engagement\'s Prior Period Archive document, AI extraction is run, and '
      + 'the user is advanced to the Review screen in their browser. After this returns, the '
      + 'session is closed — do not call further tools on it.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        fileName: { type: 'string' },
        mimeType: { type: 'string' },
        contentBase64: {
          type: 'string',
          description: 'Base64 file bytes. Keep under 25 MB — for larger engagements upload only the most relevant single archive.',
        },
      },
      required: ['sessionId', 'fileName', 'contentBase64'],
      additionalProperties: false,
    },
  },
];

function jsonRpcResult(id: unknown, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, result });
}
function jsonRpcError(id: unknown, code: number, message: string, status = 200) {
  return NextResponse.json({ jsonrpc: '2.0', id, error: { code, message } }, { status });
}
function authErrorResponse(req: Request) {
  // RFC 6750 — present the WWW-Authenticate header pointing at our PRM
  // so clients can discover the auth server.
  const base = getBaseUrl(req);
  return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthenticated' } },
    {
      status: 401,
      headers: {
        'WWW-Authenticate': `Bearer realm="Acumon MCP", resource_metadata="${base}/.well-known/oauth-protected-resource"`,
      },
    },
  );
}

export async function GET(req: Request) {
  // Discovery / health. Returns the server descriptor and a hint about
  // OAuth so admins / clients can sanity-check the URL.
  const base = getBaseUrl(req);
  return NextResponse.json({
    serverInfo: SERVER_INFO,
    protocolVersions: ['2024-11-05', '2025-06-18'],
    auth: {
      type: 'oauth2',
      authorizationServer: base,
      protectedResource: `${base}/.well-known/oauth-protected-resource`,
    },
    tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
  });
}

export async function POST(req: Request) {
  // Parse body first — we do this before auth so initialize/tools/list
  // can succeed without a token (some clients probe before authing).
  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
  try { body = await req.json(); } catch { return jsonRpcError(null, -32700, 'Parse error', 400); }
  if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return jsonRpcError(body.id ?? null, -32600, 'Invalid Request', 400);
  }
  const id = body.id ?? null;

  if (body.method === 'initialize') {
    return jsonRpcResult(id, {
      protocolVersion: (body.params?.protocolVersion as string) || '2025-06-18',
      serverInfo: SERVER_INFO,
      capabilities: { tools: {} },
    });
  }
  if (body.method === 'tools/list') {
    return jsonRpcResult(id, { tools: TOOLS });
  }

  // Everything from here on requires a bearer.
  const auth = req.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return authErrorResponse(req);
  const validated = await validateBearer(m[1].trim());
  if (!validated) return authErrorResponse(req);

  if (body.method === 'tools/call') {
    const params = body.params || {};
    const toolName = params.name as string;
    const args = (params.arguments || {}) as Record<string, unknown>;

    if (toolName === 'list_pending_sessions') {
      const sessions = await prisma.importHandoffSession.findMany({
        where: {
          firmId: validated.firmId,
          createdById: validated.userId,
          status: 'pending',
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'asc' },
        take: 20,
        include: {
          engagement: {
            select: {
              client: { select: { clientName: true } },
              period: { select: { endDate: true } },
              auditType: true,
            },
          },
        },
      });
      const text = JSON.stringify({
        sessions: sessions.map(s => ({
          sessionId: s.id,
          client: s.engagement?.client?.clientName,
          periodEnd: s.engagement?.period?.endDate?.toISOString().slice(0, 10),
          auditType: s.engagement?.auditType,
          vendor: s.vendorLabel,
          createdAt: s.createdAt.toISOString(),
          expiresAt: s.expiresAt.toISOString(),
        })),
      }, null, 2);
      return jsonRpcResult(id, { content: [{ type: 'text', text }] });
    }

    if (toolName === 'get_session_context') {
      const sessionId = String(args.sessionId || '');
      if (!sessionId) return jsonRpcError(id, -32602, 'sessionId required');
      const handoff = await prisma.importHandoffSession.findUnique({
        where: { id: sessionId },
        include: {
          engagement: {
            select: {
              auditType: true,
              framework: true,
              client: { select: { clientName: true } },
              period: { select: { startDate: true, endDate: true } },
            },
          },
        },
      });
      if (!handoff
        || handoff.firmId !== validated.firmId
        || handoff.createdById !== validated.userId) {
        return jsonRpcError(id, -32001, 'Session not found');
      }
      if (handoff.status !== 'pending') return jsonRpcError(id, -32001, `Session ${handoff.status}`);
      if (handoff.expiresAt < new Date()) return jsonRpcError(id, -32001, 'Session expired');
      const text = JSON.stringify({
        sessionId,
        clientName: handoff.engagement?.client?.clientName,
        periodStart: handoff.engagement?.period?.startDate?.toISOString().slice(0, 10),
        periodEnd: handoff.engagement?.period?.endDate?.toISOString().slice(0, 10),
        auditType: handoff.engagement?.auditType,
        framework: handoff.engagement?.framework,
        vendor: handoff.vendorLabel,
        instructions:
          'Drive the active browser tab to the vendor\'s site, find the prior-period audit '
          + 'file for this client, download it, then call submit_archive with the file content '
          + 'and this sessionId. Do not enter passwords or MFA codes for the user — pause and '
          + 'ask if a login is needed.',
      }, null, 2);
      return jsonRpcResult(id, { content: [{ type: 'text', text }] });
    }

    if (toolName === 'submit_archive') {
      const sessionId = String(args.sessionId || '');
      const fileName = String(args.fileName || 'prior-audit-file');
      const mimeType = String(args.mimeType || 'application/octet-stream');
      const contentBase64 = String(args.contentBase64 || '');
      if (!sessionId) return jsonRpcError(id, -32602, 'sessionId required');
      if (!contentBase64) return jsonRpcError(id, -32602, 'contentBase64 required');
      const buffer = Buffer.from(contentBase64, 'base64');
      if (buffer.length === 0) return jsonRpcError(id, -32602, 'contentBase64 decoded empty');
      if (buffer.length > 25 * 1024 * 1024) return jsonRpcError(id, -32602, 'submit_archive max 25 MB');

      const handoff = await prisma.importHandoffSession.findUnique({ where: { id: sessionId } });
      if (!handoff
        || handoff.firmId !== validated.firmId
        || handoff.createdById !== validated.userId) {
        return jsonRpcError(id, -32001, 'Session not found');
      }
      if (handoff.status !== 'pending') return jsonRpcError(id, -32001, `Session ${handoff.status}`);
      if (handoff.expiresAt < new Date()) return jsonRpcError(id, -32001, 'Session expired');

      const engagement = await prisma.auditEngagement.findUnique({
        where: { id: handoff.engagementId },
        select: { id: true, clientId: true },
      });
      if (!engagement) return jsonRpcError(id, -32603, 'Engagement not found');

      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const blobName = `documents/${engagement.clientId}/${engagement.id}/${Date.now()}_handoff_${safeName}`;
      await uploadToInbox(blobName, buffer, mimeType);

      const archiveDoc = await prisma.auditDocument.create({
        data: {
          engagementId: engagement.id,
          documentName: `Prior Period Archive — ${handoff.vendorLabel} (via Acumon MCP) — ${fileName}`,
          storagePath: blobName,
          uploadedDate: new Date(),
          uploadedById: validated.userId,
          fileSize: buffer.length,
          mimeType,
          receivedByName: `Acumon MCP (${handoff.vendorLabel})`,
          receivedAt: new Date(),
          mappedItems: [PRIOR_PERIOD_ARCHIVE_TAG],
          usageLocation: 'Prior Period',
          documentType: 'Prior Period Audit File',
          source: 'Third Party',
        },
      });

      let textContent = '';
      if (mimeType.includes('pdf') || /\.pdf$/i.test(fileName)) {
        try {
          const pdf = await processPdf(buffer, 50);
          textContent = pdf.text || '';
        } catch (err) { console.warn('[mcp] PDF text extraction failed:', err); }
      }
      const allowedTabKeys = ALLOWED_TAB_KEYS.filter(k => !AI_POPULATE_EXCLUDED_TABS.has(k));
      let proposalId: string;
      try {
        const result = await aiExtractProposals({ textContent, allowedTabKeys });
        const proposal = await prisma.importExtractionProposal.create({
          data: {
            engagementId: engagement.id,
            sourceType: 'cloud',
            sourceLabel: `${handoff.vendorLabel} (via Acumon MCP) — ${fileName}`,
            sourceArchiveDocumentId: archiveDoc.id,
            proposals: result.proposals as unknown as object,
            aiModel: result.model,
            rawAiResponse: result.rawAiResponse?.slice(0, 50000),
            status: 'pending',
            createdById: validated.userId,
          },
        });
        proposalId = proposal.id;
      } catch (err) {
        console.warn('[mcp] AI extraction failed:', err);
        const proposal = await prisma.importExtractionProposal.create({
          data: {
            engagementId: engagement.id,
            sourceType: 'cloud',
            sourceLabel: `${handoff.vendorLabel} (via Acumon MCP) — ${fileName}`,
            sourceArchiveDocumentId: archiveDoc.id,
            proposals: [],
            status: 'pending',
            createdById: validated.userId,
          },
        });
        proposalId = proposal.id;
      }

      await prisma.importHandoffSession.update({
        where: { id: handoff.id },
        data: {
          status: 'submitted',
          submittedAt: new Date(),
          submittedDocumentId: archiveDoc.id,
          submittedExtractionId: proposalId,
        },
      });

      // Mirror engagement.importOptions history.
      const eng = await prisma.auditEngagement.findUnique({
        where: { id: engagement.id },
        select: { importOptions: true },
      });
      const prev = (eng?.importOptions as ImportOptionsState | null) || null;
      const at = new Date().toISOString();
      const next: ImportOptionsState = {
        prompted: true,
        selections: prev?.selections || ['import_data'],
        source: { type: 'cloud', sourceFileDocumentId: archiveDoc.id, vendorLabel: handoff.vendorLabel },
        byUserId: prev?.byUserId || validated.userId,
        byUserName: prev?.byUserName,
        at,
        status: 'extracted',
        extractionId: proposalId,
        history: [
          ...(prev?.history || []),
          { event: 'cloud_fetched', at, note: `Acumon MCP (${handoff.vendorLabel}) — ${fileName}` },
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
            + `The user will see the Review screen automatically. Stop here.`,
        }],
      });
    }

    return jsonRpcError(id, -32601, `Unknown tool: ${toolName}`);
  }

  return jsonRpcError(id, -32601, `Unknown method: ${body.method}`);
}
