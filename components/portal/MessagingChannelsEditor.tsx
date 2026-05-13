'use client';

/**
 * MessagingChannelsEditor — per-portal-user WhatsApp / Telegram / SMS
 * settings.
 *
 * Two modes:
 *   • Standalone (mode='self'): the signed-in user editing their own
 *     channels. Talks to /api/portal/messaging-channels with a session
 *     token. Telegram "Connect" generates a deep-link via
 *     /api/portal/messaging-channels/telegram-link.
 *   • Staff-row (mode='staff'): a Portal Principal editing a staff
 *     member's channel hints during setup. Talks to
 *     /api/portal/setup/staff/{staffId}. Telegram has no Connect
 *     button here — only the staff member themselves can link via the
 *     bot's /start handshake.
 *
 * The component is purely controlled — parent owns the source-of-truth
 * channel state and applies the patch returned from onChange.
 */

import { useState, useCallback } from 'react';
import { MessageSquare, Phone, Send, Loader2, CheckCircle2, AlertTriangle, ExternalLink, QrCode } from 'lucide-react';

export type PreferredChannel = 'whatsapp' | 'telegram' | 'sms' | 'wechat' | 'email' | 'none';

export interface ChannelsState {
  whatsappNumber: string | null;
  whatsappOptIn: boolean;
  telegramHandle: string | null;
  telegramChatId?: string | null;
  telegramOptIn: boolean;
  smsNumber: string | null;
  smsOptIn: boolean;
  // WeChat — OpenID is server-only (set by the bot webhook on /SCAN);
  // nickname comes from the same handshake. The UI uses the opt-in
  // flag + the linked flag (derived from openId presence) to decide
  // when to show "Connect WeChat" vs "Connected".
  wechatOpenId?: string | null;
  wechatNickname?: string | null;
  wechatOptIn: boolean;
  // Single preferred channel for outbound notifications. The radio
  // button drives this; existing contact details on the other
  // channels are kept on the record (so users can re-pick without
  // re-entering their phone) but only the preferred channel fires.
  preferredCommunicationChannel?: PreferredChannel | null;
}

type EditorMode = 'self' | 'staff';

interface Props {
  mode: EditorMode;
  /** Session token (mode='self') used to call /api/portal/* endpoints. */
  token?: string;
  /** Staff member id (mode='staff') used to call
   *  /api/portal/setup/staff/{staffId}. */
  staffId?: string;
  value: ChannelsState;
  onChange: (next: ChannelsState) => void;
  /** Compact view drops the section header + heading copy so the
   *  component slots into a table row. */
  compact?: boolean;
  /** Render with a leading title block. */
  title?: string;
}

export function MessagingChannelsEditor({
  mode, token, staffId, value, onChange, compact, title,
}: Props) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [telegramUrl, setTelegramUrl] = useState<string | null>(null);
  const [telegramCode, setTelegramCode] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  // WeChat connect flow — separate state from Telegram so a user can
  // generate one QR per channel side-by-side without overwriting.
  const [wechatQrUrl, setWechatQrUrl] = useState<string | null>(null);
  const [wechatExpiresAt, setWechatExpiresAt] = useState<string | null>(null);
  const [wechatLinking, setWechatLinking] = useState(false);

  // Build a server-side patch URL based on the mode. Self → talks to
  // /api/portal/messaging-channels; staff → talks to the existing
  // staff endpoint which mirror-writes through to the underlying
  // ClientPortalUser (see route.ts).
  const persist = useCallback(async (patch: Partial<ChannelsState>) => {
    setSaving(Object.keys(patch).join(','));
    setError(null);
    try {
      if (mode === 'self') {
        if (!token) throw new Error('Token missing');
        const res = await fetch('/api/portal/messaging-channels', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, ...patch }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        onChange({ ...value, ...data.channels });
      } else {
        if (!staffId || !token) throw new Error('staffId + token required');
        const res = await fetch(`/api/portal/setup/staff/${staffId}?token=${encodeURIComponent(token)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error || `HTTP ${res.status}`);
        }
        // Staff endpoint returns the full row; pick out channel fields.
        const data = await res.json();
        const s = data.staff || {};
        onChange({
          whatsappNumber: s.whatsappNumber ?? null,
          whatsappOptIn: !!s.whatsappOptIn,
          telegramHandle: s.telegramHandle ?? null,
          telegramChatId: value.telegramChatId ?? null,
          telegramOptIn: !!s.telegramOptIn,
          smsNumber: s.smsNumber ?? null,
          smsOptIn: !!s.smsOptIn,
          wechatOpenId: value.wechatOpenId ?? null,
          wechatNickname: value.wechatNickname ?? null,
          wechatOptIn: !!s.wechatOptIn,
        });
      }
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(null);
    }
  }, [mode, token, staffId, value, onChange]);

  const requestWeChatLink = useCallback(async () => {
    if (!token) return;
    setWechatLinking(true);
    setError(null);
    setWechatQrUrl(null);
    setWechatExpiresAt(null);
    try {
      const res = await fetch('/api/portal/messaging-channels/wechat-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || 'Could not generate WeChat QR');
      }
      const data = await res.json();
      setWechatQrUrl(data.qrUrl);
      setWechatExpiresAt(data.expiresAt || null);
    } catch (e: any) {
      setError(e?.message || 'WeChat link failed');
    } finally {
      setWechatLinking(false);
    }
  }, [token]);

  const requestTelegramLink = useCallback(async () => {
    if (!token) return;
    setLinking(true);
    setError(null);
    setTelegramUrl(null);
    setTelegramCode(null);
    try {
      const res = await fetch('/api/portal/messaging-channels/telegram-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || 'Could not generate Telegram link');
      }
      const data = await res.json();
      setTelegramUrl(data.url);
      setTelegramCode(data.code);
    } catch (e: any) {
      setError(e?.message || 'Telegram link failed');
    } finally {
      setLinking(false);
    }
  }, [token]);

  const isLinked = !!value.telegramChatId;

  return (
    <div className={compact ? '' : 'border border-slate-200 rounded-lg p-4 bg-white space-y-4'}>
      {!compact && (
        <div className="flex items-start gap-2">
          <MessageSquare className="h-4 w-4 text-blue-600 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-slate-800">{title || 'Messaging channels'}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Choose how you want to be notified when the audit team needs your input. You can reply directly from your messaging app — replies thread back to the relevant request in the portal.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 inline-flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
        </div>
      )}

      {/* Single-select radio list. The user picks ONE preferred
          channel; notifyPortalUser uses it instead of fanning out.
          Contact-detail inputs appear under the selected option so
          the user only fills in what they actually use. Previously-
          entered numbers on the other channels stay on the record
          (the user can re-select WhatsApp later without retyping). */}
      <div className="space-y-2">
        <PreferenceRow
          channel="whatsapp"
          label="WhatsApp"
          icon={<MessageSquare className="h-4 w-4 text-emerald-600" />}
          selected={value.preferredCommunicationChannel === 'whatsapp'}
          onSelect={() => persist({ preferredCommunicationChannel: 'whatsapp' })}
          summary={value.whatsappNumber || 'No number set'}
        >
          <ChannelContact
            placeholder="+44 7700 900123"
            number={value.whatsappNumber}
            onNumber={(v) => persist({ whatsappNumber: v, whatsappOptIn: true })}
            saving={saving === 'whatsappNumber'}
          />
        </PreferenceRow>

        <PreferenceRow
          channel="telegram"
          label="Telegram"
          icon={<Send className="h-4 w-4 text-blue-600" />}
          selected={value.preferredCommunicationChannel === 'telegram'}
          onSelect={() => persist({ preferredCommunicationChannel: 'telegram' })}
          summary={isLinked ? `Connected${value.telegramHandle ? ' · ' + value.telegramHandle : ''}` : 'Not yet connected'}
        >
          <div className="space-y-2">
            <input
              type="text"
              value={value.telegramHandle || ''}
              onChange={(e) => onChange({ ...value, telegramHandle: e.target.value })}
              onBlur={(e) => persist({ telegramHandle: e.target.value, telegramOptIn: true })}
              placeholder="@yourhandle (optional)"
              className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-300 bg-white"
            />
            {mode === 'self' ? (
              <div className="space-y-1">
                {isLinked ? (
                  <span className="text-[11px] text-emerald-700 inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Connected — replies route back to the portal
                  </span>
                ) : (
                  <button
                    onClick={requestTelegramLink}
                    disabled={linking}
                    className="text-[11px] px-2.5 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    {linking ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
                    Connect Telegram
                  </button>
                )}
                {telegramUrl && (
                  <div className="text-[11px] text-slate-600">
                    Open in Telegram and press Start:{' '}
                    <a href={telegramUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">{telegramUrl}</a>
                    {telegramCode && <span className="block text-slate-400 mt-0.5">Code expires in 30 min.</span>}
                  </div>
                )}
              </div>
            ) : (
              <span className={`inline-block text-[11px] ${isLinked ? 'text-emerald-700' : 'text-slate-400'}`}>
                {isLinked ? 'Bot is linked' : 'User must press Start in the Telegram bot themselves'}
              </span>
            )}
          </div>
        </PreferenceRow>

        <PreferenceRow
          channel="sms"
          label="SMS"
          icon={<Phone className="h-4 w-4 text-slate-600" />}
          selected={value.preferredCommunicationChannel === 'sms'}
          onSelect={() => persist({ preferredCommunicationChannel: 'sms' })}
          summary={value.smsNumber || 'No number set'}
        >
          <ChannelContact
            placeholder="+44 7700 900123"
            number={value.smsNumber}
            onNumber={(v) => persist({ smsNumber: v, smsOptIn: true })}
            saving={saving === 'smsNumber'}
          />
        </PreferenceRow>

        <PreferenceRow
          channel="wechat"
          label="WeChat"
          icon={<QrCode className="h-4 w-4 text-green-700" />}
          selected={value.preferredCommunicationChannel === 'wechat'}
          onSelect={() => persist({ preferredCommunicationChannel: 'wechat' })}
          summary={value.wechatOpenId ? (value.wechatNickname ? `Connected · ${value.wechatNickname}` : 'Connected') : 'Not yet connected — scan QR'}
        >
          <div className="space-y-2">
            <p className="text-[11px] text-slate-500">
              Scan a QR with the WeChat app to link your account. The audit firm sends messages via its WeCom (企业微信) Official Account — you read and reply in regular WeChat.
            </p>
            {mode === 'self' ? (
              <div className="space-y-1">
                {value.wechatOpenId ? (
                  <span className="text-[11px] text-emerald-700 inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Connected
                  </span>
                ) : (
                  <button
                    onClick={requestWeChatLink}
                    disabled={wechatLinking}
                    className="text-[11px] px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-100 disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    {wechatLinking ? <Loader2 className="h-3 w-3 animate-spin" /> : <QrCode className="h-3 w-3" />}
                    Connect WeChat
                  </button>
                )}
                {wechatQrUrl && (
                  <div className="text-[11px] text-slate-600">
                    <img
                      src={wechatQrUrl}
                      alt="WeChat QR — scan to link your account"
                      className="w-40 h-40 mt-1 border border-slate-200 rounded bg-white"
                    />
                    <span className="block text-slate-400 mt-0.5">
                      Open WeChat → Scan → follow the Official Account. QR expires in 30 min.
                    </span>
                    {wechatExpiresAt && (
                      <span className="block text-slate-300 mt-0.5 text-[9px]">
                        Expires: {new Date(wechatExpiresAt).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <span className={`inline-block text-[11px] ${value.wechatOpenId ? 'text-emerald-700' : 'text-slate-400'}`}>
                {value.wechatOpenId ? 'WeChat is linked' : 'User must scan the QR + follow the Official Account themselves'}
              </span>
            )}
          </div>
        </PreferenceRow>

        <PreferenceRow
          channel="email"
          label="Email only"
          icon={<MessageSquare className="h-4 w-4 text-slate-500" />}
          selected={value.preferredCommunicationChannel === 'email'}
          onSelect={() => persist({ preferredCommunicationChannel: 'email' })}
          summary="Use the email on file — no chat-app notifications"
        />

        <PreferenceRow
          channel="none"
          label="No notifications"
          icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
          selected={value.preferredCommunicationChannel === 'none'}
          onSelect={() => persist({ preferredCommunicationChannel: 'none' })}
          summary="You'll only see requests by logging into the portal — choose this only if you check often"
        />
      </div>
    </div>
  );
}

/** Single radio-row in the preferred-channel list. Header shows the
 *  channel name + a one-line summary; selected rows expand to show
 *  the contact-detail inputs / connect actions. */
function PreferenceRow({
  channel, label, icon, selected, onSelect, summary, children,
}: {
  channel: PreferredChannel;
  label: string;
  icon: React.ReactNode;
  selected: boolean;
  onSelect: () => void;
  summary: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`border rounded-lg transition-colors ${selected ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
      <label className="flex items-start gap-3 px-3 py-2.5 cursor-pointer">
        <input
          type="radio"
          name={`preferred-channel-${channel.charAt(0)}`}
          checked={selected}
          onChange={() => onSelect()}
          className="mt-1 text-blue-600"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
            {icon}
            {label}
          </div>
          <p className={`text-[11px] mt-0.5 ${selected ? 'text-blue-700' : 'text-slate-500'}`}>
            {summary}
          </p>
        </div>
      </label>
      {selected && children && (
        <div className="px-4 pb-3 pl-10 -mt-1">
          {children}
        </div>
      )}
    </div>
  );
}

/** Phone-number input used by WhatsApp + SMS rows. Save-on-blur. */
function ChannelContact({
  placeholder, number, onNumber, saving,
}: {
  placeholder: string;
  number: string | null;
  onNumber: (v: string) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState(number || '');
  if (draft !== (number || '') && !saving && document.activeElement?.tagName !== 'INPUT') {
    setDraft(number || '');
  }
  return (
    <div className="relative">
      <input
        type="tel"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== (number || '')) onNumber(draft); }}
        placeholder={placeholder}
        className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-300 bg-white"
      />
      {saving && (
        <Loader2 className="h-3 w-3 animate-spin text-slate-400 absolute right-2 top-1/2 -translate-y-1/2" />
      )}
    </div>
  );
}

