import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildTemplateContext } from '@/lib/template-context';
import { askInterrogateBot, type InterrogateMessage, type FewShotExample } from '@/lib/interrogate-bot';
import { uniqueSourcePaths, uniqueDocumentRefs } from '@/lib/interrogate-citations';
import { embedOne, cosineSimilarity, EMBEDDING_MODEL_NAME } from '@/lib/embeddings';

/**
 * POST /api/engagements/:engagementId/interrogate
 *
 * Strict, file-only Q&A over an engagement. Anyone with read access to
 * the engagement can interrogate.
 *
 * Phase 1 — every successful Q&A is captured (rateable + correctable
 * via /interrogate/:interactionId/rating).
 * Phase 2 — embed the question, find top-K thumbs-up prior interactions
 * for this firm with similar embedding, inject as few-shot examples
 * so the bot mimics the firm's tone over time.
 * Phase 3 — retrieve relevant DocumentChunk vectors and include the
 * raw text in the prompt so the bot can cite uploaded documents.
 *
 * Body: { question: string, history?: Array<{ role, content }> }
 */
const FEW_SHOT_MIN_SIMILARITY = 0.55;
const FEW_SHOT_K = 4;
const DOC_CHUNK_MIN_SIMILARITY = 0.50;
const DOC_CHUNK_K = 6;

export async function POST(req: NextRequest, ctx: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await ctx.params;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 });
  }
  const rawHistory = Array.isArray(body.history) ? body.history : [];
  const history: InterrogateMessage[] = rawHistory
    .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));

  let templateContext;
  try {
    templateContext = await buildTemplateContext(engagementId);
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to load engagement context: ${err?.message || 'unknown'}` }, { status: 500 });
  }

  // Phase 2 + 3: embed the question. If embedding fails (e.g. Together
  // outage), fall back to the bare bot — degraded but functional.
  let questionEmbedding: number[] | null = null;
  try {
    questionEmbedding = await embedOne(question);
  } catch (err) {
    console.warn('[interrogate] question embedding failed:', err instanceof Error ? err.message : err);
  }

  // Phase 2: retrieve thumbs-up similar prior interactions for THIS firm.
  // Excludes the current engagement so we surface lessons from other
  // engagements rather than echoing this engagement's own prior turns.
  let fewShot: FewShotExample[] = [];
  if (questionEmbedding) {
    try {
      const candidates = await prisma.interrogateInteraction.findMany({
        where: {
          firmId: engagement.firmId,
          rating: 'up',
          questionEmbedding: { not: undefined },
          NOT: { engagementId },
        },
        select: { question: true, answer: true, correction: true, questionEmbedding: true },
        take: 200, // cap the corpus we score; 200 ranked-up Qs is plenty
        orderBy: { ratingAt: 'desc' },
      });
      const scored = candidates
        .map(c => ({
          c,
          score: Array.isArray(c.questionEmbedding)
            ? cosineSimilarity(questionEmbedding!, c.questionEmbedding as number[])
            : 0,
        }))
        .filter(s => s.score >= FEW_SHOT_MIN_SIMILARITY)
        .sort((a, b) => b.score - a.score)
        .slice(0, FEW_SHOT_K);
      fewShot = scored.map(s => ({
        question: s.c.question,
        answer: s.c.answer,
        correction: s.c.correction,
      }));
      if (fewShot.length > 0) {
        console.log(`[interrogate] using ${fewShot.length} few-shot example(s) (top score ${scored[0]?.score?.toFixed(3)})`);
      }
    } catch (err) {
      console.warn('[interrogate] few-shot retrieval failed:', err instanceof Error ? err.message : err);
    }
  }

  // Phase 3: retrieve relevant document chunks for THIS engagement's documents.
  let documentChunks: { documentId: string; documentName: string; content: string; page?: number }[] = [];
  if (questionEmbedding) {
    try {
      const engDocs = await prisma.auditDocument.findMany({
        where: { engagementId, storagePath: { not: null } },
        select: { id: true, documentName: true },
      });
      const docIds = engDocs.map(d => d.id);
      const docNameById = new Map(engDocs.map(d => [d.id, d.documentName]));
      if (docIds.length > 0) {
        const chunks = await prisma.documentChunk.findMany({
          where: { documentId: { in: docIds } },
          select: { documentId: true, content: true, embedding: true, metadata: true },
          take: 1000, // bounded scan; per-firm scale we expect this to be fine
        });
        const scored = chunks
          .map(c => ({
            c,
            score: Array.isArray(c.embedding) ? cosineSimilarity(questionEmbedding!, c.embedding as number[]) : 0,
          }))
          .filter(s => s.score >= DOC_CHUNK_MIN_SIMILARITY)
          .sort((a, b) => b.score - a.score)
          .slice(0, DOC_CHUNK_K);
        documentChunks = scored.map(s => ({
          documentId: s.c.documentId,
          documentName: docNameById.get(s.c.documentId) || 'document',
          content: s.c.content.slice(0, 2000),
          page: typeof (s.c.metadata as any)?.page === 'number' ? (s.c.metadata as any).page : undefined,
        }));
        if (documentChunks.length > 0) {
          console.log(`[interrogate] retrieved ${documentChunks.length} document chunk(s) (top score ${scored[0]?.score?.toFixed(3)})`);
        }
      }
    } catch (err) {
      console.warn('[interrogate] document chunk retrieval failed:', err instanceof Error ? err.message : err);
    }
  }

  let result;
  try {
    result = await askInterrogateBot(templateContext, question, history, fewShot, documentChunks);
  } catch (err: any) {
    return NextResponse.json({ error: `InterrogateBot failed: ${err?.message || 'unknown'}` }, { status: 500 });
  }

  // Persist. Failures non-fatal.
  let interactionId: string | null = null;
  const sources = uniqueSourcePaths(result.answer);
  const documentReferences = uniqueDocumentRefs(result.answer);
  try {
    const created = await prisma.interrogateInteraction.create({
      data: {
        firmId: engagement.firmId,
        engagementId,
        userId: session.user.id,
        userName: session.user.name || session.user.email || null,
        question,
        answer: result.answer,
        sources: sources as object,
        documentReferences: documentReferences as object,
        questionEmbedding: (questionEmbedding ?? undefined) as object | undefined,
        embeddingModel: questionEmbedding ? EMBEDDING_MODEL_NAME : null,
        aiModel: result.model,
        promptTokens: result.usage?.promptTokens,
        completionTokens: result.usage?.completionTokens,
      },
      select: { id: true },
    });
    interactionId = created.id;
  } catch (err) {
    console.warn('[interrogate] failed to log interaction:', err instanceof Error ? err.message : err);
  }

  return NextResponse.json({
    answer: result.answer,
    model: result.model,
    usage: result.usage,
    interactionId,
    sources,
    documentReferences,
    fewShotUsed: fewShot.length,
    documentChunksUsed: documentChunks.length,
  });
}
