'use client';

import { useState, useEffect, useCallback } from 'react';
import type { AuditType } from '@/types/methodology';
import { AUDIT_TYPE_LABELS } from '@/types/methodology';
import type { EngagementData } from '@/hooks/useEngagement';
import { TeamPanel } from '../panels/TeamPanel';
import { ClientContactsPanel } from '../panels/ClientContactsPanel';
import { ConnectorSetupModal } from '../panels/ConnectorSetupModal';
import { AuditTimetablePanel } from '../panels/AuditTimetablePanel';

// Extended type for info requests that may have a receivedAt field
type InfoRequestWithReceived = { receivedAt?: string | null };

interface ConnectionStatus {
  connected: boolean;
  system?: string;
  orgName?: string;
  connectedBy?: string;
  connectedAt?: string;
  expiresAt?: string;
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

interface Props {
  engagement: EngagementData;
  auditType: AuditType;
  clientName: string;
  periodEndDate: string | null;
  onEngagementUpdate?: (updated: EngagementData) => void;
  onShowCategoryChange?: (show: boolean) => void;
}

export function OpeningTab({ engagement, auditType, clientName, periodEndDate, onEngagementUpdate, onShowCategoryChange }: Props) {
  const [isGroupAudit, setIsGroupAudit] = useState(engagement.isGroupAudit);
  const [showCategory, setShowCategory] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connection, setConnection] = useState<ConnectionStatus | null>(null);
  const [connLoading, setConnLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showConnectorModal, setShowConnectorModal] = useState(false);
  const [enabledSystems, setEnabledSystems] = useState<string[]>([]);

  useEffect(() => {
    setIsGroupAudit(engagement.isGroupAudit);
  }, [engagement.isGroupAudit]);

  // Load firm's enabled connectors
  useEffect(() => {
    async function loadEnabledConnectors() {
      try {
        const res = await fetch('/api/firm/connectors');
        if (res.ok) {
          const data = await res.json();
          setEnabledSystems(data.enabledConnectors || []);
        }
      } catch {}
    }
    loadEnabledConnectors();
  }, []);

  // Load accounting connection status (also triggers after OAuth redirect)
  useEffect(() => {
    async function loadConnection() {
      try {
        const res = await fetch(`/api/accounting/xero/status?clientId=${engagement.clientId}`);
        if (res.ok) {
          const data = await res.json();
          setConnection(data);
          // If just returned from OAuth, show success
          const params = new URLSearchParams(window.location.search);
          if (params.get('xeroConnected') === 'true' && data.connected) {
            setTestResult({ ok: true, message: `Successfully connected to ${data.orgName || 'Xero'}` });
            // Clean up URL
            const cleanUrl = window.location.pathname;
            window.history.replaceState({}, '', cleanUrl);
          }
          if (params.get('xeroError')) {
            setTestResult({ ok: false, message: `Connection failed: ${params.get('xeroError')}` });
            window.history.replaceState({}, '', window.location.pathname);
          }
        }
      } catch (err) {
        console.error('Failed to load connection status:', err);
      } finally {
        setConnLoading(false);
      }
    }
    loadConnection();
  }, [engagement.clientId]);

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/accounting/xero/status?clientId=${engagement.clientId}`);
      if (res.ok) {
        const data = await res.json();
        setConnection(data);
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

  const [disconnecting, setDisconnecting] = useState(false);

  async function handleDisconnect() {
    if (!confirm('Are you sure you want to disconnect the Xero connection for this client? This will revoke access and remove stored tokens.')) return;
    setDisconnecting(true);
    try {
      const res = await fetch('/api/accounting/xero/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: engagement.clientId }),
      });
      if (res.ok) {
        setConnection({ connected: false });
        setTestResult({ ok: true, message: 'Xero connection disconnected successfully' });
      } else {
        const data = await res.json();
        setTestResult({ ok: false, message: data.error || 'Failed to disconnect' });
      }
    } catch {
      setTestResult({ ok: false, message: 'Disconnect request failed' });
    } finally {
      setDisconnecting(false);
    }
  }

  function handleRenewConnection() {
    // For Xero (OAuth), redirect directly with returnUrl so user comes back here
    if (connection?.system?.toLowerCase() === 'xero') {
      handleConnectXero();
      return;
    }
    setShowConnectorModal(true);
  }

  /** Start the Xero OAuth flow. Used by both the initial "Connect
   *  with Xero" button (when there's no existing connection) and by
   *  "Renew Connection" on an existing one. Builds the returnUrl
   *  from the LIVE window location at click time — the previous
   *  implementation computed it inline on the `<a href>` which
   *  sometimes produced `periodId=undefined` when the prop hadn't
   *  fully hydrated, making the callback redirect land on the
   *  engagement chooser instead of back on the tab. */
  function handleConnectXero() {
    if (!engagement?.clientId) {
      alert('Cannot connect — no client id on this engagement. Please reopen the engagement and try again.');
      return;
    }
    const back = new URL(window.location.href);
    back.searchParams.set('tab', 'opening');
    if (engagement.periodId) back.searchParams.set('periodId', engagement.periodId);
    // Keep clientId in the URL too — AuditEngagementPage's auto-open
    // relies on both clientId + periodId being present to re-hydrate
    // the engagement after the OAuth round-trip.
    back.searchParams.set('clientId', engagement.clientId);
    const returnUrl = back.pathname + back.search;
    const connectUrl = `/api/accounting/xero/connect?clientId=${encodeURIComponent(engagement.clientId)}&returnUrl=${encodeURIComponent(returnUrl)}`;
    console.log('[Xero] Redirecting to', connectUrl);
    window.location.href = connectUrl;
  }

  function handleConnectorSetupComplete() {
    // Reload connection status after successful setup
    setConnLoading(true);
    setTestResult(null);
    fetch(`/api/accounting/xero/status?clientId=${engagement.clientId}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setConnection(data); })
      .catch(() => {})
      .finally(() => setConnLoading(false));
  }

  async function updateSetting(field: string, value: boolean | string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/engagements/${engagement.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) {
        const data = await res.json();
        if (onEngagementUpdate) onEngagementUpdate(data.engagement);
      }
    } catch (err) {
      console.error('Failed to update setting:', err);
    } finally {
      setSaving(false);
    }
  }

  const mainContact = engagement.contacts.find(c => c.isMainContact) || engagement.contacts[0];

  // Team members may have userName directly or nested user.name from API
  type MemberWithUser = typeof engagement.teamMembers[number] & { user?: { name: string; email: string } };
  function getMemberName(m: MemberWithUser) {
    return m.userName || m.user?.name || m.userId;
  }
  const riMembers = engagement.teamMembers.filter(m => m.role === 'RI') as MemberWithUser[];
  const managers = engagement.teamMembers.filter(m => m.role === 'Manager') as MemberWithUser[];
  const juniors = engagement.teamMembers.filter(m => m.role === 'Junior') as MemberWithUser[];

  const startedDate = engagement.startedAt ? new Date(engagement.startedAt).toLocaleDateString('en-GB') : null;
  const createdDate = new Date(engagement.createdAt).toLocaleDateString('en-GB');

  return (
    <div className="space-y-6">
      {/* Header Summary */}
      <div className="grid grid-cols-3 gap-6">
        {/* Engagement Details */}
        <div className="bg-slate-50 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-3 border-b border-slate-200 pb-2">Engagement Details</h3>
          <dl className="space-y-2 text-xs">
            <div className="flex justify-between">
              <dt className="text-slate-500">Audit Type</dt>
              <dd className="font-medium text-slate-800">{AUDIT_TYPE_LABELS[auditType]}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Client</dt>
              <dd className="font-medium text-slate-800">{clientName}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Period End</dt>
              <dd className="font-medium text-slate-800">{periodEndDate ? new Date(periodEndDate).toLocaleDateString('en-GB') : '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Status</dt>
              <dd>
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  engagement.status === 'active' ? 'bg-green-100 text-green-700' :
                  engagement.status === 'review' ? 'bg-blue-100 text-blue-700' :
                  engagement.status === 'complete' ? 'bg-slate-100 text-slate-700' :
                  'bg-yellow-100 text-yellow-700'
                }`}>
                  {engagement.status === 'pre_start' ? 'SET UP' : engagement.status.toUpperCase()}
                </span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Created</dt>
              <dd className="text-slate-700">{createdDate}</dd>
            </div>
            {startedDate && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Started</dt>
                <dd className="text-slate-700">{startedDate}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-slate-500">Info Request</dt>
              <dd className="font-medium text-slate-800 capitalize">{engagement.infoRequestType}</dd>
            </div>
            {engagement.hardCloseDate && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Hard Close</dt>
                <dd className="text-slate-700">{new Date(engagement.hardCloseDate).toLocaleDateString('en-GB')}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* Client Contacts - editable */}
        <div>
          <ClientContactsPanel
            engagementId={engagement.id}
            clientId={engagement.clientId}
            initialContacts={engagement.contacts}
          />
        </div>

        {/* Team - editable */}
        <div>
          <TeamPanel
            engagementId={engagement.id}
            initialTeamMembers={engagement.teamMembers.map(m => ({
              id: m.id,
              userId: m.userId,
              role: m.role,
              userName: getMemberName(m as MemberWithUser),
              userEmail: m.userEmail || (m as MemberWithUser).user?.email,
            }))}
            initialSpecialists={engagement.specialists}
          />
        </div>
      </div>

      {/* Audit File Settings */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Audit File Settings</h3>
        <div className="grid grid-cols-2 gap-6">
          {/* Group Audit Toggle */}
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-slate-700">Part of a Group Audit</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Enables Group Name column in Trial Balance and group-specific procedures
              </p>
            </div>
            <button
              onClick={() => {
                const newVal = !isGroupAudit;
                setIsGroupAudit(newVal);
                updateSetting('isGroupAudit', newVal);
              }}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                isGroupAudit ? 'bg-blue-500' : 'bg-slate-300'
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                isGroupAudit ? 'translate-x-5' : ''
              }`} />
            </button>
          </div>

          {/* Category Column Toggle */}
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-slate-700">Show Category Column</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Display the Category column in the Trial Balance tab
              </p>
            </div>
            <button
              onClick={() => {
                const newVal = !showCategory;
                setShowCategory(newVal);
                onShowCategoryChange?.(newVal);
              }}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                showCategory ? 'bg-blue-500' : 'bg-slate-300'
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                showCategory ? 'translate-x-5' : ''
              }`} />
            </button>
          </div>

          {/* Controls-based flag */}
          {(auditType === 'SME_CONTROLS' || auditType === 'PIE_CONTROLS') && (
            <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg col-span-2">
              <div>
                <p className="text-sm font-medium text-blue-700">Controls-Based Audit</p>
                <p className="text-xs text-blue-500 mt-0.5">
                  This is a controls-based audit. The RMM tab will include control testing columns and Risk Control assessments will be enabled.
                </p>
              </div>
              <span className="text-xs font-medium text-blue-600 bg-blue-100 px-2 py-1 rounded">Enabled</span>
            </div>
          )}
        </div>
      </div>

      {/* Information Requests Summary */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">
          Initial Information Request
          <span className="ml-2 text-xs font-normal text-slate-400 capitalize">({engagement.infoRequestType})</span>
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {engagement.informationRequests
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map(req => {
              // isIncluded = requested, receivedAt would indicate received (future field)
              const received = (req as InfoRequestWithReceived).receivedAt;
              return (
                <div key={req.id} className="flex items-center gap-2 text-xs py-1">
                  <span className={`w-4 h-4 rounded flex items-center justify-center text-[10px] ${
                    !req.isIncluded ? 'bg-slate-100 text-slate-400' :
                    received ? 'bg-green-100 text-green-600' :
                    'bg-orange-100 text-orange-600'
                  }`}>
                    {!req.isIncluded ? '—' : received ? '✓' : '○'}
                  </span>
                  <span className={req.isIncluded ? 'text-slate-700' : 'text-slate-400 line-through'}>{req.description}</span>
                  {req.isIncluded && !received && (
                    <span className="text-[10px] text-orange-500">Pending</span>
                  )}
                  {received && (
                    <span className="text-[10px] text-green-500">Received</span>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {/* Bottom row: Audit Timetable (left, wider) + Accounting Connection (right).
          Audit Timetable is the primary engagement-setup artefact so it
          gets more horizontal real estate; the connection status is
          compact and fine squeezed to the right third. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <AuditTimetablePanel
            engagementId={engagement.id}
            initialDates={engagement.agreedDates}
          />
        </div>
        <div className="lg:col-span-1">

      {/* Accounting Connection */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 h-full">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Accounting Connection</h3>
        {connLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <div className="animate-spin w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full" />
            Loading connection status...
          </div>
        ) : connection?.connected ? (
          <div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-xs font-medium text-green-700">Connected</span>
                {connection.system && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded font-medium uppercase">
                    {connection.system}
                  </span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-4 text-xs mb-4">
              <div>
                <span className="text-slate-500 block">Organisation</span>
                <span className="text-slate-700 font-medium">{connection.orgName || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Connected by</span>
                <span className="text-slate-700">{connection.connectedBy || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Connected</span>
                <span className="text-slate-700">{connection.connectedAt ? formatDateTime(connection.connectedAt) : '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Expires</span>
                <span className="text-slate-700">{connection.expiresAt ? formatDateTime(connection.expiresAt) : '—'}</span>
              </div>
            </div>
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
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="text-xs px-3 py-1.5 bg-red-50 text-red-600 rounded-md hover:bg-red-100 font-medium disabled:opacity-50"
              >
                {disconnecting ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
            {testResult && (
              <div className={`mt-2 text-xs px-3 py-2 rounded ${
                testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}>
                {testResult.message}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-slate-300" />
              <span className="text-xs font-medium text-slate-500">Not Connected</span>
            </div>
            <p className="text-xs text-slate-400 mb-3">Connect to your client's accounting system to import trial balance data and automate evidence gathering.</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleConnectXero}
                className="inline-flex items-center gap-1.5 text-xs px-4 py-2 bg-[#13B5EA] text-white rounded-md hover:bg-[#0e9fd0] font-medium"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.41 15.41L7.17 14l1.41-1.41L11 15.17l4.59-4.59L17 12l-6.41 6.41z"/></svg>
                Connect with Xero
              </button>
              <button
                onClick={() => setShowConnectorModal(true)}
                className="text-xs px-4 py-1.5 border border-slate-200 text-slate-600 rounded-md hover:bg-slate-50 font-medium"
              >
                Other Systems
              </button>
            </div>
          </div>
        )}
      </div>
        </div>
      </div>

      {/* Connector Setup Modal */}
      <ConnectorSetupModal
        isOpen={showConnectorModal}
        onClose={() => setShowConnectorModal(false)}
        clientId={engagement.clientId}
        enabledSystems={enabledSystems}
        onConnected={handleConnectorSetupComplete}
      />
    </div>
  );
}
