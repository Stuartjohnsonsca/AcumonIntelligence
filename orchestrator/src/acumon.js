// Wrapper around the Acumon /api/internal/handoff/* surface. Every
// call carries the X-Orchestrator-Secret shared secret. Errors are
// thrown so the caller can surface them via reportFailure().

import FormData from 'form-data';

const ACUMON_BASE = process.env.ACUMON_BASE_URL || 'https://acumon-website.vercel.app';
const SECRET = process.env.ORCHESTRATOR_SECRET || '';

function requireSecret() {
  if (!SECRET) throw new Error('ORCHESTRATOR_SECRET not set');
}

async function postJson(path, body) {
  requireSecret();
  const res = await fetch(`${ACUMON_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-orchestrator-secret': SECRET },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function putJson(path, body) {
  requireSecret();
  const res = await fetch(`${ACUMON_BASE}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-orchestrator-secret': SECRET },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PUT ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function reportProgress(sessionId, stage, message) {
  await postJson(`/api/internal/handoff/${sessionId}/progress`, { stage, message });
}

export async function reportFailure(sessionId, message) {
  await postJson(`/api/internal/handoff/${sessionId}/fail`, { message });
}

// Queues a prompt and long-polls for the user's answer. Returns the
// answer payload (shape depends on prompt type) or throws on
// timeout/expiry/cancellation.
export async function askUser(sessionId, prompt) {
  const promptId = `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await postJson(`/api/internal/handoff/${sessionId}/prompt`, { promptId, ...prompt });

  // Long-poll until answered (or session terminates). Each request
  // waits up to 25s server-side, then we re-arm — keeps connections
  // healthy on Container Apps.
  for (;;) {
    requireSecret();
    const res = await fetch(
      `${ACUMON_BASE}/api/internal/handoff/${sessionId}/prompt-answer?promptId=${encodeURIComponent(promptId)}&waitMs=25000`,
      { headers: { 'x-orchestrator-secret': SECRET } },
    );
    if (!res.ok) throw new Error(`prompt-answer ${res.status}`);
    const json = await res.json();
    if (json.answered) return json.answer;
    if (json.status && json.status !== 'pending') {
      throw new Error(`Session ${json.status} before user answered`);
    }
    // Otherwise loop and re-arm.
  }
}

export async function fetchRecipe(sessionId, clientReference) {
  requireSecret();
  const res = await fetch(
    `${ACUMON_BASE}/api/internal/handoff/${sessionId}/recipe?clientReference=${encodeURIComponent(clientReference)}`,
    { headers: { 'x-orchestrator-secret': SECRET } },
  );
  if (!res.ok) throw new Error(`fetchRecipe ${res.status}`);
  const json = await res.json();
  return json.recipe || null;
}

export async function saveRecipe(sessionId, clientReference, recipe) {
  await putJson(`/api/internal/handoff/${sessionId}/recipe`, { clientReference, recipe });
}

export async function submitArchive(sessionId, { fileBuffer, fileName, mimeType }) {
  requireSecret();
  const form = new FormData();
  form.append('fileName', fileName);
  form.append('mimeType', mimeType);
  form.append('file', fileBuffer, { filename: fileName, contentType: mimeType });
  const res = await fetch(`${ACUMON_BASE}/api/internal/handoff/${sessionId}/submit`, {
    method: 'POST',
    headers: { ...form.getHeaders(), 'x-orchestrator-secret': SECRET },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`submit ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}
