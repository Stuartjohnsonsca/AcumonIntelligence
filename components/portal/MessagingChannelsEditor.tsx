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

      <div className={compact ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3' : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'}>
        {/* WhatsApp */}
        <ChannelRow
          label="WhatsApp"
          icon={<MessageSquare className="h-3.5 w-3.5" />}
          placeholder="+44 7700 900123"
          number={value.whatsappNumber}
          optIn={value.whatsappOptIn}
          onNumber={(v) => persist({ whatsappNumber: v })}
          onOptIn={(v) => persist({ whatsappOptIn: v })}
          saving={saving === 'whatsappNumber' || saving === 'whatsappOptIn'}
        />

        {/* SMS */}
        <ChannelRow
          label="SMS"
          icon={<Phone className="h-3.5 w-3.5" />}
          placeholder="+44 7700 900123"
          number={value.smsNumber}
          optIn={value.smsOptIn}
          onNumber={(v) => persist({ smsNumber: v })}
          onOptIn={(v) => persist({ smsOptIn: v })}
          saving={saving === 'smsNumber' || saving === 'smsOptIn'}
        />

        {/* Telegram — handle field for display only; chat_id is set by
            the bot's /start handshake. Connect button is only shown to
            the self editor; for staff rows we display whether the user
            has linked yet. */}
        <div className="border border-slate-200 rounded-md p-2.5 bg-slate-50/40">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-slate-700 inline-flex items-center gap-1">
              <Send className="h-3.5 w-3.5" /> Telegram
            </span>
            <label className="inline-flex items-center gap-1 text-[10px] text-slate-500">
              <input
                type="checkbox"
                checked={value.telegramOptIn}
                onChange={(e) => persist({ telegramOptIn: e.target.checked })}
                className="rounded border-slate-300"
              />
              Opt in
            </label>
          </div>
          <input
            type="text"
            value={value.telegramHandle || ''}
            onChange={(e) => onChange({ ...value, telegramHandle: e.target.value })}
            onBlur={(e) => persist({ telegramHandle: e.target.value })}
            placeholder="@yourhandle"
            className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-300 bg-white"
          />
          {mode === 'self' ? (
            <div className="mt-1.5 space-y-1">
              {isLinked ? (
                <span className="text-[10px] text-green-700 inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Connected
                </span>
              ) : (
                <button
                  onClick={requestTelegramLink}
                  disabled={linking}
                  className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 disabled:opacity-50 inline-flex items-center gap-1"
                >
                  {linking ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
                  Connect Telegram
                </button>
              )}
              {telegramUrl && (
                <div className="text-[10px] text-slate-600">
                  Open in Telegram and press Start:{' '}
                  <a href={telegramUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">{telegramUrl}</a>
                  {telegramCode && <span className="block text-slate-400 mt-0.5">Code expires in 30 min.</span>}
                </div>
              )}
            </div>
          ) : (
            <span className={`mt-1 inline-block text-[10px] ${isLinked ? 'text-green-700' : 'text-slate-400'}`}>
              {isLinked ? 'Bot is linked' : 'User must press Start in the Telegram bot themselves'}
            </span>
          )}
        </div>

        {/* WeChat — binding works by QR scan, not phone number.
            "Connect WeChat" mints a one-time scene code, asks the
            Official Account API for a parametric QR, and displays
            the QR image. The user scans + follows the Official
            Account; the webhook handler binds their OpenID and
            flips wechatOptIn = true. Same self-vs-staff split as
            Telegram. */}
        <div className="border border-slate-200 rounded-md p-2.5 bg-slate-50/40">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-slate-700 inline-flex items-center gap-1">
              <QrCode className="h-3.5 w-3.5" /> WeChat
            </span>
            <label className="inline-flex items-center gap-1 text-[10px] text-slate-500">
              <input
                type="checkbox"
                checked={value.wechatOptIn}
                onChange={(e) => persist({ wechatOptIn: e.target.checked })}
                className="rounded border-slate-300"
              />
              Opt in
            </label>
          </div>
          {/* Nickname placeholder — read-only; populated by the
              Account webhook on /SCAN. Useful so the user can
              eyeball "yes that's me". */}
          <div className="text-[10px] text-slate-500 italic mb-1 min-h-[14px]">
            {value.wechatNickname ? `Linked: ${value.wechatNickname}` : 'Bind a WeChat account by scanning a QR from your firm’s Official Account.'}
          </div>
          {mode === 'self' ? (
            <div className="mt-1 space-y-1">
              {value.wechatOpenId ? (
                <span className="text-[10px] text-green-700 inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Connected
                </span>
              ) : (
                <button
                  onClick={requestWeChatLink}
                  disabled={wechatLinking}
                  className="text-[10px] px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-100 disabled:opacity-50 inline-flex items-center gap-1"
                >
                  {wechatLinking ? <Loader2 className="h-3 w-3 animate-spin" /> : <QrCode className="h-3 w-3" />}
                  Connect WeChat
                </button>
              )}
              {wechatQrUrl && (
                <div className="text-[10px] text-slate-600">
                  {/* QR image hosted by WeChat. We render it directly
                      so users on mobile can long-press to save. */}
                  <img
                    src={wechatQrUrl}
                    alt="WeChat QR — scan to link your account"
                    className="w-32 h-32 mt-1 border border-slate-200 rounded bg-white"
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
            <span className={`mt-1 inline-block text-[10px] ${value.wechatOpenId ? 'text-green-700' : 'text-slate-400'}`}>
              {value.wechatOpenId ? 'WeChat is linked' : 'User must scan the QR + follow the Official Account themselves'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ChannelRow({
  label, icon, placeholder, number, optIn, onNumber, onOptIn, saving,
}: {
  label: string;
  icon: React.ReactNode;
  placeholder: string;
  number: string | null;
  optIn: boolean;
  onNumber: (v: string) => void;
  onOptIn: (v: boolean) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState(number || '');
  // Keep local draft in sync if parent overwrites the value (e.g.
  // after a save returns the normalised number).
  if (draft !== (number || '') && !saving && document.activeElement?.tagName !== 'INPUT') {
    setDraft(number || '');
  }
  return (
    <div className="border border-slate-200 rounded-md p-2.5 bg-slate-50/40">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold text-slate-700 inline-flex items-center gap-1">
          {icon} {label}
        </span>
        <label className="inline-flex items-center gap-1 text-[10px] text-slate-500">
          <input
            type="checkbox"
            checked={optIn}
            onChange={(e) => onOptIn(e.target.checked)}
            className="rounded border-slate-300"
          />
          Opt in
        </label>
      </div>
      <div className="relative">
        <input
          type="tel"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (draft !== (number || '')) onNumber(draft); }}
          placeholder={placeholder}
          className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-300 bg-white"
        />
        {saving && (
          <Loader2 className="h-3 w-3 animate-spin text-slate-400 absolute right-2 top-1/2 -translate-y-1/2" />
        )}
      </div>
    </div>
  );
}
