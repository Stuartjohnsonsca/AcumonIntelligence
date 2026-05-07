import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

export default async function McpSetupPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/cloud-audit-connectors/mcp-setup');
  }

  const h = await headers();
  const proto = h.get('x-forwarded-proto') || 'https';
  const host = h.get('x-forwarded-host') || h.get('host') || 'acumonintelligence.com';
  const mcpEndpoint = `${proto}://${host}/api/mcp`;

  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Connect your AI assistant to Acumon</h1>
        <p className="text-slate-600 text-sm mt-1">
          One-time setup per user. After you&apos;ve added Acumon as a custom integration in your AI
          assistant, clicking <em>Connect to Cloud Audit Software</em> in any engagement just
          works — no copy-pasting tokens, no instructions to run. Your assistant fetches the prior
          audit file and drops it back into acumon while you watch.
        </p>
      </div>

      <div className="space-y-6">
        <Section number={1} title="Use an AI assistant that supports custom MCP integrations">
          <p>
            You need an assistant that lets you add a custom Model Context Protocol (MCP) server with
            OAuth — not all assistants or plans expose this. Known to work:
          </p>
          <ul className="list-disc list-inside space-y-0.5 mt-2">
            <li><strong>Claude Cowork</strong> with the Claude in Chrome extension installed.</li>
            <li><strong>claude.ai</strong> on Pro / Team / Enterprise plans (Settings → Connectors → Add custom integration).</li>
            <li><strong>Claude Code</strong> CLI (<code>claude mcp add --transport http acumon {mcpEndpoint}</code>).</li>
          </ul>
          <p className="mt-2 text-[11px] text-slate-500 italic">
            Free-tier assistants generally cannot add custom MCP servers; the manual mode (copy prompt + drag file)
            still works for everyone.
          </p>
        </Section>

        <Section number={2} title="Add the Acumon MCP server (OAuth)">
          <p>In your assistant&apos;s Connectors / Integrations / MCP settings, add a new server with:</p>
          <dl className="mt-3 grid grid-cols-[140px_1fr] gap-y-2 gap-x-3 text-xs">
            <dt className="font-medium text-slate-600">Name</dt>
            <dd><code className="bg-slate-100 px-1.5 py-0.5 rounded">Acumon Audit Import</code></dd>
            <dt className="font-medium text-slate-600">URL</dt>
            <dd><code className="bg-slate-100 px-1.5 py-0.5 rounded">{mcpEndpoint}</code></dd>
            <dt className="font-medium text-slate-600">Transport</dt>
            <dd>HTTP (Streamable)</dd>
            <dt className="font-medium text-slate-600">Authentication</dt>
            <dd>OAuth 2.1 (the assistant discovers the auth server automatically)</dd>
          </dl>
          <p className="mt-3 text-xs text-slate-600">
            Your assistant will redirect you to Acumon to sign in and approve the connector — that&apos;s
            the consent screen at <code className="bg-slate-100 px-1.5 py-0.5 rounded">/oauth/authorize</code>.
            Approving issues the assistant a renewable token bound to your account; you can revoke it
            anytime from Acumon&apos;s settings.
          </p>
        </Section>

        <Section number={3} title="Run an import">
          <ol className="list-decimal list-inside space-y-1">
            <li>Open the engagement in acumon. The Import Options pop-up appears (or click <em>Import External Audit File</em> on the Prior Period tab to re-run later).</li>
            <li>Pick <strong>Connect to Cloud Audit Software</strong> and choose your vendor.</li>
            <li>Acumon shows &ldquo;Import session ready&rdquo;.</li>
            <li>Open your AI assistant&apos;s sidebar in Chrome (with the vendor tab also open and you logged in). Tell it: <em>&ldquo;Run my pending Acumon import session&rdquo;</em>.</li>
            <li>The assistant calls Acumon&apos;s MCP tools, navigates the vendor&apos;s site, downloads the archive, and submits it back to acumon.</li>
            <li>Acumon&apos;s Review pop-up opens automatically — you approve, edit, or delete proposed values; AI-populated fields render with an orange dashed surround.</li>
          </ol>
        </Section>

        <Section number={4} title="What the assistant can and can't do">
          <p>The Acumon MCP server exposes only three tools:</p>
          <ul className="list-disc list-inside space-y-1 mt-2">
            <li><code className="bg-slate-100 px-1.5 py-0.5 rounded">list_pending_sessions</code> — shows your open import sessions (sessions you started in acumon).</li>
            <li><code className="bg-slate-100 px-1.5 py-0.5 rounded">get_session_context</code> — engagement client + period + vendor for one session.</li>
            <li><code className="bg-slate-100 px-1.5 py-0.5 rounded">submit_archive</code> — accepts the downloaded file (max 25 MB) and closes the session.</li>
          </ul>
          <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            The assistant cannot read or modify any other engagement data, list other clients, list other
            users&apos; sessions, or access anything in acumon outside the OAuth scopes you approved. It
            cannot enter your vendor password or MFA code — those stay in your browser. Revoke at any
            time from Settings → Connected apps.
          </p>
        </Section>

        <Section number={5} title="Don't have an MCP-capable assistant?">
          <p>
            The <strong>Manual mode</strong> link inside the import pop-up still works. It gives you a
            prompt to paste into any AI tool plus a drop-zone for the file the tool downloads — no
            integration setup required, just more copy-pasting.
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-lg p-5">
      <h2 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-5 h-5 bg-blue-100 text-blue-700 rounded-full text-[10px] font-bold">{number}</span>
        {title}
      </h2>
      <div className="text-xs text-slate-600 space-y-2 leading-relaxed">{children}</div>
    </section>
  );
}
