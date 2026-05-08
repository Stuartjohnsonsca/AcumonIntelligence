// HTTP entry point for the orchestrator.
// Acumon's /api/engagements/[id]/import-options/handoff/start fires
// POST /sessions to kick off a new run. The orchestrator validates the
// shared secret, accepts the request synchronously (200 OK), and runs
// the import in the background. Progress + prompts flow back to Acumon
// via reportProgress / askUser etc.

import express from 'express';
import { runSession } from './session.js';

const PORT = parseInt(process.env.PORT || '8080', 10);
const SECRET = process.env.ORCHESTRATOR_SECRET || '';

if (!SECRET) {
  console.error('FATAL: ORCHESTRATOR_SECRET not set. Refusing to start.');
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('FATAL: ANTHROPIC_API_KEY not set. Refusing to start.');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, version: '1.0.0' });
});

app.post('/sessions', async (req, res) => {
  if ((req.headers['x-orchestrator-secret'] || '') !== SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { sessionId, vendorLabel, clientName } = req.body || {};
  if (!sessionId || !vendorLabel) {
    return res.status(400).json({ error: 'sessionId and vendorLabel required' });
  }

  // Acknowledge synchronously, run async. Acumon polls /handoff/status.
  res.json({ accepted: true });
  void runSession({ sessionId, vendorLabel, clientName })
    .catch(err => console.error(`[orchestrator] session ${sessionId} crashed:`, err));
});

app.listen(PORT, () => {
  console.log(`[orchestrator] listening on :${PORT}`);
});
