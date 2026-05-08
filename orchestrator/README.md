# Acumon Orchestrator

Server-side service that drives a headless Chromium through cloud audit-software vendors (MyWorkPapers etc.) to download a prior-period audit file on a user's behalf, using the Anthropic Computer Use API.

Triggered by Acumon's web app via `POST /sessions`. Reports progress and prompts the user (for credentials, MFA, confirmations) by calling back into Acumon's `/api/internal/handoff/*` endpoints — authenticated by a shared secret.

## What this is and isn't

This is **not part of the Acumon Next.js app**. It runs as its own container so it can host a real Chromium browser (which Vercel functions can't). The two services are loosely coupled — Acumon doesn't import any orchestrator code; it just hits its HTTP API.

## Required environment variables

| Var | Required | Notes |
|---|---|---|
| `ORCHESTRATOR_SECRET` | yes | 32+ byte random string. Same value must be set on both sides (this container *and* the Acumon Vercel deployment as `ORCHESTRATOR_SECRET`). |
| `ANTHROPIC_API_KEY` | yes | Anthropic API key with Computer Use access. The orchestrator uses this for every session, so it's billed to Acumon's account, not the user's. |
| `ACUMON_BASE_URL` | yes (effectively) | Defaults to `https://acumon-website.vercel.app`. Set explicitly in production for clarity. |
| `COMPUTER_USE_MODEL` | no | Defaults to `claude-sonnet-4-5-20250929`. Override if you want a different model. |
| `PORT` | no | Defaults to `8080`. |

Acumon (the Next.js app) needs the matching env vars set on Vercel:

| Var | Notes |
|---|---|
| `ORCHESTRATOR_SECRET` | same value as above |
| `ORCHESTRATOR_URL` | the orchestrator's public URL (e.g. `https://acumon-orchestrator.azurecontainerapps.io`) |

## Local development

```bash
cd orchestrator
npm install
npm run install-browser   # downloads Chromium
ORCHESTRATOR_SECRET=dev_secret \
ANTHROPIC_API_KEY=sk-ant-... \
ACUMON_BASE_URL=http://localhost:3000 \
node src/server.js
```

## Deploying to Azure Container Apps

You'll need: an Azure subscription, the Azure CLI, and a Container Apps environment in the same region as your Vercel deployment (low latency to Acumon's API matters).

```bash
# 1. Build and push the image to a container registry
#    (Azure Container Registry, Docker Hub, GitHub Container Registry, ...)
cd orchestrator
docker build -t <your-registry>/acumon-orchestrator:latest .
docker push <your-registry>/acumon-orchestrator:latest

# 2. Create / update the container app
az containerapp create \
  --name acumon-orchestrator \
  --resource-group <your-rg> \
  --environment <your-aca-env> \
  --image <your-registry>/acumon-orchestrator:latest \
  --target-port 8080 \
  --ingress external \
  --min-replicas 0 \
  --max-replicas 5 \
  --cpu 1.0 --memory 2.0Gi \
  --secrets orchestrator-secret=<random-32-byte-secret> \
            anthropic-key=sk-ant-... \
  --env-vars ORCHESTRATOR_SECRET=secretref:orchestrator-secret \
             ANTHROPIC_API_KEY=secretref:anthropic-key \
             ACUMON_BASE_URL=https://acumon-website.vercel.app
```

Then set the same `ORCHESTRATOR_SECRET` on Vercel, plus `ORCHESTRATOR_URL` pointing at the container app's FQDN. Acumon will start posting `/sessions` to it on the next deploy.

## Lifecycle of a session

1. User clicks **Connect to Cloud Audit Software** in Acumon. Acumon creates an `ImportHandoffSession` row and `POST /sessions { sessionId, vendorLabel, clientName }` to this orchestrator.
2. Orchestrator launches Chromium and starts a Computer Use loop with Claude as the agent.
3. Claude takes screenshots, decides actions, the orchestrator executes them on the Playwright `Page`.
4. When Claude needs information (credentials, MFA, "is this the right client?"), it calls the custom `ask_user` tool. The orchestrator queues a prompt on the Acumon session row; Acumon's UI surfaces an inline form; the user answers; the answer comes back and Claude continues.
5. When Claude has the file downloaded, it calls `submit_done` with the local path. The orchestrator reads the bytes, POSTs them to `/api/internal/handoff/[sessionId]/submit` on Acumon. Acumon stores the archive, runs AI extraction, and the user's modal auto-advances to the Review screen.
6. On unrecoverable error: Claude calls `fail` (or the orchestrator hits an exception) → `POST /api/internal/handoff/[sessionId]/fail` flips the session to `failed` and the modal shows the message.

## What does and doesn't get persisted

Persisted on Acumon DB:
- Session metadata (engagementId, firmId, userId, vendorLabel, status, progress).
- The downloaded archive (as `AuditDocument` blob in Azure Storage).
- A per-(firm, vendor, client) `VendorRecipe` — the URL we ended on, plus future expansions. Used to short-circuit discovery on subsequent imports for the same client.

NOT persisted:
- User-supplied vendor credentials. Sent to the orchestrator container only for the live session, used once, not written to disk.
- MFA codes. Same.
- Cookies / session tokens from the vendor's site. The browser context is destroyed at the end of every session.

The container itself runs as a non-root user, with the browser tearing down on every request. There is no per-user persistent state.

## Security model

- Acumon → orchestrator: shared secret in `X-Orchestrator-Secret`, constant-time compared.
- Orchestrator → Acumon: same shared secret in the same header, in the opposite direction.
- Orchestrator → Anthropic: `ANTHROPIC_API_KEY` from env, per-request bearer.
- Browser: clean profile per session (no `--user-data-dir`), `--no-sandbox` only inside the container's own sandbox (the Playwright base image runs as a non-root user).

The shared secret is the load-bearing thing here. **Generate it with `openssl rand -base64 32` and store it in your secret manager — do not check it in.**

## Cost

Per session, very roughly:
- Anthropic Computer Use API: 50–200 tool calls × ~$0.003 each ≈ £0.10–0.40.
- Container Apps runtime: ~5 minutes × £0.10/hour-ish ≈ pennies.
- Outbound bandwidth (file submission): negligible.

Total per import: **probably £0.20–0.60** depending on how many screenshots Claude takes. Sessions that need extensive ask_user round-trips are slower but not significantly more expensive.

## What needs MyWorkPapers (or any vendor) test access?

The first import for any new (firm, vendor, client) tuple runs in "discover" mode — Claude figures out the navigation from screenshots and asks the user to confirm. This works without test access; you just observe whether the auto-discovery succeeds and intervene via prompts when it doesn't.

After the first successful import the recipe is saved; subsequent imports follow it. Over time you accumulate a robust recipe per vendor without ever asking the vendor for an API key.
