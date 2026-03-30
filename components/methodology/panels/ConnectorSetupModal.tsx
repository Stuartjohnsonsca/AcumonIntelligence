'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, Check, AlertCircle, Plug } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────
export interface AccountingConnector {
  id: string;
  system: string;        // e.g. 'xero', 'sage', 'quickbooks', 'myob'
  label: string;         // Display name
  enabled: boolean;      // Firm has enabled this connector
  connected?: boolean;   // Current connection status for a specific client
  fields: ConnectorField[];
}

export interface ConnectorField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url' | 'email';
  placeholder?: string;
  required?: boolean;
}

// Available connector definitions
export const AVAILABLE_CONNECTORS: Omit<AccountingConnector, 'id' | 'enabled' | 'connected'>[] = [
  {
    system: 'xero',
    label: 'Xero',
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text', placeholder: 'Xero App Client ID', required: true },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', placeholder: 'Xero App Client Secret', required: true },
      { key: 'tenantId', label: 'Tenant ID', type: 'text', placeholder: 'Xero Organisation Tenant ID' },
    ],
  },
  {
    system: 'sage',
    label: 'Sage',
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text', placeholder: 'Sage Client ID', required: true },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', placeholder: 'Sage Client Secret', required: true },
      { key: 'companyId', label: 'Company ID', type: 'text', placeholder: 'Sage Company ID' },
    ],
  },
  {
    system: 'quickbooks',
    label: 'QuickBooks Online',
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text', placeholder: 'Intuit App Client ID', required: true },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', placeholder: 'Intuit App Client Secret', required: true },
      { key: 'realmId', label: 'Company Realm ID', type: 'text', placeholder: 'QuickBooks Realm/Company ID' },
    ],
  },
  {
    system: 'myob',
    label: 'MYOB',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'text', placeholder: 'MYOB API Key', required: true },
      { key: 'apiSecret', label: 'API Secret', type: 'password', placeholder: 'MYOB API Secret', required: true },
      { key: 'companyUri', label: 'Company File URI', type: 'url', placeholder: 'https://...' },
    ],
  },
  {
    system: 'freeagent',
    label: 'FreeAgent',
    fields: [
      { key: 'clientId', label: 'OAuth Client ID', type: 'text', placeholder: 'FreeAgent OAuth Client ID', required: true },
      { key: 'clientSecret', label: 'OAuth Client Secret', type: 'password', placeholder: 'FreeAgent OAuth Secret', required: true },
    ],
  },
  {
    system: 'kashflow',
    label: 'KashFlow',
    fields: [
      { key: 'username', label: 'Username', type: 'text', placeholder: 'KashFlow username', required: true },
      { key: 'password', label: 'Password', type: 'password', placeholder: 'KashFlow password', required: true },
    ],
  },
];

// ─── Step 1: Select system ───────────────────────────────────
interface SelectSystemProps {
  enabledSystems: string[];  // Only show systems the firm has enabled
  onSelect: (system: string) => void;
  onCancel: () => void;
}

function SelectSystemStep({ enabledSystems, onSelect, onCancel }: SelectSystemProps) {
  const available = AVAILABLE_CONNECTORS.filter(
    c => enabledSystems.length === 0 || enabledSystems.includes(c.system)
  );

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-800 mb-3">Select Accounting System</h3>
      {available.length === 0 ? (
        <p className="text-xs text-slate-500">No connectors enabled. Ask a firm administrator to enable connectors in Firm Settings.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {available.map(c => (
            <button
              key={c.system}
              onClick={() => onSelect(c.system)}
              className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-colors text-left"
            >
              <Plug className="h-4 w-4 text-blue-500 flex-shrink-0" />
              <span className="text-sm font-medium text-slate-700">{c.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex justify-end mt-4">
        <button onClick={onCancel} className="text-xs px-3 py-1.5 text-slate-500 hover:text-slate-700">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Step 2: Enter credentials ───────────────────────────────
interface EnterCredentialsProps {
  system: string;
  clientId: string;
  onConnect: (credentials: Record<string, string>) => void;
  onBack: () => void;
  onCancel: () => void;
  connecting: boolean;
  error: string;
}

function EnterCredentialsStep({ system, clientId, onConnect, onBack, onCancel, connecting, error }: EnterCredentialsProps) {
  const connector = AVAILABLE_CONNECTORS.find(c => c.system === system);
  const [values, setValues] = useState<Record<string, string>>({});

  if (!connector) return null;

  const canConnect = connector.fields
    .filter(f => f.required)
    .every(f => values[f.key]?.trim());

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <button onClick={onBack} className="text-xs text-blue-600 hover:text-blue-800">&larr; Back</button>
        <h3 className="text-sm font-semibold text-slate-800">Connect to {connector.label}</h3>
      </div>

      <div className="space-y-3">
        {connector.fields.map(field => (
          <div key={field.key}>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              {field.label} {field.required && <span className="text-red-400">*</span>}
            </label>
            <input
              type={field.type}
              value={values[field.key] || ''}
              onChange={e => setValues({ ...values, [field.key]: e.target.value })}
              placeholder={field.placeholder}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        ))}
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 mt-4">
        <button onClick={onCancel} className="text-xs px-3 py-1.5 text-slate-500 hover:text-slate-700">
          Cancel
        </button>
        <button
          onClick={() => onConnect(values)}
          disabled={!canConnect || connecting}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
          Connect
        </button>
      </div>
    </div>
  );
}

// ─── Main Modal ──────────────────────────────────────────────
interface ConnectorSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  clientId: string;
  enabledSystems: string[];  // From firm settings
  onConnected?: () => void;  // Callback after successful connection
}

export function ConnectorSetupModal({ isOpen, onClose, clientId, enabledSystems, onConnected }: ConnectorSetupModalProps) {
  const [step, setStep] = useState<'select' | 'credentials'>('select');
  const [selectedSystem, setSelectedSystem] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setStep('select');
      setSelectedSystem('');
      setError('');
      setSuccess(false);
    }
  }, [isOpen]);

  function handleSelectSystem(system: string) {
    setSelectedSystem(system);
    setStep('credentials');
    setError('');
  }

  async function handleConnect(credentials: Record<string, string>) {
    setConnecting(true);
    setError('');
    try {
      const res = await fetch('/api/accounting/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          system: selectedSystem,
          credentials,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Connection failed');
      }
      setSuccess(true);
      setTimeout(() => {
        onConnected?.();
        onClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConnecting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-slate-900">
            {success ? 'Connected!' : 'Set Up Accounting Connection'}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg">
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        {success ? (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
              <Check className="h-6 w-6 text-green-600" />
            </div>
            <p className="text-sm text-green-700 font-medium">
              Successfully connected to {AVAILABLE_CONNECTORS.find(c => c.system === selectedSystem)?.label}
            </p>
          </div>
        ) : step === 'select' ? (
          <SelectSystemStep
            enabledSystems={enabledSystems}
            onSelect={handleSelectSystem}
            onCancel={onClose}
          />
        ) : (
          <EnterCredentialsStep
            system={selectedSystem}
            clientId={clientId}
            onConnect={handleConnect}
            onBack={() => { setStep('select'); setError(''); }}
            onCancel={onClose}
            connecting={connecting}
            error={error}
          />
        )}
      </div>
    </div>
  );
}
