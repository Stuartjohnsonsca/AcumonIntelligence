/**
 * Microsoft Teams meeting integration via Graph API.
 * Uses client credentials flow (app-level) to fetch meetings and transcripts.
 * Requires OnlineMeetings.Read.All and CallRecords.Read.All app permissions.
 */

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// Reuse the same token pattern as microsoft-graph.ts
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getGraphToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.token;
  }

  const tenantId = process.env.AZURE_AD_TENANT_ID;
  const clientId = process.env.AZURE_AD_CLIENT_ID;
  const clientSecret = process.env.AZURE_AD_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Azure AD credentials not configured');
  }

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });

  if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

export interface TeamsMeeting {
  id: string;
  subject: string;
  startDateTime: string;
  endDateTime: string;
  participants: string[];
  joinUrl: string | null;
  hasTranscript: boolean;
}

/**
 * List recent Teams meetings for a user (by their Azure AD object ID).
 * Falls back to calendar events if onlineMeetings API isn't available.
 */
export async function listRecentMeetings(userObjectId: string, daysBack = 30): Promise<TeamsMeeting[]> {
  const token = await getGraphToken();
  const since = new Date(Date.now() - daysBack * 86400000).toISOString();

  // Try calendar events with Teams meetings filter
  const res = await fetch(
    `${GRAPH_BASE}/users/${userObjectId}/calendar/events?$filter=start/dateTime ge '${since}' and isOnlineMeeting eq true&$select=id,subject,start,end,onlineMeeting,attendees&$orderby=start/dateTime desc&$top=50`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) {
    console.error('[Teams] Failed to list meetings:', res.status, await res.text().catch(() => ''));
    return [];
  }

  const data = await res.json();
  const events = data.value || [];

  return events.map((e: any) => ({
    id: e.id,
    subject: e.subject || 'Untitled Meeting',
    startDateTime: e.start?.dateTime || '',
    endDateTime: e.end?.dateTime || '',
    participants: (e.attendees || []).map((a: any) => a.emailAddress?.name || a.emailAddress?.address || '').filter(Boolean),
    joinUrl: e.onlineMeeting?.joinUrl || null,
    hasTranscript: false, // Will check per-meeting when importing
  }));
}

/**
 * Get the transcript for a specific Teams meeting.
 * Tries the online meeting transcripts endpoint.
 * Returns plain text with speaker labels, or null if not available.
 */
export async function getMeetingTranscript(userObjectId: string, eventId: string): Promise<string | null> {
  const token = await getGraphToken();

  // First get the online meeting ID from the calendar event
  const eventRes = await fetch(
    `${GRAPH_BASE}/users/${userObjectId}/calendar/events/${eventId}?$select=onlineMeeting`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!eventRes.ok) return null;
  const event = await eventRes.json();
  const joinWebUrl = event.onlineMeeting?.joinUrl;
  if (!joinWebUrl) return null;

  // Try to get transcripts via the online meeting
  // This requires OnlineMeetingTranscript.Read.All permission
  try {
    // List transcripts
    const transcriptsRes = await fetch(
      `${GRAPH_BASE}/users/${userObjectId}/onlineMeetings?$filter=joinWebUrl eq '${encodeURIComponent(joinWebUrl)}'`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!transcriptsRes.ok) return null;
    const meetingsData = await transcriptsRes.json();
    const onlineMeetingId = meetingsData.value?.[0]?.id;
    if (!onlineMeetingId) return null;

    // Get transcript list
    const tListRes = await fetch(
      `${GRAPH_BASE}/users/${userObjectId}/onlineMeetings/${onlineMeetingId}/transcripts`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!tListRes.ok) return null;
    const tList = await tListRes.json();
    const transcriptId = tList.value?.[0]?.id;
    if (!transcriptId) return null;

    // Get transcript content as VTT
    const contentRes = await fetch(
      `${GRAPH_BASE}/users/${userObjectId}/onlineMeetings/${onlineMeetingId}/transcripts/${transcriptId}/content?$format=text/vtt`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!contentRes.ok) return null;
    const vttContent = await contentRes.text();
    return parseVttToPlainText(vttContent);
  } catch (err) {
    console.error('[Teams] Transcript fetch error:', err);
    return null;
  }
}

/**
 * Parse VTT subtitle format into plain text with speaker labels.
 * VTT format: timestamp lines followed by "Speaker Name: text"
 */
function parseVttToPlainText(vtt: string): string {
  const lines = vtt.split('\n');
  const textLines: string[] = [];
  let lastSpeaker = '';

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip WEBVTT header, empty lines, and timestamp lines
    if (!trimmed || trimmed === 'WEBVTT' || trimmed.includes('-->') || /^\d+$/.test(trimmed)) continue;

    // Check for speaker label pattern: "Speaker Name: text"
    const speakerMatch = trimmed.match(/^<v\s+([^>]+)>(.+)$/);
    if (speakerMatch) {
      const speaker = speakerMatch[1].trim();
      const text = speakerMatch[2].replace(/<\/v>/, '').trim();
      if (speaker !== lastSpeaker) {
        textLines.push(`\n${speaker}:`);
        lastSpeaker = speaker;
      }
      textLines.push(text);
    } else if (!trimmed.startsWith('<')) {
      textLines.push(trimmed);
    }
  }

  return textLines.join('\n').trim();
}

/**
 * Check if Teams integration is configured (has Azure AD credentials).
 */
export function isTeamsConfigured(): boolean {
  return !!(process.env.AZURE_AD_TENANT_ID && process.env.AZURE_AD_CLIENT_ID && process.env.AZURE_AD_CLIENT_SECRET);
}
