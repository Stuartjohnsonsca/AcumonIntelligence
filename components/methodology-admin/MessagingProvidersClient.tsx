'use client';

/**
 * SuperAdmin UI for messaging-provider configuration. One card per
 * provider; each card shows the current state, lets the SuperAdmin
 * edit the credential fields, and saves back via PUT.
 *
 * The DB-first / env-fallback logic in lib/messaging/provider-config.ts
 * means leaving a row disabled keeps env-vars in effect for that
 * provider. Switching `enabled` to true means the DB values are
 * authoritative.
 *
 * WeCom gets a radio for `mode` — Group Robot vs External Contact
 * Pro — driving which sending path the orchestrator uses.
 */

import { useEffect, useState } from 'react';
import { Loader2, Check, AlertTriangle, MessageSquare, Send, Phone, QrCode } from 'lucide-react';

type ProviderKey = 'twilio' | 'sent_dm' | 'telegram' | 'wecom';

interface ProviderRow {
  provider: ProviderKey;
  enabled: boolean;
  config: Record<string, any>;
  effective: Record<string, any>;
  source: 'db' | 'env';
  updatedAt: string | null;
  updatedByName: string | null;
}

const PROVIDER_META: Record<ProviderKey, { label: string; icon: React.ReactNode; description: string }> = {
  twilio: {
    label: 'Twilio',
    icon: <Phone className="h-4 w-4 text-red-600" />,
    description: 'SMS + WhatsApp (Business) via Twilio Messages API. Fallback for sent.dm.',
  },
  sent_dm: {
    label: 'sent.dm',
    icon: <MessageSquare className="h-4 w-4 text-blue-600" />,
    description: 'Unified SMS / WhatsApp via sent.dm template messaging. Primary; Twilio kicks in on failure.',
  },
  telegram: {
    label: 'Telegram',
    icon: <Send className="h-4 w-4 text-sky-600" />,
    description: 'Telegram Bot API. Free; clients connect via /start <code> deep-link.',
  },
  wecom: {
    label: 'WeCom (WeChat Work)',
    icon: <QrCode className="h-4 w-4 text-emerald-700" />,
    description: 'Two modes: Group Robot (free, shared groups) or External Contact Pro (1:1 DMs, needs WeCom Pro).',
  },
};

export function MessagingProvidersClient() {
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch('/api/methodology-admin/messaging-providers');
      if (!res.ok) throw new Error('Failed to load providers');
      const data = await res.json();
      setRows(data.providers || []);
    } catch (e: any) {
      setError(e?.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  if (loading) {
    return <div className="text-center py-10 text-slate-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>;
  }
  if (error) {
    return <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{error}</div>;
  }

  return (
    <div className="space-y-4">
      {rows.map(row => (
        <ProviderCard key={row.provider} row={row} onSaved={refresh} />
      ))}
    </div>
  );
}

function ProviderCard({ row, onSaved }: { row: ProviderRow; onSaved: () => void }) {
  const meta = PROVIDER_META[row.provider];
  // Local draft so we can save the whole card in one click.
  const [enabled, setEnabled] = useState(row.enabled);
  const [config, setConfig] = useState<Record<string, any>>({ ...row.config });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setEnabled(row.enabled);
    setConfig({ ...row.config });
  }, [row]);

  function setField(key: string, value: string) {
    setConfig(c => ({ ...c, [key]: value }));
  }

  async function save() {
    setSaving(true); setMsg(null);
    try {
      const res = await fetch('/api/methodology-admin/messaging-providers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: row.provider, enabled, config }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Save failed (${res.status})`);
      }
      setMsg({ ok: true, text: 'Saved.' });
      onSaved();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100">
        <div className="flex items-start gap-3">
          {meta.icon}
          <div>
            <h2 className="text-sm font-semibold text-slate-800">{meta.label}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{meta.description}</p>
            {row.source === 'env' && !enabled && (
              <p className="text-[10px] text-amber-700 mt-1 italic">
                Currently using environment variables (DB row disabled). Toggle on + save to use DB values.
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
              className="rounded border-slate-300"
            />
            Enabled
          </label>
        </div>
      </div>
      <div className="px-5 py-4 space-y-3">
        {row.provider === 'twilio' && <TwilioFields config={config} setField={setField} effective={row.effective} />}
        {row.provider === 'sent_dm' && <SentDmFields config={config} setField={setField} effective={row.effective} />}
        {row.provider === 'telegram' && <TelegramFields config={config} setField={setField} effective={row.effective} />}
        {row.provider === 'wecom' && <WeComFields config={config} setField={setField} effective={row.effective} />}
      </div>
      <div className="px-5 py-3 bg-slate-50/60 border-t border-slate-100 flex items-center justify-between rounded-b-xl">
        <div className="text-[11px] text-slate-500">
          {row.updatedAt
            ? <>Last saved {new Date(row.updatedAt).toLocaleString('en-GB')}{row.updatedByName ? ` by ${row.updatedByName}` : ''}</>
            : 'Never saved (using env-var fallback)'}
        </div>
        <div className="flex items-center gap-3">
          {msg && (
            <span className={`text-[11px] inline-flex items-center gap-1 ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>
              {msg.ok ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
              {msg.text}
            </span>
          )}
          <button
            onClick={() => void save()}
            disabled={saving}
            className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Per-provider field renderers ─────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-slate-700 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-slate-500 mt-0.5">{hint}</p>}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full border border-slate-300 rounded px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:border-blue-300 ${props.className || ''}`}
    />
  );
}

function envPlaceholder(effective: Record<string, any>, key: string): string {
  const v = effective?.[key];
  return typeof v === 'string' && v ? `From env: ${v.slice(0, 12)}…` : '';
}

function TwilioFields({ config, setField, effective }: { config: Record<string, any>; setField: (k: string, v: string) => void; effective: Record<string, any> }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Field label="Account SID">
        <Input value={config.accountSid || ''} onChange={e => setField('accountSid', e.target.value)} placeholder={envPlaceholder(effective, 'accountSid') || 'ACxxxxxxxx…'} />
      </Field>
      <Field label="Auth Token">
        <Input type="password" value={config.authToken || ''} onChange={e => setField('authToken', e.target.value)} placeholder={effective.authToken ? '••••••••' : 'auth token'} />
      </Field>
      <Field label="SMS sender" hint="E.164 number, e.g. +447700900123">
        <Input value={config.smsFrom || ''} onChange={e => setField('smsFrom', e.target.value)} placeholder={envPlaceholder(effective, 'smsFrom')} />
      </Field>
      <Field label="WhatsApp sender" hint="whatsapp:+447700900123">
        <Input value={config.whatsappFrom || ''} onChange={e => setField('whatsappFrom', e.target.value)} placeholder={envPlaceholder(effective, 'whatsappFrom')} />
      </Field>
      <Field label="Webhook public URL (optional)" hint="Override when behind a proxy that rewrites the host">
        <Input value={config.webhookPublicUrl || ''} onChange={e => setField('webhookPublicUrl', e.target.value)} placeholder={envPlaceholder(effective, 'webhookPublicUrl')} />
      </Field>
    </div>
  );
}

function SentDmFields({ config, setField, effective }: { config: Record<string, any>; setField: (k: string, v: string) => void; effective: Record<string, any> }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Field label="API key">
        <Input type="password" value={config.apiKey || ''} onChange={e => setField('apiKey', e.target.value)} placeholder={effective.apiKey ? '••••••••' : 'sk-...'} />
      </Field>
      <Field label="Template ID (default)" hint="The {{body}}/{{link}} template you registered with sent.dm">
        <Input value={config.templateId || ''} onChange={e => setField('templateId', e.target.value)} placeholder={envPlaceholder(effective, 'templateId')} />
      </Field>
      <Field label="SMS template ID (optional)">
        <Input value={config.smsTemplateId || ''} onChange={e => setField('smsTemplateId', e.target.value)} placeholder={envPlaceholder(effective, 'smsTemplateId')} />
      </Field>
      <Field label="WhatsApp template ID (optional)">
        <Input value={config.whatsappTemplateId || ''} onChange={e => setField('whatsappTemplateId', e.target.value)} placeholder={envPlaceholder(effective, 'whatsappTemplateId')} />
      </Field>
    </div>
  );
}

function TelegramFields({ config, setField, effective }: { config: Record<string, any>; setField: (k: string, v: string) => void; effective: Record<string, any> }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Field label="Bot token" hint="From BotFather → /newbot">
        <Input type="password" value={config.botToken || ''} onChange={e => setField('botToken', e.target.value)} placeholder={effective.botToken ? '••••••••' : '123456:ABC…'} />
      </Field>
      <Field label="Bot username" hint="Without @ — used to build the t.me deep-link">
        <Input value={config.botUsername || ''} onChange={e => setField('botUsername', e.target.value)} placeholder={envPlaceholder(effective, 'botUsername') || 'AcumonAuditBot'} />
      </Field>
      <Field label="Webhook secret" hint="Set in setWebhook + matches X-Telegram-Bot-Api-Secret-Token header">
        <Input type="password" value={config.webhookSecret || ''} onChange={e => setField('webhookSecret', e.target.value)} placeholder={effective.webhookSecret ? '••••••••' : 'random 32 chars'} />
      </Field>
    </div>
  );
}

function WeComFields({ config, setField, effective }: { config: Record<string, any>; setField: (k: string, v: string) => void; effective: Record<string, any> }) {
  const mode = (config.mode === 'external_contact_pro') ? 'external_contact_pro' : 'group_robot';
  function setMode(next: 'group_robot' | 'external_contact_pro') { setField('mode', next); }
  return (
    <div className="space-y-3">
      {/* Mode selector — radio so the SuperAdmin sees which path the
          orchestrator will use for WeChat-preference notifications. */}
      <Field label="Mode" hint="Group Robot is free; External Contact Pro needs WeCom Pro and an approved API key.">
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="radio" checked={mode === 'group_robot'} onChange={() => setMode('group_robot')} />
            <span><strong>Group Robot</strong> — shared group chat per engagement, free WeCom tier</span>
          </label>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="radio" checked={mode === 'external_contact_pro'} onChange={() => setMode('external_contact_pro')} />
            <span><strong>External Contact (Pro)</strong> — 1:1 DMs, requires WeCom Pro + approved API</span>
          </label>
        </div>
      </Field>

      {mode === 'group_robot' && (
        <Field
          label="Group Robot webhook URL"
          hint="From the WeCom group → ⋯ → Group Robots → Add Robot → copy URL. Used as the firm-wide default; per-engagement URLs in Monitoring Reports take precedence."
        >
          <Input value={config.groupWebhookUrl || ''} onChange={e => setField('groupWebhookUrl', e.target.value)} placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." />
        </Field>
      )}

      {mode === 'external_contact_pro' && (
        <>
          {/* Firm-run connector — for Model 3 you'll typically run a
              separate service that talks to Tencent's APIs on
              Acumon's behalf (handles access-token caching, Contact
              Way generation, signing, etc.). Acumon POSTs to its URL
              with the auth header below. Tencent credentials further
              down stay available as a direct-call fallback for firms
              that haven't built a connector yet. */}
          <div className="border border-emerald-200 bg-emerald-50/30 rounded-lg p-3 mb-3">
            <div className="text-[11px] font-semibold text-emerald-800 mb-2">
              WeCom Pro connector (your service)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field
                label="Connector URL"
                hint="HTTPS endpoint of the WeCom Pro connector you've built. Acumon POSTs here for Contact Way / send / webhook actions."
              >
                <Input
                  value={config.proConnectorUrl || ''}
                  onChange={e => setField('proConnectorUrl', e.target.value)}
                  placeholder="https://your-wecom-connector.example.com"
                />
              </Field>
              <Field
                label="Auth header name"
                hint="Header carrying the auth value. Defaults to Authorization when blank."
              >
                <Input
                  value={config.proConnectorAuthHeader || ''}
                  onChange={e => setField('proConnectorAuthHeader', e.target.value)}
                  placeholder="Authorization"
                />
              </Field>
              <Field
                label="Auth value"
                hint="Secret value placed in the header. e.g. 'Bearer eyJ…' or just the API key, depending on your connector."
              >
                <Input
                  type="password"
                  value={config.proConnectorAuthValue || ''}
                  onChange={e => setField('proConnectorAuthValue', e.target.value)}
                  placeholder={config.proConnectorAuthValue ? '••••••••' : 'Bearer or key value'}
                />
              </Field>
              <Field label="Sender WeCom UserID" hint="The firm-side WeCom employee whose customer roster the connector binds clients to.">
                <Input value={config.senderUserId || ''} onChange={e => setField('senderUserId', e.target.value)} placeholder={envPlaceholder(effective, 'senderUserId')} />
              </Field>
            </div>
          </div>

          {/* Tencent credentials — only needed if you DON'T have a
              connector and want Acumon to hit WeCom directly. The
              Group Robot path uses none of these; the External
              Contact Pro path uses these only when Connector URL
              above is blank. */}
          <div className="text-[11px] font-semibold text-slate-600 mb-2">
            Direct-to-Tencent fallback (only used when no connector URL is set)
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Corp ID" hint="WeCom → My Company → Corporation Info">
              <Input value={config.corpId || ''} onChange={e => setField('corpId', e.target.value)} placeholder={envPlaceholder(effective, 'corpId')} />
            </Field>
            <Field label="Agent ID" hint="WeCom → App Management → your app → AgentId">
              <Input value={config.agentId || ''} onChange={e => setField('agentId', e.target.value)} placeholder={envPlaceholder(effective, 'agentId')} />
            </Field>
            <Field label="App secret">
              <Input type="password" value={config.appSecret || ''} onChange={e => setField('appSecret', e.target.value)} placeholder={effective.appSecret ? '••••••••' : 'app secret'} />
            </Field>
            <Field label="External Contact secret" hint="Distinct from the App secret; under External Contact → Permissions in the WeCom dashboard">
              <Input type="password" value={config.externalContactSecret || ''} onChange={e => setField('externalContactSecret', e.target.value)} placeholder={effective.externalContactSecret ? '••••••••' : 'external-contact secret'} />
            </Field>
            <Field label="Webhook token">
              <Input type="password" value={config.token || ''} onChange={e => setField('token', e.target.value)} placeholder={effective.token ? '••••••••' : 'webhook token'} />
            </Field>
            <Field label="API base override (optional)" hint="For mainland proxies; leave blank for default api.weixin.qq.com">
              <Input value={config.apiBase || ''} onChange={e => setField('apiBase', e.target.value)} placeholder={envPlaceholder(effective, 'apiBase')} />
            </Field>
          </div>
        </>
      )}
    </div>
  );
}
