/**
 * HMLR Business Gateway — mutual-TLS transport.
 *
 * HMLR's gateway authenticates every caller via a client X.509
 * certificate (the standard "Generating a New Signed Certificate in
 * IIS 7" procedure HMLR documents — once you've followed it you have
 * a .pfx). For a Vercel-deployed Node app the workflow is:
 *
 *   1. Run `openssl pkcs12 -in your.pfx -clcerts -nokeys -out client.crt`
 *      to extract the cert as PEM.
 *   2. Run `openssl pkcs12 -in your.pfx -nocerts -nodes -out client.key`
 *      to extract the unencrypted private key as PEM.
 *   3. Concatenate the HMLR Root CA (liverootCA2017.cer) and Issuing
 *      CA (LR Issuing CA 2020.cer) into one PEM bundle. Convert with
 *      `openssl x509 -inform der -in liverootCA2017.cer -out root.pem`
 *      first if the files are .cer (DER).
 *   4. Paste the three PEM blocks into the HMLR Business Gateway
 *      connector under My Account → Aggregator Connectors.
 *
 * This module loads the connector and builds an `undici.Agent` with
 * the cert + key + CA bundle wired into Node's TLS layer. Every
 * `fetch` call to the gateway then passes the agent as `dispatcher`,
 * presenting the cert during the handshake and trusting only HMLR's
 * CA chain for the server cert.
 */

import { Agent } from 'undici';
import { getHmlrConnector, type HmlrConnector } from '@/lib/hmlr-client';

let cachedAgent: { agent: Agent; signature: string } | null = null;

// We cache the agent across requests but key the cache on a hash of
// the cert material so a connector update (rotated cert) invalidates
// the cached agent without a redeploy. The signature is a cheap
// length-and-prefix hash — enough to detect rotation without needing
// crypto.
function signatureFor(c: HmlrConnector): string {
  const head = (s: string) => s.slice(0, 32) + '|' + s.length;
  return [
    c.environment,
    c.baseUrl,
    head(c.clientCertPem),
    head(c.clientKeyPem),
    head(c.caBundlePem),
    c.clientKeyPassphrase ? head(c.clientKeyPassphrase) : 'no-pass',
  ].join('::');
}

export interface HmlrAgentStatus {
  configured: boolean;
  environment?: 'test' | 'live';
  baseUrl?: string;
  errorMessage?: string;
}

/**
 * Returns an undici Agent configured with the HMLR client cert,
 * private key, and CA bundle from the connector row, alongside the
 * resolved baseUrl + environment for the calling code to use.
 *
 * Returns `{ configured: false }` (and no agent) when the connector
 * isn't set up yet, or when the cert material fails to parse — the
 * latter case carries the parse error in `errorMessage` so the
 * connector "Test" UI can surface it cleanly.
 */
export async function getHmlrAgent(): Promise<{ status: HmlrAgentStatus; agent: Agent | null; baseUrl?: string }> {
  const connector = await getHmlrConnector();
  if (!connector) {
    return { status: { configured: false, errorMessage: 'HMLR Business Gateway connector not configured. Configure it under My Account → Aggregator Connectors.' }, agent: null };
  }

  const sig = signatureFor(connector);
  if (cachedAgent && cachedAgent.signature === sig) {
    return {
      status: { configured: true, environment: connector.environment, baseUrl: connector.baseUrl },
      agent: cachedAgent.agent,
      baseUrl: connector.baseUrl,
    };
  }

  // Tear down the previous agent so its socket pool doesn't leak.
  if (cachedAgent) {
    try { await cachedAgent.agent.close(); } catch { /* ignore */ }
    cachedAgent = null;
  }

  try {
    const agent = new Agent({
      // Connection-level TLS material. undici threads `connect`
      // straight through to Node's tls.connect, so cert / key /
      // passphrase / ca map directly. We DO NOT set
      // rejectUnauthorized: false — the whole point of supplying
      // the HMLR CA bundle is to validate the server cert against it.
      connect: {
        cert: connector.clientCertPem,
        key: connector.clientKeyPem,
        passphrase: connector.clientKeyPassphrase || undefined,
        ca: connector.caBundlePem,
        // HMLR's gateway is sensitive to TLS version negotiation;
        // setting minVersion explicitly avoids surprises if Node's
        // default ever drifts. TLSv1.2 is the lowest HMLR accepts.
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
      },
      // Reuse connections within a request burst — sampling actions
      // can fire 5–10 HMLR calls per property and the handshake is
      // expensive. Sane defaults; can be tuned later if needed.
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
    });
    cachedAgent = { agent, signature: sig };
    return {
      status: { configured: true, environment: connector.environment, baseUrl: connector.baseUrl },
      agent,
      baseUrl: connector.baseUrl,
    };
  } catch (err: any) {
    return {
      status: {
        configured: false,
        environment: connector.environment,
        baseUrl: connector.baseUrl,
        errorMessage: `Failed to build HMLR mTLS agent — check the cert / key / CA PEM blocks parse correctly: ${err?.message || String(err)}`,
      },
      agent: null,
    };
  }
}

/**
 * Convenience helper for the connector's Test button. Performs a
 * GET against the environment's splash URL and reports whether the
 * mTLS handshake succeeded. Doesn't make any billable HMLR calls —
 * just confirms the cert is accepted.
 */
export async function probeHmlrConnection(): Promise<{ ok: boolean; status?: number; environment?: string; errorMessage?: string }> {
  const { status, agent, baseUrl } = await getHmlrAgent();
  if (!status.configured || !agent || !baseUrl) {
    return { ok: false, errorMessage: status.errorMessage || 'HMLR connector not configured.' };
  }
  try {
    const res = await fetch(baseUrl, {
      method: 'GET',
      // @ts-expect-error — undici typing for fetch options doesn't
      // surface `dispatcher`, but Node's global fetch (built on
      // undici) accepts it when undici is imported. Documented at
      // https://undici.nodejs.org/#/docs/api/Dispatcher
      dispatcher: agent,
    });
    return { ok: res.ok || res.status === 401 || res.status === 403, status: res.status, environment: status.environment };
  } catch (err: any) {
    return { ok: false, environment: status.environment, errorMessage: err?.message || String(err) };
  }
}
