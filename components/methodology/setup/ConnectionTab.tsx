'use client';

import { useState, useEffect, useCallback } from 'react';

interface XeroStatus {
  connected: boolean;
  orgName?: string;
  connectedBy?: string;
  connectedAt?: string;
  expiresAt?: string;
}

interface Props {
  clientId: string;
  clientName: string;
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function ConnectionTab({ clientId, clientName }: Props) {
  const [status, setStatus] = useState<XeroStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showConfirm, setShowConfirm] = useState<'disconnect' | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/accounting/xero/status?clientId=${clientId}`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (err) {
      console.error('Failed to load Xero status:', err);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    setLoading(true);
    setTestResult(null);
    loadStatus();
  }, [loadStatus]);

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/accounting/xero/status?clientId=${clientId}`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        setTestResult(data.connected
          ? { ok: true, message: `Connected to ${data.orgName}` }
          : { ok: false, message: 'Not connected' }
        );
      } else {
        setTestResult({ ok: false, message: 'Failed to check connection' });
      }
    } catch {
      setTestResult({ ok: false, message: 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  }

  function handleRenewConnection() {
    window.location.href = `/api/accounting/xero/connect?clientId=${clientId}`;
  }

  function handleConnect() {
    window.location.href = `/api/accounting/xero/connect?clientId=${clientId}`;
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/accounting/xero/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      if (res.ok) {
        setStatus({ connected: false });
        setTestResult(null);
      }
    } catch (err) {
      console.error('Failed to disconnect:', err);
    } finally {
      setDisconnecting(false);
      setShowConfirm(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200">
      <div className="px-4 py-3 border-b border-slate-200">
        <h3 className="text-sm font-semibold text-slate-800">Xero Connection</h3>
      </div>

      <div className="p-4">
        {status?.connected ? (
          <>
            {/* Connected status */}
            <div className="space-y-3 mb-6">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                <span className="text-sm font-medium text-green-700">Connected</span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-xs text-slate-500 block">Organisation</span>
                  <span className="text-slate-700 font-medium">{status.orgName || '-'}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">Connected by</span>
                  <span className="text-slate-700">{status.connectedBy || '-'}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">Connected</span>
                  <span className="text-slate-700">{status.connectedAt ? formatDateTime(status.connectedAt) : '-'}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">Expires</span>
                  <span className="text-slate-700">{status.expiresAt ? formatDateTime(status.expiresAt) : '-'}</span>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleTestConnection}
                disabled={testing}
                className="text-xs px-3 py-1.5 bg-slate-100 text-slate-700 rounded-md hover:bg-slate-200 font-medium disabled:opacity-50"
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              <button
                onClick={handleRenewConnection}
                className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100 font-medium"
              >
                Renew Connection
              </button>
              <button
                onClick={() => setShowConfirm('disconnect')}
                className="text-xs px-3 py-1.5 bg-red-50 text-red-600 rounded-md hover:bg-red-100 font-medium"
              >
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Not connected */}
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
              <span className="text-sm font-medium text-slate-500">Not Connected</span>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Connect {clientName} to Xero to access accounting data.
            </p>
            <button
              onClick={handleConnect}
              className="text-xs px-4 py-2 bg-[#13b5ea] text-white rounded-md hover:bg-[#0fa2d3] font-medium"
            >
              Connect to Xero
            </button>
          </>
        )}

        {/* Test result */}
        {testResult && (
          <div className={`mt-3 text-xs px-3 py-2 rounded ${
            testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}>
            {testResult.message}
          </div>
        )}
      </div>

      {/* Disconnect confirmation modal */}
      {showConfirm === 'disconnect' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4">
            <h4 className="text-sm font-semibold text-slate-800 mb-2">Disconnect Xero?</h4>
            <p className="text-xs text-slate-500 mb-4">
              This will revoke the Xero connection for {clientName}. You can reconnect later.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowConfirm(null)}
                className="text-xs px-3 py-1.5 bg-slate-100 text-slate-600 rounded-md hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="text-xs px-3 py-1.5 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                {disconnecting ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
