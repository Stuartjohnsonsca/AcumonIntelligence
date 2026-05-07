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
        <h1 className="text-2xl font-bold text-slate-900">Connect Acumon to your AI Browser Assistant</h1>
        <p className="text-slate-600 text-sm mt-1">
          One-time setup. After this, opening a new audit and clicking Connect to Cloud Audit
          Software lets your assistant fetch the prior period file straight into acumon — no
          credentials shared with us, no copy-paste.
        </p>
      </div>

      <div className="space-y-6">
        <Section number={1} title="Use an AI assistant with the Model Context Protocol (MCP)">
          <p>
            Any assistant that supports MCP (e.g. <strong>Claude Cowork with the Claude in Chrome
            extension installed</strong>) can drive your browser tab and call back into acumon. You
            still log in to MyWorkPapers / your vendor in your own browser; the assistant never sees
            your password.
          </p>
        </Section>

        <Section number={2} title="Add the Acumon MCP server">
          <p>In your AI assistant&apos;s settings, register a new MCP server with these values:</p>
          <dl className="mt-3 grid grid-cols-[140px_1fr] gap-y-2 gap-x-3 text-xs">
            <dt className="font-medium text-slate-600">Server name</dt>
            <dd><code className="bg-slate-100 px-1.5 py-0.5 rounded">Acumon Audit Import</code></dd>
            <dt className="font-medium text-slate-600">Endpoint URL</dt>
            <dd><code className="bg-slate-100 px-1.5 py-0.5 rounded">{mcpEndpoint}</code></dd>
            <dt className="font-medium text-slate-600">Transport</dt>
            <dd>HTTP (JSON-RPC 2.0)</dd>
            <dt className="font-medium text-slate-600">Auth header</dt>
            <dd><code className="bg-slate-100 px-1.5 py-0.5 rounded">Authorization: Bearer &lt;session token&gt;</code></dd>
          </dl>
          <p className="mt-3 text-xs text-slate-500 italic">
            The session token is generated for you when you click Connect to Cloud Audit Software in
            an engagement. Each token is one-time, scoped to a single import, and expires after 30
            minutes — paste it into the assistant when prompted.
          </p>
        </Section>

        <Section number={3} title="Run an import">
          <ol className="list-decimal list-inside space-y-1">
            <li>Open the engagement in acumon. The Import Options pop-up appears (or click <em>Import External Audit File</em> on the Prior Period tab to re-run later).</li>
            <li>Pick <strong>Connect to Cloud Audit Software</strong> and choose your vendor (or use Other Cloud Audit Software for a one-off).</li>
            <li>Acumon shows a session token. Copy it.</li>
            <li>Open your AI assistant&apos;s sidebar and tell it: <em>&ldquo;Run the Acumon import session. Token: &lt;paste&gt;&rdquo;</em>.</li>
            <li>The assistant will read the engagement context, ask you to confirm the vendor tab is open and logged in, navigate to the prior period, download the archive, and submit it back to acumon.</li>
            <li>Acumon&apos;s Review pop-up opens automatically — you approve / edit / delete proposed values, the orange dashed surround marks AI-populated fields.</li>
          </ol>
        </Section>

        <Section number={4} title="What the assistant can and can't do">
          <p>The MCP server exposes only two tools:</p>
          <ul className="list-disc list-inside space-y-1 mt-2">
            <li><code className="bg-slate-100 px-1.5 py-0.5 rounded">get_session_context</code> — returns the engagement client name, period end, and target vendor.</li>
            <li><code className="bg-slate-100 px-1.5 py-0.5 rounded">submit_archive</code> — accepts the downloaded file (max 25 MB) and closes the session.</li>
          </ul>
          <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            The assistant cannot read or modify any other engagement data, list other clients, or
            access another firm&apos;s engagements via this server. It also cannot enter your vendor
            password — when its session token is consumed by submit_archive the session is closed
            and any further calls are rejected.
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
