// /oauth/authorize — consent screen the user lands on when their AI
// assistant adds the Acumon MCP server. Validates the OAuth params,
// shows the user which client is asking, and on Approve issues a
// short-lived auth code that the client trades for tokens at /token.
//
// This is a server component for the validation + login gating; the
// approve/cancel buttons are wired to a small client component.

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ConsentForm } from '@/components/oauth/ConsentForm';

interface SearchParams {
  client_id?: string;
  redirect_uri?: string;
  response_type?: string;
  state?: string;
  scope?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  resource?: string;
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const session = await auth();

  // 1. Require authentication. Anything other than 2FA-verified bounces
  // through /login with a callback that brings the user right back here.
  if (!session?.user?.twoFactorVerified) {
    const callbackUrl = `/oauth/authorize?${new URLSearchParams(params as Record<string, string>).toString()}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  // 2. Validate parameters before we render anything we'd hate to show.
  const errors: string[] = [];
  if (params.response_type !== 'code') errors.push('response_type must be "code"');
  if (!params.client_id) errors.push('client_id is required');
  if (!params.redirect_uri) errors.push('redirect_uri is required');
  if (!params.code_challenge) errors.push('code_challenge is required (PKCE)');
  if (params.code_challenge_method !== 'S256') errors.push('code_challenge_method must be "S256"');

  let clientName = '';
  if (params.client_id && !errors.length) {
    const client = await prisma.oAuthClient.findUnique({ where: { clientId: params.client_id } });
    if (!client) errors.push('Unknown client_id');
    else if (client.firmId && client.firmId !== session.user.firmId) {
      errors.push('This connector is restricted to a different firm');
    } else if (Array.isArray(client.redirectUris)
      && !(client.redirectUris as string[]).includes(params.redirect_uri || '')) {
      errors.push('redirect_uri does not match any registered URI for this client');
    } else {
      clientName = client.clientName;
    }
  }

  if (errors.length > 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm max-w-md w-full p-6">
          <h1 className="text-lg font-semibold text-slate-800 mb-2">Authorization request invalid</h1>
          <ul className="text-sm text-red-700 list-disc list-inside space-y-1">
            {errors.map(e => <li key={e}>{e}</li>)}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm max-w-md w-full p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Authorize {clientName}</h1>
          <p className="text-xs text-slate-500 mt-1">
            <strong>{clientName}</strong> is asking for access to your acumon account so it can
            run prior-period audit imports on your behalf.
          </p>
        </div>

        <div className="border border-slate-200 rounded p-3 bg-slate-50 text-xs text-slate-700 space-y-1.5">
          <p className="font-medium text-slate-800">It will be able to:</p>
          <ul className="list-disc list-inside space-y-0.5 text-slate-600">
            <li>Read the engagement context (client name, period, vendor) for import sessions <em>you start</em>.</li>
            <li>Submit a downloaded prior audit file back to acumon for those sessions.</li>
            <li>List import sessions you have currently pending.</li>
          </ul>
          <p className="font-medium text-slate-800 pt-2">It will NOT be able to:</p>
          <ul className="list-disc list-inside space-y-0.5 text-slate-600">
            <li>See or modify any other engagement, client, document, or firm-wide setting.</li>
            <li>Read other users&apos; sessions, even within your firm.</li>
            <li>Continue to act after you revoke access (Settings → Connected apps).</li>
          </ul>
        </div>

        <p className="text-[11px] text-slate-500 italic">
          Signed in as <strong>{session.user.name || session.user.email}</strong>. Approving issues a
          renewable token to {clientName} that expires after 30 days of inactivity. You can revoke at any time.
        </p>

        <ConsentForm
          clientId={params.client_id!}
          redirectUri={params.redirect_uri!}
          state={params.state}
          scope={params.scope}
          codeChallenge={params.code_challenge!}
          codeChallengeMethod={params.code_challenge_method!}
          resource={params.resource}
        />
      </div>
    </div>
  );
}
