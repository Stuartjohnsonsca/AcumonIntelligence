/**
 * sent.dm provider — unified SMS + WhatsApp messaging.
 *
 * sent.dm is a single-integration API that delivers across SMS and
 * WhatsApp (and RCS). We use it as the primary provider for both
 * channels; if sent.dm rejects a send (template not approved, account
 * over quota, transient 5xx, etc.) the orchestrator falls back to
 * Twilio so a configured customer always has a path out.
 *
 * Important constraint: sent.dm always sends via TEMPLATES — there is
 * no free-form body field. The firm must create a template in the
 * sent.dm dashboard once (e.g. "Acumon portal alert: {{body}} — open
 * the portal at {{link}}") and put its id in SENT_DM_TEMPLATE_ID.
 *
 * The body of the OutboundMessage we receive from the orchestrator is
 * passed in as the `body` template parameter. Optional link extraction
 * lifts the first https:// URL out of the body into the `link`
 * parameter so the template can render it as a clickable CTA — both
 * are no-ops on templates that don't reference those variables.
 *
 *   https://docs.sent.dm/
 *   POST https://api.sent.dm/v3/messages
 *   header: x-api-key: <key>
 *   body: { to, template: { id, parameters }, channel: [...] }
 */

import type { MessageChannel, OutboundMessage, SendResult } from './types';
import { getProviderConfig, type SentDmConfig } from './provider-config';

const SENT_DM_API_BASE = 'https://api.sent.dm';

export async function isSentDmConfigured(): Promise<boolean> {
  const { enabled, config } = await getProviderConfig<SentDmConfig>('sent_dm');
  return enabled && !!config.apiKey && !!config.templateId;
}

/** Channel-specific template-id overrides. Falls back to the shared
 *  templateId so most firms only need to configure one. */
async function templateIdForChannel(channel: 'sms' | 'whatsapp'): Promise<string | undefined> {
  const { config } = await getProviderConfig<SentDmConfig>('sent_dm');
  if (channel === 'sms' && config.smsTemplateId) return config.smsTemplateId;
  if (channel === 'whatsapp' && config.whatsappTemplateId) return config.whatsappTemplateId;
  return config.templateId;
}

/** Send an SMS via sent.dm using the configured template. */
export async function sendSentDmSms(msg: OutboundMessage): Promise<SendResult> {
  return sendSentDmMessage('sms', msg);
}

/** Send a WhatsApp message via sent.dm using the configured template. */
export async function sendSentDmWhatsApp(msg: OutboundMessage): Promise<SendResult> {
  return sendSentDmMessage('whatsapp', msg);
}

async function sendSentDmMessage(channel: 'sms' | 'whatsapp', msg: OutboundMessage): Promise<SendResult> {
  try {
    const { config } = await getProviderConfig<SentDmConfig>('sent_dm');
    const apiKey = config.apiKey;
    if (!apiKey) return { ok: false, error: 'sent.dm API key not set (apiKey).' };
    const templateId = await templateIdForChannel(channel);
    if (!templateId) return { ok: false, error: `No sent.dm template id configured for ${channel}` };

    // Strip the `whatsapp:` prefix Twilio's stack adds — sent.dm
    // expects a plain E.164 number.
    const to = msg.to.replace(/^whatsapp:/, '').trim();
    if (!to) return { ok: false, error: 'Recipient phone number is empty' };

    // Lift the first HTTPS URL out of the body so the template can
    // render it as a CTA separately from the prose. Most portal-alert
    // templates will reference both {{body}} and {{link}}.
    const linkMatch = msg.body.match(/https:\/\/\S+/);
    const link = linkMatch ? linkMatch[0] : '';
    const bodyWithoutLink = link ? msg.body.replace(link, '').replace(/\s+$/, '') : msg.body;

    const payload = {
      to: [to],
      template: {
        id: templateId,
        parameters: {
          // Both keys are passed; sent.dm ignores unused parameters
          // silently so the template author picks which they need.
          body: bodyWithoutLink || msg.body,
          link: link || '',
        },
      },
      channel: [channel],
    };

    const res = await fetch(`${SENT_DM_API_BASE}/v3/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      // sent.dm error shape varies; surface whatever message it gives
      // us so the run row's errorMessage is actionable.
      const detail = json?.message || json?.error || `HTTP ${res.status}`;
      return { ok: false, error: detail, providerRaw: json };
    }
    // The successful response includes a messageId we persist on the
    // portal_messages row so delivery callbacks can be matched later.
    const providerMessageId =
      typeof json?.messageId === 'string' ? json.messageId :
      typeof json?.id === 'string' ? json.id :
      undefined;
    return { ok: true, providerMessageId, providerRaw: json };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}
