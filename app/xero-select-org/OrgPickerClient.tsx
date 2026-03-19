'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Tenant {
  tenantId: string;
  tenantName: string;
  createdDateUtc?: string;
}

export function OrgPickerClient({
  pendingId,
  clientName,
  tenants,
}: {
  pendingId: string;
  clientName: string;
  tenants: Tenant[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  async function handleConfirm() {
    if (!selected) return;
    setConfirming(true);
    setError('');

    try {
      const res = await fetch('/api/accounting/xero/confirm-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingId, tenantId: selected }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to confirm organisation');
        setConfirming(false);
        return;
      }

      const data = await res.json();
      router.push(data.redirectUrl || '/tools/data-extraction?xeroConnected=true');
    } catch {
      setError('Network error. Please try again.');
      setConfirming(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full p-8">
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-900">Select Xero Organisation</h1>
          <p className="text-sm text-slate-500 mt-2">
            Choose which Xero organisation to connect for <strong>{clientName}</strong>
          </p>
        </div>

        <div className="space-y-2 mb-6">
          {tenants.map((t) => (
            <button
              key={t.tenantId}
              onClick={() => setSelected(t.tenantId)}
              className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${
                selected === t.tenantId
                  ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <div className="font-medium text-slate-900">{t.tenantName}</div>
              {t.createdDateUtc && (
                <div className="text-xs text-slate-400 mt-0.5">
                  Connected {new Date(t.createdDateUtc).toLocaleDateString()}
                </div>
              )}
            </button>
          ))}
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            {error}
          </div>
        )}

        <button
          onClick={handleConfirm}
          disabled={!selected || confirming}
          className={`w-full py-3 px-4 rounded-lg font-medium text-white transition-all ${
            selected && !confirming
              ? 'bg-blue-600 hover:bg-blue-700 cursor-pointer'
              : 'bg-slate-300 cursor-not-allowed'
          }`}
        >
          {confirming ? 'Connecting...' : 'Connect this organisation'}
        </button>

        <button
          onClick={() => router.push('/tools/data-extraction')}
          className="w-full mt-3 py-2 px-4 text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
