/**
 * Shared messaging types — Portal WhatsApp / Telegram / SMS.
 *
 * Each channel has a thin provider module (twilio.ts, telegram.ts)
 * that translates these neutral shapes into the provider's wire
 * format. The orchestrator in ./index.ts loops over channels for a
 * given portal user and persists every send + every reply into the
 * portal_messages table so the audit trail on a request shows
 * exactly what was sent and what came back.
 */

export type MessageChannel = 'whatsapp' | 'telegram' | 'sms' | 'wechat';
export type MessageDirection = 'outbound' | 'inbound';
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

export interface OutboundMessage {
  /** Stored on the portal_messages row + used for tooling. */
  channel: MessageChannel;
  /** Plain-text body. Providers handle encoding / length splitting. */
  body: string;
  /** Optional media URLs (publicly reachable HTTPS). Twilio supports up
   *  to 10 MMS / WhatsApp media items; Telegram supports per-call
   *  attachments via separate API calls — see telegram.ts. */
  mediaUrls?: string[];
  /** The destination — phone (E.164) for SMS/WhatsApp, numeric chat_id
   *  for Telegram. Provider modules validate per-channel. */
  to: string;
}

export interface SendResult {
  ok: boolean;
  /** Provider-side message id when the send was accepted. Stored on
   *  the portal_messages row so delivery callbacks can match. */
  providerMessageId?: string;
  /** Provider's raw response, persisted verbatim for debugging. */
  providerRaw?: unknown;
  /** Error string when ok=false. */
  error?: string;
}

export interface InboundMessage {
  channel: MessageChannel;
  /** Sender address — phone (E.164) for SMS/WhatsApp, numeric chat_id
   *  for Telegram. The dispatcher uses this to find the
   *  ClientPortalUser. */
  from: string;
  /** Optional destination address (for logging). */
  to?: string;
  body: string;
  mediaUrls?: string[];
  providerMessageId?: string;
  /** Full payload from the provider — kept verbatim. */
  providerRaw?: unknown;
}
