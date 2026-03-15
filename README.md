# Acumon Intelligence Website

The main portal website for Acumon Intelligence at www.acumonintelligence.com.

## Tech Stack
- **Next.js 14** (App Router)
- **TypeScript**
- **Tailwind CSS** + **shadcn/ui**
- **NextAuth.js v5** (Credentials + 2FA email OTP)
- **Prisma** ORM
- **Supabase** (PostgreSQL)
- **Nodemailer** (Office 365 SMTP for email)
- **Stripe** (placeholder - to be configured)

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment variables
Copy `.env.example` to `.env.local` and fill in:
- `DATABASE_URL` — Supabase connection string (with your DB password)
- `DIRECT_URL` — Supabase direct URL
- `NEXTAUTH_SECRET` — any random 32-char string
- `SMTP_PASSWORD` — agents@acumon.com Exchange password

### 3. Push database schema
```bash
npx prisma db push
```

### 4. Seed initial data
```bash
npm run db:seed
```

This creates:
- Johnsons Financial Management firm
- Stuart Thomson (ST001) as Super Admin
- All 10 products with pricing

### 5. Run locally
```bash
npm run dev
```

Visit http://localhost:3000

## Deployment

Push to GitHub → Vercel auto-deploys.

Set all environment variables in Vercel Project Settings → Environment Variables.

## Role hierarchy
- **Super Admin** — system-wide, manages products and firms
- **Firm Admin** — manages users, subscriptions for their firm
- **Portfolio Owner** — manages clients and assigns subscriptions
- **User** — accesses tools for assigned clients with active subscriptions
