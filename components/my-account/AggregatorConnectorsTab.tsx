'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Trash2, Save, Loader2, CheckCircle2, XCircle, RefreshCw,
  ChevronDown, ChevronUp, Search, Shield, Globe, Building2, Landmark,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

// ─── Types ───────────────────────────────────────────────────────
interface ConnectorField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url' | 'select' | 'textarea' | 'textarea_secret';
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  helpText?: string;
}

interface ConnectorType {
  id: string;
  label: string;
  category: 'government' | 'financial' | 'accounting' | 'data' | 'other';
  icon: string;
  description: string;
  fields: ConnectorField[];
  testEndpoint?: string; // API route to test connectivity
}

interface SavedConnector {
  id: string;
  connectorType: string;
  label: string;
  config: Record<string, string>;
  status: 'active' | 'inactive' | 'error';
  lastTestedAt: string | null;
  lastTestResult: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Connector Registry ──────────────────────────────────────────
const CONNECTOR_REGISTRY: ConnectorType[] = [
  {
    id: 'hm_land_registry',
    label: 'HM Land Registry',
    category: 'government',
    icon: '🏛️',
    description: 'UK Land Registry — verify property ownership and price paid data via SPARQL linked data (free, Open Government Licence)',
    fields: [
      { key: 'endpoint', label: 'SPARQL Endpoint', type: 'url', placeholder: 'https://landregistry.data.gov.uk/landregistry/query', helpText: 'Default endpoint is pre-configured' },
    ],
    testEndpoint: '/api/aggregator-connectors/test',
  },
  {
    id: 'hmlr_business_gateway',
    label: 'HM Land Registry — Business Gateway',
    category: 'government',
    icon: '🏠',
    description: 'HMLR paid Business Gateway — SOAP APIs for Enquiry by Property Description (EPD), Owner Verification, Official Copies, Register Extract, and Application Enquiry. Authenticated via mutual TLS using a client X.509 certificate that HMLR signs after you submit a CSR (per their "Generating a New Signed Certificate in IIS 7" procedure). Once you have the .pfx HMLR sent back, run two openssl commands to extract a PEM cert + PEM private key, then paste those + the Root CA + Issuing CA into the fields below. Test button runs the EPD Best Practice fixtures against the test account.',
    fields: [
      { key: 'environment', label: 'Environment', type: 'select', required: true, options: [{ value: 'test', label: 'Test (bgtest.landregistry.gov.uk)' }, { value: 'live', label: 'Live (business-gateway.landregistry.gov.uk)' }] },
      { key: 'clientCertPem', label: 'Client Certificate (PEM)', type: 'textarea', required: true, helpText: 'The X.509 cert HMLR signed and returned. Paste the full PEM block including -----BEGIN CERTIFICATE----- / -----END CERTIFICATE----- lines. Extract from your .pfx with: openssl pkcs12 -in your.pfx -clcerts -nokeys -out client.crt' },
      { key: 'clientKeyPem', label: 'Client Private Key (PEM)', type: 'textarea_secret', required: true, helpText: 'Your private key, paired with the client certificate. Paste the full PEM block including -----BEGIN PRIVATE KEY----- (or RSA PRIVATE KEY / ENCRYPTED PRIVATE KEY) / -----END lines. Extract from your .pfx with: openssl pkcs12 -in your.pfx -nocerts -nodes -out client.key' },
      { key: 'clientKeyPassphrase', label: 'Private Key Passphrase (optional)', type: 'password', helpText: 'Only required when the key block is encrypted (e.g. when you used -nodes was omitted on the openssl extract). Leave blank when the key is unencrypted.' },
      { key: 'caBundlePem', label: 'HMLR CA Bundle (PEM)', type: 'textarea', required: true, helpText: 'Concatenate the Land Registry Root CA (liverootCA2017.cer) and Issuing CA (LR Issuing CA 2020.cer) into one block — Root first, then Issuing. Both should be in -----BEGIN CERTIFICATE----- format. If files are .cer (DER), convert with: openssl x509 -inform der -in liverootCA2017.cer -out root.pem' },
      { key: 'baseUrl', label: 'Base URL Override (optional)', type: 'url', placeholder: 'Leave blank to use the standard URL for the selected environment', helpText: 'Override only if HMLR provides a tenant-specific endpoint.' },
    ],
    testEndpoint: '/api/aggregator-connectors/test',
  },
  {
    id: 'companies_house',
    label: 'Companies House',
    category: 'government',
    icon: '🏢',
    description: 'UK Companies House — company search, filing history, officers, and accounts',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'Your Companies House API key', helpText: 'Register at developer.company-information.service.gov.uk' },
    ],
    testEndpoint: '/api/aggregator-connectors/test',
  },
  {
    id: 'hmrc',
    label: 'HMRC',
    category: 'government',
    icon: '💷',
    description: 'HM Revenue & Customs — MTD VAT, Corporation Tax, Self Assessment APIs',
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text', required: true, placeholder: 'HMRC Developer Hub Client ID' },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
      { key: 'environment', label: 'Environment', type: 'select', options: [{ value: 'sandbox', label: 'Sandbox' }, { value: 'production', label: 'Production' }] },
      { key: 'callbackUrl', label: 'Callback URL', type: 'url', placeholder: 'https://your-domain/api/hmrc/callback' },
    ],
    testEndpoint: '/api/aggregator-connectors/test',
  },
  {
    id: 'open_banking',
    label: 'Open Banking',
    category: 'financial',
    icon: '🏦',
    description: 'Open Banking PSD2 — bank account data, transactions, balances via AISP',
    fields: [
      { key: 'provider', label: 'Provider', type: 'select', required: true, options: [
        { value: 'truelayer', label: 'TrueLayer' },
        { value: 'plaid', label: 'Plaid' },
        { value: 'yapily', label: 'Yapily' },
        { value: 'other', label: 'Other' },
      ]},
      { key: 'clientId', label: 'Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
      { key: 'environment', label: 'Environment', type: 'select', options: [{ value: 'sandbox', label: 'Sandbox' }, { value: 'production', label: 'Production' }] },
    ],
    testEndpoint: '/api/aggregator-connectors/test',
  },
  {
    id: 'xero',
    label: 'Xero',
    category: 'accounting',
    icon: '📊',
    description: 'Xero accounting — trial balance, journals, invoices, contacts',
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
      { key: 'redirectUri', label: 'Redirect URI', type: 'url', placeholder: 'https://your-domain/api/accounting/xero/callback' },
    ],
    testEndpoint: '/api/aggregator-connectors/test',
  },
  {
    id: 'sage',
    label: 'Sage',
    category: 'accounting',
    icon: '📗',
    description: 'Sage Business Cloud — trial balance, contacts, ledger entries',
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
      { key: 'environment', label: 'Environment', type: 'select', options: [{ value: 'uk', label: 'UK' }, { value: 'us', label: 'US' }, { value: 'ca', label: 'Canada' }] },
    ],
    testEndpoint: '/api/aggregator-connectors/test',
  },
  {
    id: 'quickbooks',
    label: 'QuickBooks',
    category: 'accounting',
    icon: '📒',
    description: 'QuickBooks Online — trial balance, invoices, expenses',
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
      { key: 'redirectUri', label: 'Redirect URI', type: 'url' },
    ],
    testEndpoint: '/api/aggregator-connectors/test',
  },
  {
    id: 'charity_commission',
    label: 'Charity Commission',
    category: 'government',
    icon: '🎗️',
    description: 'Charity Commission for England & Wales — charity details, accounts, trustees',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true, helpText: 'Register at register-of-charities.charitycommission.gov.uk' },
    ],
    testEndpoint: '/api/aggregator-connectors/test',
  },
  {
    id: 'fca_register',
    label: 'FCA Register',
    category: 'government',
    icon: '📋',
    description: 'Financial Conduct Authority Register — firm/individual lookup (free)',
    fields: [
      { key: 'endpoint', label: 'API Endpoint', type: 'url', placeholder: 'https://register.fca.org.uk/services/V0.1', helpText: 'Default endpoint is pre-configured' },
    ],
    testEndpoint: '/api/aggregator-connectors/test',
  },
  {
    id: 'confirmation_statement',
    label: 'Confirmation.com',
    category: 'financial',
    icon: '✅',
    description: 'Confirmation.com — third-party bank and debtor confirmations for audit',
    fields: [
      { key: 'username', label: 'Username', type: 'text', required: true },
      { key: 'password', label: 'Password', type: 'password', required: true },
      { key: 'firmId', label: 'Firm ID', type: 'text', required: true },
    ],
    testEndpoint: '/api/aggregator-connectors/test',
  },
];

const CATEGORY_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  government: { label: 'Government & Regulatory', icon: <Landmark className="h-4 w-4" /> },
  financial: { label: 'Financial Services', icon: <Building2 className="h-4 w-4" /> },
  accounting: { label: 'Accounting Systems', icon: <Globe className="h-4 w-4" /> },
  data: { label: 'Data Providers', icon: <Shield className="h-4 w-4" /> },
  other: { label: 'Other', icon: <Globe className="h-4 w-4" /> },
};

// ─── Component ───────────────────────────────────────────────────
export function AggregatorConnectorsTab({ firmId }: { firmId: string }) {
  const [connectors, setConnectors] = useState<SavedConnector[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedType, setSelectedType] = useState<string>('');
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  const loadConnectors = useCallback(async () => {
    try {
      const res = await fetch('/api/aggregator-connectors');
      if (res.ok) {
        const data = await res.json();
        setConnectors(data.connectors || []);
      }
    } catch (err) {
      console.error('Failed to load connectors:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConnectors(); }, [loadConnectors]);

  // Categories with connectors grouped
  const categories = ['government', 'financial', 'accounting', 'data', 'other'];

  // Available connector types (not already added)
  const addedTypes = new Set(connectors.map(c => c.connectorType));
  const availableTypes = CONNECTOR_REGISTRY.filter(t => !addedTypes.has(t.id));

  const selectedTypeDef = CONNECTOR_REGISTRY.find(t => t.id === selectedType);

  function startAdd(typeId: string) {
    setSelectedType(typeId);
    const typeDef = CONNECTOR_REGISTRY.find(t => t.id === typeId);
    const defaults: Record<string, string> = {};
    typeDef?.fields.forEach(f => {
      if (f.placeholder && f.type === 'url') defaults[f.key] = f.placeholder;
      else defaults[f.key] = '';
    });
    setConfigValues(defaults);
    setShowAdd(true);
  }

  async function handleSave() {
    if (!selectedType) return;
    setSaving(true);
    try {
      const res = await fetch('/api/aggregator-connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectorType: selectedType,
          label: selectedTypeDef?.label || selectedType,
          config: configValues,
        }),
      });
      if (res.ok) {
        setShowAdd(false);
        setSelectedType('');
        setConfigValues({});
        await loadConnectors();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: string) {
    if (!confirm('Remove this connector? Existing connections using it will stop working.')) return;
    const res = await fetch(`/api/aggregator-connectors/${id}`, { method: 'DELETE' });
    if (res.ok) setConnectors(connectors.filter(c => c.id !== id));
  }

  async function handleTest(connector: SavedConnector) {
    setTesting(connector.id);
    try {
      const res = await fetch('/api/aggregator-connectors/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectorId: connector.id, connectorType: connector.connectorType }),
      });
      const data = await res.json();
      setConnectors(connectors.map(c =>
        c.id === connector.id
          ? { ...c, status: data.success ? 'active' : 'error', lastTestedAt: new Date().toISOString(), lastTestResult: data.message || (data.success ? 'OK' : 'Failed') }
          : c
      ));
    } catch {
      setConnectors(connectors.map(c =>
        c.id === connector.id
          ? { ...c, status: 'error', lastTestedAt: new Date().toISOString(), lastTestResult: 'Connection test failed' }
          : c
      ));
    } finally {
      setTesting(null);
    }
  }

  async function handleUpdateConfig(id: string, config: Record<string, string>) {
    const res = await fetch(`/api/aggregator-connectors/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    });
    if (res.ok) await loadConnectors();
  }

  const filteredConnectors = connectors.filter(c =>
    !searchQuery || c.label.toLowerCase().includes(searchQuery.toLowerCase()) || c.connectorType.includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400 mr-2" />
        <span className="text-sm text-slate-500">Loading connectors...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Aggregator Connectors</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Configure connections to external services — government APIs, financial systems, and data providers
          </p>
        </div>
        <Button onClick={() => setShowAdd(!showAdd)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Add Connector
        </Button>
      </div>

      {/* Search */}
      {connectors.length > 3 && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search connectors..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-md"
          />
        </div>
      )}

      {/* Add connector panel */}
      {showAdd && (
        <div className="border rounded-lg bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Add New Connector</h3>

          {/* Type selection */}
          {!selectedType && (
            <div className="space-y-3">
              {categories.filter(cat => availableTypes.some(t => t.category === cat)).map(cat => (
                <div key={cat}>
                  <div className="flex items-center gap-1.5 mb-2">
                    {CATEGORY_LABELS[cat]?.icon}
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                      {CATEGORY_LABELS[cat]?.label}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {availableTypes.filter(t => t.category === cat).map(t => (
                      <button
                        key={t.id}
                        onClick={() => startAdd(t.id)}
                        className="flex items-center gap-2 p-3 bg-white border rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors text-left"
                      >
                        <span className="text-lg">{t.icon}</span>
                        <div>
                          <span className="text-sm font-medium text-slate-800 block">{t.label}</span>
                          <span className="text-[10px] text-slate-500 line-clamp-1">{t.description}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {availableTypes.length === 0 && (
                <p className="text-sm text-slate-400">All available connectors are already configured.</p>
              )}
              <button onClick={() => setShowAdd(false)} className="text-xs text-slate-500 hover:text-slate-700 mt-2">Cancel</button>
            </div>
          )}

          {/* Configuration form */}
          {selectedType && selectedTypeDef && (
            <div>
              <div className="flex items-center gap-2 mb-3 pb-3 border-b">
                <span className="text-lg">{selectedTypeDef.icon}</span>
                <div>
                  <span className="text-sm font-semibold text-slate-800">{selectedTypeDef.label}</span>
                  <p className="text-[10px] text-slate-500">{selectedTypeDef.description}</p>
                </div>
              </div>

              <div className="space-y-3">
                {selectedTypeDef.fields.map(field => (
                  <div key={field.key}>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      {field.label} {field.required && <span className="text-red-500">*</span>}
                    </label>
                    {field.type === 'select' ? (
                      <select
                        value={configValues[field.key] || ''}
                        onChange={(e) => setConfigValues({ ...configValues, [field.key]: e.target.value })}
                        className="w-full px-2 py-1.5 text-sm border rounded-md"
                      >
                        <option value="">Select...</option>
                        {field.options?.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : field.type === 'textarea' || field.type === 'textarea_secret' ? (
                      // Multi-line input — used for PEM blocks (cert,
                      // key, CA bundle). textarea_secret renders as
                      // monospace + masked-by-default with a Show
                      // toggle, so the private key isn't shoulder-
                      // surfed by anyone passing the screen.
                      <div className="relative">
                        <textarea
                          value={configValues[field.key] || ''}
                          onChange={(e) => setConfigValues({ ...configValues, [field.key]: e.target.value })}
                          placeholder={field.placeholder || `-----BEGIN ${field.key === 'clientKeyPem' ? 'PRIVATE KEY' : 'CERTIFICATE'}-----\n...\n-----END ${field.key === 'clientKeyPem' ? 'PRIVATE KEY' : 'CERTIFICATE'}-----`}
                          rows={6}
                          spellCheck={false}
                          className={`w-full px-2 py-1.5 text-[11px] border rounded-md font-mono ${field.type === 'textarea_secret' && !showPasswords[field.key] ? 'text-transparent caret-slate-700 selection:text-slate-700' : ''}`}
                        />
                        {field.type === 'textarea_secret' && (
                          <button
                            type="button"
                            onClick={() => setShowPasswords({ ...showPasswords, [field.key]: !showPasswords[field.key] })}
                            className="absolute right-2 top-2 text-[10px] text-slate-400 hover:text-slate-600 bg-white/80 px-1 rounded"
                          >
                            {showPasswords[field.key] ? 'Hide' : 'Show'}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="relative">
                        <input
                          type={field.type === 'password' && !showPasswords[field.key] ? 'password' : 'text'}
                          value={configValues[field.key] || ''}
                          onChange={(e) => setConfigValues({ ...configValues, [field.key]: e.target.value })}
                          placeholder={field.placeholder}
                          className="w-full px-2 py-1.5 text-sm border rounded-md pr-8"
                        />
                        {field.type === 'password' && (
                          <button
                            type="button"
                            onClick={() => setShowPasswords({ ...showPasswords, [field.key]: !showPasswords[field.key] })}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 hover:text-slate-600"
                          >
                            {showPasswords[field.key] ? 'Hide' : 'Show'}
                          </button>
                        )}
                      </div>
                    )}
                    {field.helpText && <p className="text-[10px] text-slate-400 mt-0.5">{field.helpText}</p>}
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 mt-4">
                <Button onClick={handleSave} size="sm" disabled={saving}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                  Save Connector
                </Button>
                <Button onClick={() => { setSelectedType(''); setConfigValues({}); }} size="sm" variant="outline">
                  Back
                </Button>
                <Button onClick={() => { setShowAdd(false); setSelectedType(''); }} size="sm" variant="ghost">
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Connector list by category */}
      {connectors.length === 0 && !showAdd && (
        <div className="text-center py-12 border rounded-lg">
          <Globe className="h-10 w-10 mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-500">No connectors configured yet</p>
          <p className="text-xs text-slate-400 mt-1">Add connectors to link external services</p>
        </div>
      )}

      {categories.map(cat => {
        const catConnectors = filteredConnectors.filter(c => {
          const typeDef = CONNECTOR_REGISTRY.find(t => t.id === c.connectorType);
          return typeDef?.category === cat;
        });
        if (catConnectors.length === 0) return null;
        return (
          <div key={cat}>
            <div className="flex items-center gap-1.5 mb-2">
              {CATEGORY_LABELS[cat]?.icon}
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                {CATEGORY_LABELS[cat]?.label}
              </span>
            </div>
            <div className="space-y-2">
              {catConnectors.map(connector => {
                const typeDef = CONNECTOR_REGISTRY.find(t => t.id === connector.connectorType);
                const isExpanded = expandedId === connector.id;
                return (
                  <div key={connector.id} className="border rounded-lg bg-white">
                    <div
                      className="flex items-center justify-between p-3 cursor-pointer hover:bg-slate-50"
                      onClick={() => setExpandedId(isExpanded ? null : connector.id)}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{typeDef?.icon || '🔗'}</span>
                        <div>
                          <span className="text-sm font-medium text-slate-800">{connector.label}</span>
                          <span className="text-[10px] text-slate-400 ml-2">{connector.connectorType}</span>
                        </div>
                        {/* Status indicator */}
                        {connector.status === 'active' ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : connector.status === 'error' ? (
                          <XCircle className="h-4 w-4 text-red-500" />
                        ) : (
                          <span className="w-3 h-3 rounded-full bg-slate-300 inline-block" />
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {connector.lastTestedAt && (
                          <span className="text-[10px] text-slate-400">
                            Tested: {new Date(connector.lastTestedAt).toLocaleDateString('en-GB')}
                          </span>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleTest(connector); }}
                          disabled={testing === connector.id}
                          className="p-1 hover:bg-slate-100 rounded"
                          title="Test connection"
                        >
                          {testing === connector.id ? (
                            <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5 text-slate-400" />
                          )}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRemove(connector.id); }}
                          className="p-1 hover:bg-red-50 rounded"
                          title="Remove"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-400" />
                        </button>
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
                      </div>
                    </div>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="px-3 pb-3 border-t pt-3">
                        <p className="text-xs text-slate-500 mb-3">{typeDef?.description}</p>
                        {connector.lastTestResult && (
                          <div className={`text-xs px-2 py-1 rounded mb-3 ${connector.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                            Last test: {connector.lastTestResult}
                          </div>
                        )}
                        <div className="space-y-2">
                          {typeDef?.fields.map(field => (
                            <div key={field.key} className="flex items-center gap-2">
                              <span className="text-xs text-slate-500 w-28 flex-shrink-0">{field.label}:</span>
                              <span className="text-xs text-slate-700 font-mono">
                                {field.type === 'password' || field.type === 'textarea_secret'
                                  ? (connector.config[field.key] ? '••••••••' : '—')
                                  : field.type === 'textarea'
                                  // Multi-line PEM blocks summarise as
                                  // a length pill; full value is in the
                                  // edit form. Avoids splatting kilobytes
                                  // of cert text into the row preview.
                                  ? (connector.config[field.key] ? `${connector.config[field.key].length} chars` : '—')
                                  : (connector.config[field.key] || '—')
                                }
                              </span>
                            </div>
                          ))}
                        </div>
                        {/*
                          Prominent action buttons — the icon-only RefreshCw
                          button in the header row is too subtle. Adds a full
                          "Test Connection" button and (for HMLR Business
                          Gateway) a "Run EPD Fixtures" button that's the
                          same API call but clearly labelled so Super Admin
                          can see exactly what it does.
                        */}
                        <div className="flex items-center gap-2 mt-3">
                          <Button
                            onClick={() => handleTest(connector)}
                            disabled={testing === connector.id}
                            size="sm"
                            variant="outline"
                          >
                            {testing === connector.id ? (
                              <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Testing…</>
                            ) : (
                              <><RefreshCw className="h-3 w-3 mr-1" /> Test Connection</>
                            )}
                          </Button>
                          {connector.connectorType === 'hmlr_business_gateway' && (
                            <span className="text-[10px] text-slate-500 italic">
                              Test runs the 10 EPD Best Practice fixtures against the {connector.config.environment || 'test'} account.
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-3 text-[10px] text-slate-400">
                          <span>Added: {new Date(connector.createdAt).toLocaleDateString('en-GB')}</span>
                          <span>&middot;</span>
                          <span>Updated: {new Date(connector.updatedAt).toLocaleDateString('en-GB')}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
