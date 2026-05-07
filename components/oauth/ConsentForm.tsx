'use client';

import { useState } from 'react';

interface Props {
  clientId: string;
  redirectUri: string;
  state?: string;
  scope?: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource?: string;
}

export function ConsentForm({ clientId, redirectUri, state, scope, codeChallenge, codeChallengeMethod, resource }: Props) {
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(decision: 'approve' | 'deny') {
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch('/api/oauth/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          clientId,
          redirectUri,
          state,
          scope,
          codeChallenge,
          codeChallengeMethod,
          resource,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error_description || json.error || `Authorization failed (${res.status})`);
      // Server returns the redirect target — we navigate the browser there
      // so the OAuth client picks up the auth code (or error) on its
      // configured redirect_uri.
      if (typeof json.redirect === 'string') {
        window.location.href = json.redirect;
      } else {
        throw new Error('Server did not return a redirect URL');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authorization failed');
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{error}</div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={() => void submit('deny')}
          disabled={busy !== null}
          className="text-sm px-4 py-2 text-slate-600 hover:text-slate-800 disabled:opacity-50"
        >
          {busy === 'deny' ? 'Cancelling…' : 'Cancel'}
        </button>
        <button
          onClick={() => void submit('approve')}
          disabled={busy !== null}
          className="text-sm px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
        >
          {busy === 'approve' ? 'Approving…' : 'Approve'}
        </button>
      </div>
    </div>
  );
}
