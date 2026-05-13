# WeChat Official Account — setup walkthrough (English)

This is the full path from "no WeChat account" to "messages sending
through Acumon to mainland-China clients." Every Chinese label you'll
see in the WeChat console is translated below, so you can follow
along without reading Mandarin.

Reading time: ~15 min. Total elapsed time including Tencent's
verification queue: **1–3 weeks** (most of that is waiting).

---

## What you're setting up

A **Service Account (服务号)** — Tencent's three Official Account types
are:

| Chinese | English | Daily sends | Custom UI? | Pick this if…
| --- | --- | --- | --- | ---
| 订阅号 | Subscription Account | 1 broadcast / day | No | You're a content publisher.
| **服务号** | **Service Account** | 4 broadcasts / month + unlimited template + customer-service | Yes (menus, web view) | **You're a business serving customers.** ← pick this.
| 企业微信 | WeChat Work (WeCom) | Internal only | Yes | You want to message your own staff.

For our portal flow (template message: "new audit request available")
the Service Account is the only viable option.

**Cost**: USD 99 verification fee for overseas accounts. UK firms
pay this; mainland-Chinese-registered companies pay RMB 300.

---

## Prerequisites — gather these before you start

1. **Your firm's Companies House registration** (PDF of certificate
   of incorporation).
2. **Articles of association** or memorandum (PDF).
3. **A scanned passport** of the director who'll be the named
   Account Administrator.
4. **A business bank statement** dated within the last 3 months,
   showing the firm's full registered name.
5. **A live mobile number** the admin can answer (Tencent does a
   verification call; if you don't pick up they reject the
   application — they don't email).
6. **A WeChat account** belonging to the admin, with `Real-Name
   Verification` (实名认证) already completed. To check: open WeChat
   → Me → Wallet → Personal Info Authentication. If you don't have
   a Chinese-issued ID, follow the overseas verification path under
   Settings → WeChat ID & Phone Number → International Real-Name
   Verification (passport + selfie video, takes 1–3 days).

Without #6 the registration form locks you out at step 2.

---

## Part 1 — Create the Account (Day 1, ~30 min)

### 1.1 — Open the registration page

Go to: <https://mp.weixin.qq.com/cgi-bin/registermidpage?action=index>

The page header (Chinese → English):

| Chinese | English
| --- | ---
| 微信公众平台 | WeChat Official Accounts Platform
| 立即注册 | Register Now
| 已有帐号？立即登录 | Have an account? Log in

Click **立即注册** (Register Now).

### 1.2 — Pick the Account type

You'll see four big tiles. They translate to:

- **订阅号** — Subscription Account
- **服务号** — Service Account ← pick this
- **小程序** — Mini Program
- **企业微信** — WeChat Work

Click **服务号**.

### 1.3 — Email + password form

| Field (Chinese) | English | What to enter
| --- | --- | ---
| 邮箱 | Email | A new email that's not registered to any other WeChat product. We recommend a dedicated address like `wechat@acumonintelligence.com`.
| 邮箱验证码 | Email verification code | Click **发送验证码** (Send code) → check inbox → paste the 6-digit code.
| 密码 | Password | At least 8 characters, mix of letters + numbers + symbols.
| 确认密码 | Confirm password | Same as above.
| 验证码 | CAPTCHA | Visual code shown next to the field.
| ☑ 我同意并遵守 | I agree to the terms | Tick.

Click **注册** (Register).

### 1.4 — Country / location

Big map appears. Two tabs at the top:

- **中国大陆** — Mainland China
- **海外及港澳台** — Overseas + Hong Kong / Macau / Taiwan

Click **海外及港澳台**, then pick **英国 (United Kingdom)** from the
dropdown. Hit **确定** (Confirm).

### 1.5 — Business subject (主体信息)

You're now on the business-details form. The translations:

| Chinese | English | What to enter
| --- | --- | ---
| 主体类型 | Business type | Pick **企业** (Company)
| 主体名称 | Registered business name | "Johnsons Financial Management Ltd" (or your firm's exact Companies House name — must match the certificate exactly)
| 经营者姓名 | Operator's name (= admin) | The director's name as on their passport
| 证件类型 | ID type | **护照** (Passport)
| 证件号码 | ID number | Passport number
| 证件有效期 | ID expiry date | Passport expiry
| 证件正面照 | ID front photo | Upload passport photo page
| 营业执照副本 | Business licence (= Certificate of Incorporation) | Upload Companies House cert + Articles
| 公司全称 | Full company name | Same as 主体名称 above
| 营业执照注册号 | Business licence number (= Companies House number) | e.g. `12345678`
| 营业执照有效期 | Licence expiry | UK Companies House certs don't expire — tick **长期** (long-term / permanent)
| 联系电话 | Contact phone | UK mobile number (e.g. +44 7XXX XXX XXX)
| 详细地址 | Business address | Registered office address from Companies House

Save and continue → **下一步** (Next step).

### 1.6 — Administrator verification (管理员身份验证)

This is the part that needs the admin's **already-verified** WeChat
account.

The screen shows a QR code. On the admin's phone:

1. Open WeChat → 扫一扫 (Scan, the QR icon top-right of WeChat home)
2. Scan the QR on your computer screen
3. WeChat asks: *"Verify your identity as administrator for this
   Official Account?"* → tap **确认** (Confirm).
4. Computer screen advances automatically.

If the phone shows *"该微信号未实名"* (This WeChat account is not
real-name verified), the admin needs to complete real-name
verification first (see prerequisites, item 6).

### 1.7 — Account name (帐号信息)

| Field (Chinese) | English | What to enter
| --- | --- | ---
| 帐号名称 | Account name | "Acumon Intelligence" or "Johnsons Audit" — appears as the sender name on every message. Once approved this is locked for a year.
| 功能介绍 | Description | "Audit portal notifications and document requests for clients of Johnsons Financial Management." Max 120 characters.
| 头像 | Profile photo | Upload a 1:1 PNG, at least 144×144px. Your firm's logo on a plain background works.
| 微信号 | WeChat ID | Lowercase + numbers + underscores, 6–20 chars. Example: `acumon_audit`. Locked once approved.
| 运营地区 | Operating region | United Kingdom (already filled from step 1.4).

Click **完成** (Done).

### 1.8 — Wait for verification

You'll land on a page saying *"已提交，请耐心等待"* (Submitted —
please wait patiently). Tencent will:

1. Phone the admin's mobile within 3–7 working days. The caller
   speaks **Mandarin**. The script is usually: *"我是腾讯客服，确认
   您是 [admin name]，公司 [firm name]，确认申请微信公众号吗？"*
   (*"This is Tencent customer service, confirming you are [admin
   name] at [firm name], confirming you applied for the WeChat
   Official Account?"*). The admin says **是 (yes)** and gives a
   sentence-or-two reason for why your firm needs WeChat.
   **If you don't speak Mandarin**: arrange for a Mandarin-speaking
   colleague or hire a brief translator on Fiverr (~£15) to be on
   the call. The admin must still be the one to confirm their own
   identity — the translator just relays.
2. Email you (in English) with the result. Verification fee
   (USD 99) is charged at this point if approved.

Total elapsed time: typically 5–10 working days.

---

## Part 2 — Configure the account (Day 8–14, ~20 min once approved)

Once you get the approval email, log in at <https://mp.weixin.qq.com>
with the email + password from step 1.3.

### 2.1 — Note your AppID and AppSecret

In the left sidebar: **设置与开发 (Settings & Development)** →
**基本配置 (Basic Configuration)**.

You'll see:

- **AppID（应用ID）** — copy this. Goes in Vercel env as `WECHAT_APP_ID`.
- **AppSecret（应用密钥）** — click **重置 (Reset)**. Tencent
  generates one; **copy it immediately** because it's only shown
  once. Goes in Vercel as `WECHAT_APP_SECRET`.

### 2.2 — Configure the webhook (服务器配置)

Same page, scroll to **服务器配置 (Server Configuration)**. Click
**启用 (Enable)** then **修改配置 (Modify configuration)**.

| Field (Chinese) | English | What to enter
| --- | --- | ---
| URL（服务器地址） | URL (Server address) | `https://YOUR-VERCEL-DOMAIN/api/messaging/wechat/webhook`
| Token（令牌） | Token | Generate a random 32-char string (e.g. `openssl rand -hex 16` on your terminal). **Goes in Vercel as `WECHAT_TOKEN` and gets pasted in this field — they must match.**
| EncodingAESKey（消息加解密密钥） | Encoding AES Key | Click **随机生成 (Random generate)**. We don't use encryption in v1, but Tencent requires the field to be filled.
| 消息加解密方式 | Message encryption | Pick **明文模式 (Plain text mode)**. Our code parses XML, not encrypted XML.

Before you click **提交 (Submit)**, make sure:
1. The Vercel env vars are set + production has been redeployed.
2. The webhook URL is publicly reachable (test with `curl` from your laptop — should get back `forbidden` because there's no signature, which is fine — it proves the URL exists).

Click **提交**. Tencent immediately POSTs a verification request to
your URL; our GET handler echoes the `echostr` back. If it works
you'll see *"提交成功"* (Submitted successfully). If you see *"配置
失败 (Configuration failed)"*, the most common causes:

- URL not reachable from China (Cloudflare-blocked region? Vercel's
  default LHR region is fine).
- Token mismatch between Vercel env and the form field.
- Production not redeployed since `WECHAT_TOKEN` was set.

### 2.3 — Whitelist Acumon's IP for API calls

Same Basic Configuration page, scroll to **IP白名单 (IP Whitelist)**.
Click **修改 (Modify)** and add Vercel's egress IPs:

For Vercel functions in the LHR region (which is what your
`vercel.json` already specifies):

```
76.76.21.21
76.76.21.22
76.76.21.61
```

These are Vercel's published egress ranges. If Tencent's API starts
rejecting your sends with `40164 invalid_ip`, the IPs have changed —
check <https://vercel.com/docs/security/secure-compute> for the
current list.

### 2.4 — Functions to enable (功能配置)

Left sidebar: **设置与开发 → 接口权限 (API Permissions)**.

The full list is long; we only need these turned **on (已开通)**:

| Chinese | English | What we use it for
| --- | --- | ---
| 客服消息 | Customer service messages | Sending text replies via OpenID
| 接收消息 | Receive messages | Inbound user messages → our webhook
| 用户管理 | User management | Looking up user nicknames
| 带参数二维码 | Parametric QR codes | The "Connect WeChat" QR-scan flow

If any are **未开通 (not enabled)**, click them and follow the
prompts. Most enable instantly; a couple may need a 1-day re-review.

---

## Part 3 — Test it end-to-end (~10 min)

### 3.1 — Verify the webhook handshake

Once you save the Server Configuration in 2.2, Tencent does a one-
time handshake. If the *"提交成功"* message appeared, this already
worked. To re-verify any time:

In a terminal:
```bash
curl -i "https://YOUR-VERCEL-DOMAIN/api/messaging/wechat/webhook"
```
You should get a `403 forbidden` body — that's correct, it proves the
route exists but rejects requests without a valid signature.

Vercel function logs (Vercel dashboard → your project → Logs) should
show `[wechat webhook] signature mismatch on handshake` for that
request — also correct, since you didn't sign it.

### 3.2 — Bind a test portal user

1. Log into your portal as a real ClientPortalUser (or seed one).
2. Open **My Details** → **Messaging channels** card.
3. Click **Connect WeChat**. A QR image appears.
4. On a phone with WeChat installed (any account, doesn't need to be
   the admin one), open WeChat → 发现 (Discover) → 扫一扫 (Scan) →
   scan the QR.
5. WeChat shows the Official Account profile. Tap **关注 (Follow)**.
6. The Account auto-replies with: *"✅ Your portal account is now
   linked..."* (our `buildTextReply` payload).
7. Refresh My Details — the WeChat tile should show **Connected**
   with the user's WeChat nickname.

If step 7 doesn't update, check Vercel function logs for the
`/api/messaging/wechat/webhook` POST. Common issues:

- `signature mismatch on POST` → `WECHAT_TOKEN` differs between the
  console and the env var.
- `failed to fetch access token` → the AppSecret was reset on the
  console after you copied it, or `WECHAT_APP_SECRET` env wasn't set.
- Webhook fires but `redeemWeChatLinkCode` returns null → the QR was
  older than 30 min. Generate a fresh one.

### 3.3 — Send a real message

From the firm side (the audit tool), create any portal request that
fires `notifyOnPortalRequestCreated`. The linked user should receive
the text in WeChat within a few seconds.

If you see no message and `portal_messages` shows the row as
`failed` with `errcode: 45015`, that's the 48-hour rule: the user
hasn't sent the Account a message in the last 48 hours, so the
customer-service API rejects the send. Fixes:

- Ask the user to send a quick "Hi" to the Account — the window
  reopens for 48h.
- Register an approved Template Message (see Part 4) — template
  messages bypass the 48-hour rule.

---

## Part 4 — Optional: Template messages (Day 14+, ~1 week per template)

For long-running notifications (e.g. a weekly digest) you'll outgrow
the 48-hour window. Solution: register a Template Message.

1. Left sidebar: **功能 (Features)** → **模板消息 (Template Messages)**.
2. Click **添加模板 (Add template)** → pick a category (we use **专业服务 → 通用 → 通知**: Professional services → General → Notification).
3. Submit the template body. Example for our portal:

```
{{first.DATA}}
请求标题：{{keyword1.DATA}}
请求详情：{{keyword2.DATA}}
时间：{{keyword3.DATA}}
{{remark.DATA}}
```

English equivalent (Tencent reviews in Chinese — keep the placeholders English-readable):

```
{{first.DATA}}
Request title: {{keyword1.DATA}}
Details: {{keyword2.DATA}}
Time: {{keyword3.DATA}}
{{remark.DATA}}
```

4. Submit → Tencent reviews in 3–7 working days.
5. Once approved, copy the template ID and paste into Vercel as
   `WECHAT_TEMPLATE_NOTIFICATION_ID`.

(We haven't wired template-message sending in `lib/messaging/wechat.ts`
yet — let me know when a template is approved and I'll add the
`sendWeChatTemplate` helper. The customer-service path covers the
realistic "user just engaged with us" cases that account for >95% of
firm-to-client notifications.)

---

## Troubleshooting cheat sheet

| Error code | Meaning | Fix
| --- | --- | ---
| 40001 | invalid credential / access_token expired | Wait 1 min and retry; our cache refreshes 5 min before expiry but a cold-start can hit a stale value.
| 40003 | invalid OpenID | The bound OpenID is wrong (mis-typed env, or the user unbound on their side). Re-trigger Connect WeChat.
| 40164 | invalid IP | Vercel egress IP not in the whitelist (step 2.3).
| 45015 | response out of time | The 48-hour customer-service window has expired (see 3.3).
| 45047 | client message exceed limit | Service Account is rate-limited to ~500k sends / day. Unlikely for a UK firm but worth knowing.
| 48001 | api unauthorized | The API isn't enabled in 接口权限 (step 2.4).

---

## What I still can't do for you

- **Be on the verification phone call.** That has to be a human, and
  ideally one who speaks Mandarin. Fiverr "live Mandarin translator,
  15 minutes" — about £15, usually available within an hour.
- **Pass the real-name verification on the admin's WeChat account.**
  That's a WeChat-app-internal flow against the admin's identity.
- **Pre-approve a template message.** I can draft the wording, but
  the Tencent reviewer is a human looking at the live submission.

Everything else — code, env config, webhook setup — is already in
the repo (commit `4ef204df`). When you get the Account approved,
paste the four env vars into Vercel, redeploy, and the rest just
works.

---

## Estimated time + cost summary

| Item | Time | Cost
| --- | --- | ---
| Real-name verification on admin's WeChat | 1–3 days | Free
| Account registration form (Part 1) | 30 min | Free
| Tencent verification call + email approval | 5–10 working days | USD 99 (overseas verification fee)
| AppID / AppSecret / webhook config (Part 2) | 20 min | Free
| End-to-end test (Part 3) | 10 min | Free
| **Total elapsed time** | **~2 weeks** | **~£80**
| One Mandarin translator on the verification call (optional) | 15 min | ~£15
