// Phase 3 — chunk + embed an AuditDocument so InterrogateBot can
// retrieve text passages from uploaded files via vector search.
//
// Pipeline:
//   1. Read the blob from Azure storage by AuditDocument.storagePath.
//   2. Extract text — PDF via pdf-parse / unpdf / pdfjs (lib/pdf-to-images),
//      .txt/.csv/.json/.md as raw UTF-8, others left unindexed (we
//      don't ship a Word extractor here yet).
//   3. Chunk into ~512-token windows with ~50-token overlap so a
//      query crossing a chunk boundary still hits the right passage.
//   4. Embed each chunk (Together AI BAAI/bge-large-en-v1.5).
//   5. Replace any prior chunks for that document and write the new set.
//
// Idempotent — safe to re-run for the same document. Cheap on
// re-indexing too because we delete + re-create rather than diffing.

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db';
import { downloadBlob } from '@/lib/azure-blob';

const DEFAULT_CONTAINER = process.env.AZURE_STORAGE_CONTAINER_INBOX || 'upload-inbox';
import { processPdf } from '@/lib/pdf-to-images';
import { embed, EMBEDDING_MODEL_NAME } from '@/lib/embeddings';

const CHARS_PER_TOKEN = 3.6;
const CHUNK_TOKENS = 512;
const OVERLAP_TOKENS = 60;
const CHUNK_CHARS = Math.floor(CHUNK_TOKENS * CHARS_PER_TOKEN); // ~1840
const OVERLAP_CHARS = Math.floor(OVERLAP_TOKENS * CHARS_PER_TOKEN); // ~216
const MAX_CHUNKS_PER_DOC = 200;
const EMBED_BATCH_SIZE = 32;

interface IndexResult {
  documentId: string;
  status: 'indexed' | 'unsupported_mime' | 'no_text' | 'no_blob' | 'failed';
  chunkCount: number;
  message?: string;
}

function isTextLike(name: string, mime: string): boolean {
  if (mime?.startsWith('text/')) return true;
  if (/\.(txt|csv|tsv|md|json|xml|html?)$/i.test(name)) return true;
  return false;
}
function isPdf(name: string, mime: string): boolean {
  return mime === 'application/pdf' || /\.pdf$/i.test(name);
}

/** Naive sliding-window chunker. Doesn't try to honour sentence
 *  boundaries — for audit-grade text (financial statements, board
 *  minutes) chunk boundaries are noise we accept in exchange for
 *  predictability. */
function chunkText(text: string): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return [];
  const out: string[] = [];
  let cursor = 0;
  while (cursor < cleaned.length && out.length < MAX_CHUNKS_PER_DOC) {
    const end = Math.min(cursor + CHUNK_CHARS, cleaned.length);
    out.push(cleaned.slice(cursor, end));
    if (end === cleaned.length) break;
    cursor = end - OVERLAP_CHARS;
    if (cursor < 0) cursor = 0;
  }
  return out;
}

export async function indexDocument(documentId: string): Promise<IndexResult> {
  const doc = await prisma.auditDocument.findUnique({
    where: { id: documentId },
    select: { id: true, documentName: true, storagePath: true, mimeType: true, containerName: true },
  });
  if (!doc) return { documentId, status: 'failed', chunkCount: 0, message: 'document not found' };
  if (!doc.storagePath) return { documentId, status: 'no_blob', chunkCount: 0 };

  const name = doc.documentName || 'document';
  const mime = doc.mimeType || '';

  // 1. Read bytes from Azure (we use the doc's containerName when set;
  // fall back to the upload-inbox container which is where /api/upload/document
  // writes by default).
  let buffer: Buffer;
  try {
    buffer = await downloadBlob(doc.storagePath, doc.containerName || DEFAULT_CONTAINER);
  } catch (err) {
    return { documentId, status: 'failed', chunkCount: 0, message: `blob download failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // 2. Extract text
  let fullText = '';
  let metadataPagesPerChunk: (number | undefined)[] = [];
  if (isPdf(name, mime)) {
    try {
      const r = await processPdf(buffer, 200);
      fullText = r.text || '';
    } catch (err) {
      return { documentId, status: 'failed', chunkCount: 0, message: `pdf extraction failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  } else if (isTextLike(name, mime)) {
    fullText = buffer.toString('utf8');
  } else {
    return { documentId, status: 'unsupported_mime', chunkCount: 0, message: `mime "${mime}" not indexable` };
  }
  if (!fullText || fullText.trim().length < 50) {
    return { documentId, status: 'no_text', chunkCount: 0, message: 'no extractable text' };
  }

  // 3. Chunk
  const chunks = chunkText(fullText);
  if (chunks.length === 0) {
    return { documentId, status: 'no_text', chunkCount: 0, message: 'chunker produced no output' };
  }
  metadataPagesPerChunk = new Array(chunks.length).fill(undefined);

  // 4. Embed (batched to keep request payload bounded)
  const embeddings: number[][] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const vecs = await embed(batch);
    embeddings.push(...vecs);
  }

  // 5. Replace prior chunks atomically.
  await prisma.$transaction([
    prisma.documentChunk.deleteMany({ where: { documentId } }),
    prisma.documentChunk.createMany({
      data: chunks.map((content, i) => ({
        id: randomUUID(),
        documentId,
        chunkIndex: i,
        content,
        embedding: embeddings[i] as object,
        embeddingModel: EMBEDDING_MODEL_NAME,
        metadata: metadataPagesPerChunk[i] !== undefined ? { page: metadataPagesPerChunk[i] } : undefined,
      })),
    }),
  ]);

  return { documentId, status: 'indexed', chunkCount: chunks.length };
}
