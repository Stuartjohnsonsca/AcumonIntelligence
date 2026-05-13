# WeCom (企业微信 / WeChat Work) setup walkthrough

> **Updated 2026-05-13.** The previous version of this doc had the audit team
> paste a per-engagement WeCom Group Robot URL on the Opening tab. That
> field is gone — clients now self-serve their notification preference
> via a single-select radio button on `/portal/my-details`, reached via
> a one-click "Send communication preferences invite" button on the
> engagement's Opening tab. WeCom is still the backend; clients still
> use consumer WeChat. The Group Robot URL is now a firm-wide fallback
> in `WECOM_GROUP_WEBHOOK_URL` env, used only when a client picks
> WeChat preference but the External Contact path (paid follow-up)
> isn't yet wired.


You've signed up for WeCom — good. The console **has an English UI**
(toggle in the top-right corner if it's defaulted to Chinese), so
this guide is more about which menu to click than about translating
Mandarin labels.

Two consumer-client-facing patterns are realistic:

| Pattern | What it is | When to use it
| --- | --- | ---
| **Group Robot webhook** | A bot in a WeCom group chat with a fixed POST URL. We POST → bot relays into the group. | Per-engagement notification thread, audit team + client in the same group. **Use this first.** Free, 5 min setup, no API approval.
| External Contact API | Per-client direct messages via the API. Audit firm employee uses WeCom; client uses consumer WeChat. | When you outgrow group chats and want 1:1 automated DMs. Needs WeCom Pro and an API approval round.

This walkthrough covers **Group Robot**, which is what the code in
`commit 4ef204df` and the follow-up commit you're reading now
expects.

---

## Part 1 — Verify your WeCom organization (Day 1, 10 min)

You've signed up but the account starts in an unverified state. Two
features we need are gated behind verification:

- External Contact (so clients on WeChat can be added to groups)
- Group Robot (works without verification, but verified orgs get a
  10× higher daily send quota — 30k vs 3k)

### 1.1 — Switch the console to English

Top right corner of <https://work.weixin.qq.com>, click the language
chip. Pick **English**. Most pages translate; a few (mostly admin
overlay popups) stay in Chinese.

### 1.2 — Verify the organisation

Left sidebar: **My Company** → **Authentication**.

You'll see three options:

- **WeChat verification** — for mainland-Chinese-registered
  companies. Skip.
- **Authentication for overseas enterprises** — for UK firms. ← pick this.
- **Authentication via 3rd party** — paid service, skip.

Click **Authenticate** under the overseas option. The form asks for:

| Field | What to upload / enter
| --- | ---
| Country / Region | United Kingdom
| Legal Name | Your firm's exact Companies House name
| Registration Number | Companies House number
| Registration Certificate | PDF of certificate of incorporation
| Legal Representative Name | Director's name as on passport
| Legal Representative ID Type | Passport
| Legal Representative ID Number | Passport number
| Legal Representative ID Scan | Passport photo page
| Business Address | Registered office
| Business Phone | UK number (no verification call this time — just for the record)

Submit. Tencent reviews in **3–5 working days**. Cost: **USD 99**.

While you wait, you can already use Group Robots — verification only
raises the quota.

---

## Part 2 — Configure an internal app (Day 5, 15 min)

Even for Group Robots we want one "Acumon" app registered so
external contacts and groups can be tracked under a single agent.

### 2.1 — Create the app

Left sidebar: **App Management** → **Create App**.

| Field | What to enter
| --- | ---
| App Logo | Your firm's logo (PNG, 1024×1024 recommended)
| App Name | "Acumon Audit"
| App Description | "Audit portal notifications and document requests."
| Visible Range | Select **All Members** for now; you can narrow later.

Save. You land on the app detail page. Note these two fields — they
become Vercel env vars later (only needed if you upgrade to App
Message; not required for Group Robot):

- **AgentId** → Vercel env `WECOM_AGENT_ID`
- **Secret** (click **View** to reveal) → Vercel env `WECOM_APP_SECRET`

While you're on that page, scroll to **Receive Messages**. We don't
enable an inbound webhook for v1 — WeCom group-robot inbound (clients
replying in the group) isn't a thing; clients reply by typing into
the group like any normal chat and the messages stay inside WeCom,
not surfaced back to Acumon. That's a v2 feature if you need it.

### 2.2 — Note your Corp ID

Left sidebar: **My Company** → scroll to bottom → **Corporation
Info**.

- **Corp ID** (CorpID) → Vercel env `WECOM_CORP_ID`

That's all the dashboard config for Part 2. Group Robots don't
actually use the Corp ID / AgentId / Secret — they have their own
self-contained webhook URLs. But registering the app means when you
later opt into the App Message API path (for staff notifications, see
"Beyond Group Robots" below) the values are already in place.

---

## Part 3 — Create an engagement-level Group Robot (5 min per engagement)

This is the per-engagement setup the audit team will repeat for each
client engagement. Roughly 5 minutes once you know the path.

### 3.1 — Create the WeCom group

Open the WeCom **desktop app** (not the browser console — group
creation is mobile/desktop only). Top of the contacts list, click
**+** → **Create Group Chat**.

Members to add:
- Yourself + every audit team member assigned to the engagement.
- The client contact(s) — they'll need to be on WeCom OR added as
  External Contacts (see 3.4 below for mainland-China clients still
  using consumer WeChat).

Name the group something like *"Acme Ltd — Audit FY26 — Portal
Notifications"* so it doesn't get lost in your contact list.

### 3.2 — Add the Group Robot

Inside the group chat:

- Desktop: click the **⋯** (three dots) in the top-right of the chat
  → **Group Robots** → **Add Robot**.
- Mobile: tap the group name at the top → scroll down → **Group
  Robots** → **Add**.

The console will ask for a **Robot Name**. Use "Acumon Monitoring" or
similar. Click **Add**.

### 3.3 — Copy the webhook URL

After the robot is added, click it in the robot list. You'll see:

- **Webhook URL**: `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`

Click **Copy**.

**Save this URL safely** — it grants posting access to the group.
Anyone with the URL can send into the group, so treat it like a
password. If it leaks, click **Reset** on the same screen to rotate.

### 3.4 — (Optional) Add a mainland-China client as External Contact

Most realistic mainland clients use consumer WeChat, not WeCom. To
bring them into your WeCom group:

1. Inside the group chat: click **⋯** → **Invite External Contact**.
2. WeCom shows a QR + an invite link.
3. Send that to your client (email, WhatsApp — whatever works).
4. They open the link in their WeChat (consumer app, not WeCom).
5. They tap **Join Group**. WeCom verifies their consumer-WeChat
   account is permitted to talk to a verified WeCom org.
6. They appear in the group as an External Contact, distinguished by
   a small **外部** (external) tag next to their name.

For unverified WeCom orgs (i.e. during Part 1's 3–5 day wait) the
External Contact feature is restricted to 50 contacts per employee.
After verification: unlimited.

---

## Part 4 — Paste the webhook into Acumon (2 min)

Two places use the WeCom Group Robot webhook URL. **The Opening-tab
field is the per-engagement one you'll use most often.**

### 4.1 — Per-engagement portal notifications (Opening tab)

Open the audit tool → the engagement → **Opening tab** → scroll to
**Audit File Settings** → **WeCom group webhook (per engagement)**.

Paste the URL from step 3.3. The field saves on blur — a small
"Saved." appears next to it.

From now on, every portal request alert fires both:
- **Per-user channels** (SMS / WhatsApp / Telegram / WeChat — based
  on each portal user's opt-ins), AND
- **The engagement's WeCom group** — same message body lands in the
  group so the audit team + clients you've added via External
  Contact see the alert in WeCom alongside their personal channels.

The two delivery paths are independent. The WeCom post fires even
when no portal user is assigned yet — useful for the gap between
"audit team raised a request" and "Principal allocated it to a
staff member."

### 4.2 — Monitoring Reports (per-report WeCom URL)

Same shape, different audience. Use this when you want the
**weekly digest** going to a specific group that may differ from
the alert group (e.g. partner-only group for monitoring reports,
audit team + client for portal alerts).

Open the audit tool → the engagement → Opening tab → **Monitoring
Reports** → New report (or edit existing) → **Delivery** → tick
**WeCom (企业微信)** → paste URL → Save.

### 4.3 — Firm-wide fallback (optional)

If most engagements share the same group you can set a firm-wide
default in Vercel:

```
WECOM_GROUP_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...
```

This is the last-resort target for the WeChat channel in
`notifyPortalUser` whenever neither the user nor the engagement has
its own WeCom URL. Most setups will configure per-engagement URLs
on the Opening tab and leave this unset.

---

## Part 5 — Test it (2 min)

The fastest sanity check:

```bash
curl -X POST "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=XXXX" \
  -H 'Content-Type: application/json' \
  -d '{"msgtype":"text","text":{"content":"Hello from terminal — if you see this, the webhook works."}}'
```

You should see the message appear in the WeCom group instantly. The
response body is `{"errcode":0,"errmsg":"ok"}`.

If the response says `{"errcode":93000,"errmsg":"...not exist..."}`
the URL is wrong — re-copy from the dashboard (step 3.3).

To test the Acumon integration end-to-end:
1. Open the audit tool → an engagement → Opening tab → Monitoring
   Reports → pick the report you set up in step 4.1 → **Run now**.
2. Watch the WeCom group — within 10 seconds the digest lands.

---

## Limitations to know about

- **Send quota**: Group Robots are capped at **20 messages per
  minute per group** and **30,000 per day** (verified org) or
  **3,000 per day** (unverified). For an audit firm with a handful
  of weekly digests this is plenty.
- **No inbound**: clients can chat in the group but those replies
  stay inside WeCom. We don't pull them back into the Acumon portal
  (unlike Twilio SMS/WhatsApp inbound which does land back as a
  PortalRequest reply). If that becomes important, the upgrade is
  the WeCom **External Contact API** — costs paid-tier WeCom + an
  API approval round, and roughly 3 days of work to wire up. Worth
  doing when you have 10+ engagements using WeCom regularly.
- **Markdown rendering**: group robots support a `msgtype:
  'markdown'` mode but only a small subset of Markdown actually
  renders inside the WeCom app. We send plain text by default — the
  Markdown path is in `lib/messaging/wecom.ts` if you want to
  experiment.
- **Group robot URL = posting key**: anyone with that URL can post.
  Don't paste it into a public Git repo, ticket, or screenshot. The
  Reset button in the robot detail screen rotates it instantly.

---

## Env vars summary

For the Group Robot path (this commit):

```
WECOM_GROUP_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...
  # Optional — only set this if you want a firm-wide default. Per-
  # report webhook URLs (Monitoring Reports → Delivery → WeCom) take
  # precedence over this.
```

For the App Message path (not yet wired into the orchestrator — set
these only when you opt into App Message later):

```
WECOM_CORP_ID=...
WECOM_AGENT_ID=...
WECOM_APP_SECRET=...
```

The previous WeChat Official Account env vars (`WECHAT_APP_ID`,
`WECHAT_APP_SECRET`, `WECHAT_TOKEN`) can stay unset — the
orchestrator falls back gracefully when only the WeCom variables
are present.

---

## Total cost + time

| Item | Time | Cost
| --- | --- | ---
| WeCom account signup | Done | Free
| Overseas verification | 3–5 working days waiting | USD 99
| App registration | 10 min once approved | Free
| Per-engagement group + robot | 5 min per engagement | Free
| Paste URL into Acumon | 2 min per engagement | Free

Plus zero monthly fee for unlimited robots.

---

## Beyond Group Robots — when to upgrade

If you find you want:

- **1:1 automated DMs** to clients (not a shared group)
- **Inbound replies** to flow back into the Acumon portal
- **Per-client** templated messages

That's the **External Contact API**. It needs:

- WeCom Pro ($199/year)
- Approved API access (one form, 3–5 day review)
- A second wave of code in `lib/messaging/wecom.ts` to use the
  `/cgi-bin/externalcontact/add_msg_template` endpoint instead of
  the group-robot URL

Tell me when you're ready and I'll add it — the rest of the
plumbing (channels, schema, opt-ins, UI) is already in place.
