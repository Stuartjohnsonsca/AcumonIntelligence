// Together AI embeddings — used by InterrogateBot Phase 2 (few-shot
// retrieval of similar prior good Q&As) and Phase 3 (RAG over uploaded
// documents).
//
// Model selection:
//   `BAAI/bge-large-en-v1.5` — 1024-dim, well-supported on Together,
//   strong general-purpose retrieval scores. Identical model used for
//   both questions and document chunks so cosine similarity is
//   meaningful across both kinds.
//
// Storage: vectors are persisted as JSON `Float[]` (not pgvector). At
// expected volumes (a few thousand Q&As + chunks per firm) the linear
// scan in app code is fine. Worth revisiting if any single firm
// exceeds 50k vectors — pgvector + an HNSW index would then be the
// next step.

const EMBED_MODEL = 'BAAI/bge-large-en-v1.5';
const EMBED_DIMS = 1024;

function getKey(): string {
  const k = process.env.TOGETHER_DOC_SUMMARY_KEY || process.env.TOGETHER_API_KEY;
  if (!k) throw new Error('No Together AI key for embeddings');
  return k;
}

/**
 * Embed one or more strings. Together accepts a single string or an
 * array; we always pass an array for a uniform shape.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await fetch('https://api.together.xyz/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${getKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Embedding failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const json = await res.json() as { data?: { embedding: number[]; index: number }[] };
  if (!Array.isArray(json.data)) throw new Error('Embedding response missing data');
  // Sort by index because Together doesn't guarantee response order.
  return json.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map(d => d.embedding);
}

export async function embedOne(text: string): Promise<number[]> {
  const out = await embed([text]);
  if (!out[0]) throw new Error('Embedding returned no vector');
  return out[0];
}

export const EMBEDDING_MODEL_NAME = EMBED_MODEL;
export const EMBEDDING_DIMS = EMBED_DIMS;

// ─── Cosine similarity ─────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Given a query embedding and a corpus of (id, embedding) pairs,
 * return the top-K most similar by cosine. O(N) — fine for a few
 * thousand vectors per firm.
 */
export function topK<T extends { id: string; embedding: number[] }>(
  query: number[],
  corpus: T[],
  k: number,
): Array<T & { score: number }> {
  const scored = corpus.map(c => ({ ...c, score: cosineSimilarity(query, c.embedding) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
