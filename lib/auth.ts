import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { generateOTP } from '@/lib/utils';
import { sendTwoFactorCode } from '@/lib/email';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      issuer: 'https://login.microsoftonline.com/common/v2.0',
      authorization: {
        url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        params: {
          scope: 'openid profile email',
        },
      },
      token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      userinfo: 'https://graph.microsoft.com/oidc/userinfo',
      jwks_endpoint: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    }),
    Credentials({
      id: 'credentials',
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        // Temporary test login — remove before go-live
        if (credentials.email === 'stuart@acumon.com' && credentials.password === 'testtest') {
          const user = await prisma.user.findUnique({
            where: { email: 'stuart@acumon.com' },
            include: { firm: true },
          });
          if (user) {
            return {
              id: user.id,
              email: user.email,
              name: user.name,
              twoFactorVerified: true,
              twoFactorPending: false,
              isSuperAdmin: user.isSuperAdmin,
              isFirmAdmin: user.isFirmAdmin,
              isPortfolioOwner: user.isPortfolioOwner,
              isMethodologyAdmin: user.isMethodologyAdmin,
              isResourceAdmin: (user as any).isResourceAdmin ?? false,
            isTestBuilder: (user as any).isTestBuilder ?? false,
              firmId: user.firmId,
              firmName: user.firm.name,
              displayId: user.displayId,
            };
          }
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
          include: { firm: true },
        });

        if (!user || !user.isActive) return null;

        // Check expiry
        if (user.expiryDate && user.expiryDate < new Date()) return null;

        const isValid = await bcrypt.compare(credentials.password as string, user.passwordHash);
        if (!isValid) return null;

        // 2FA bypass mode — set DISABLE_2FA=true in env to skip email verification temporarily
        if (process.env.DISABLE_2FA === 'true') {
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            twoFactorVerified: true,
            twoFactorPending: false,
            isSuperAdmin: user.isSuperAdmin,
            isFirmAdmin: user.isFirmAdmin,
            isPortfolioOwner: user.isPortfolioOwner,
            isMethodologyAdmin: user.isMethodologyAdmin,
            isResourceAdmin: (user as any).isResourceAdmin ?? false,
            isTestBuilder: (user as any).isTestBuilder ?? false,
            firmId: user.firmId,
            firmName: user.firm.name,
            displayId: user.displayId,
          };
        }

        // Generate and send 2FA code
        const code = generateOTP();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        await prisma.twoFactorCode.create({
          data: { userId: user.id, code, expiresAt },
        });

        await sendTwoFactorCode(user.email, user.name, code);

        // Return partial user - 2FA not yet verified
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          twoFactorPending: true,
          isSuperAdmin: user.isSuperAdmin,
          isFirmAdmin: user.isFirmAdmin,
          isPortfolioOwner: user.isPortfolioOwner,
          isMethodologyAdmin: user.isMethodologyAdmin,
          isResourceAdmin: (user as any).isResourceAdmin ?? false,
            isTestBuilder: (user as any).isTestBuilder ?? false,
          firmId: user.firmId,
          firmName: user.firm.name,
          displayId: user.displayId,
        };
      },
    }),
    Credentials({
      id: 'two-factor',
      name: 'two-factor',
      credentials: {
        userId: { label: 'User ID', type: 'text' },
        code: { label: 'Code', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.userId || !credentials?.code) return null;

        const tfCode = await prisma.twoFactorCode.findFirst({
          where: {
            userId: credentials.userId as string,
            code: credentials.code as string,
            used: false,
            expiresAt: { gt: new Date() },
          },
        });

        if (!tfCode) return null;

        await prisma.twoFactorCode.update({
          where: { id: tfCode.id },
          data: { used: true },
        });

        const user = await prisma.user.findUnique({
          where: { id: credentials.userId as string },
          include: { firm: true },
        });

        if (!user) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          twoFactorVerified: true,
          isSuperAdmin: user.isSuperAdmin,
          isFirmAdmin: user.isFirmAdmin,
          isPortfolioOwner: user.isPortfolioOwner,
          isMethodologyAdmin: user.isMethodologyAdmin,
          isResourceAdmin: (user as any).isResourceAdmin ?? false,
            isTestBuilder: (user as any).isTestBuilder ?? false,
          firmId: user.firmId,
          firmName: user.firm.name,
          displayId: user.displayId,
        };
      },
    }),
  ],
  callbacks: {
    /**
     * Hard gate at the sign-in boundary — runs BEFORE jwt/session.
     *
     * For Microsoft Entra ID: the email returned by Entra must
     * resolve to an active, non-expired user in our `users` table.
     * If it doesn't, sign-in is rejected (NextAuth redirects to the
     * error page) and no JWT is issued.
     *
     * Why: Microsoft SSO will happily authenticate ANY tenant user
     * (anyone with a Microsoft account at any firm). Without this
     * gate, signing in via Entra granted `twoFactorVerified: true`
     * to anyone, who could then access pages that only check
     * `session.user.twoFactorVerified`. Specialist Portal users
     * (external email holders authenticated via magic-link) hit
     * this when their browser also had a generic Microsoft session
     * — they could click into the main site and the Entra flow
     * would let them in.
     *
     * The credentials provider already validates against the users
     * table inside `authorize()`, so this gate intentionally only
     * applies to the Microsoft provider.
     */
    async signIn({ user, account, profile }) {
      if (account?.provider !== 'microsoft-entra-id') return true;

      const email = (profile?.email || (user as any)?.email || '') as string;
      if (!email) return false;

      const entraObjId: string | null = (account as any)?.providerAccountId
        || (profile as any)?.sub
        || (profile as any)?.oid
        || null;

      // Mirror the three-strategy lookup the jwt callback uses so
      // sign-in succeeds for the same set of users that the jwt
      // callback would have populated. Re-running the queries here
      // is cheap (the jwt callback runs another lookup right after)
      // but keeps the gate explicit and testable.
      let dbUser: { id: string; isActive: boolean; expiryDate: Date | null } | null = null;
      if (entraObjId) {
        try {
          dbUser = await prisma.user.findUnique({
            where: { entraObjectId: entraObjId },
            select: { id: true, isActive: true, expiryDate: true },
          });
        } catch { /* try next strategy */ }
      }
      if (!dbUser) {
        try {
          dbUser = await prisma.user.findFirst({
            where: { email: { equals: email, mode: 'insensitive' } },
            select: { id: true, isActive: true, expiryDate: true },
          });
        } catch { /* try next strategy */ }
      }
      if (!dbUser) {
        try {
          dbUser = await prisma.user.findUnique({
            where: { email },
            select: { id: true, isActive: true, expiryDate: true },
          });
        } catch { /* fall through to reject */ }
      }

      if (!dbUser) {
        console.warn(`[auth] Microsoft sign-in rejected for ${email} — no matching user in our database. Super Admin must pre-provision the user before they can sign in.`);
        return false;
      }
      if (!dbUser.isActive) {
        console.warn(`[auth] Microsoft sign-in rejected for ${email} — account is inactive.`);
        return false;
      }
      if (dbUser.expiryDate && dbUser.expiryDate < new Date()) {
        console.warn(`[auth] Microsoft sign-in rejected for ${email} — account expired on ${dbUser.expiryDate.toISOString()}.`);
        return false;
      }
      return true;
    },

    async jwt({ token, user, account, profile }) {
      // Microsoft Entra ID sign-in — look up or create user in our DB
      if (account?.provider === 'microsoft-entra-id' && profile?.email) {
        // Store Microsoft access token for OBO flow (Dynamics CRM, Graph API)
        if (account.access_token) {
          token.msAccessToken = account.access_token;
        }

        const email = profile.email as string;
        // Three-strategy lookup, each isolated in its own try/catch
        // so one failed query can't take down the whole sign-in.
        //
        //   1. By entraObjectId — most stable. Survives email renames.
        //   2. By email, case-insensitive — catches mixed-case admin
        //      pre-registrations where Entra sends lowercase.
        //   3. By email, exact match — the original behaviour; final
        //      fallback in case the case-insensitive query hits an
        //      edge-case we haven't seen.
        //
        // The first strategy to return a non-null result wins.
        const entraObjId: string | null = (account as any)?.providerAccountId
          || (profile as any)?.sub
          || (profile as any)?.oid
          || null;
        type DbUser = Awaited<ReturnType<typeof prisma.user.findFirst>> & { firm?: any };
        let dbUser: DbUser | null = null;
        if (entraObjId) {
          try {
            dbUser = await prisma.user.findUnique({
              where: { entraObjectId: entraObjId },
              include: { firm: true },
            }) as DbUser | null;
          } catch { /* strategy 1 failed — try the next */ }
        }
        if (!dbUser) {
          try {
            dbUser = await prisma.user.findFirst({
              where: { email: { equals: email, mode: 'insensitive' } },
              include: { firm: true },
            }) as DbUser | null;
          } catch { /* strategy 2 failed — try the next */ }
        }
        if (!dbUser) {
          try {
            dbUser = await prisma.user.findUnique({
              where: { email },
              include: { firm: true },
            }) as DbUser | null;
          } catch { /* strategy 3 failed — fall through to pending-setup */ }
        }

        // Defence-in-depth: if for any reason the signIn gate above
        // didn't reject and we still have no matching user row, do
        // NOT grant twoFactorVerified. Pages that gate on it will
        // redirect to /login. Returning the token with an error
        // flag lets the session callback surface the issue to the
        // UI without ever issuing a usable session.
        if (!dbUser) {
          token.error = 'AccountNotProvisioned';
          token.msalPendingSetup = true;
          token.email = email;
          token.name = (profile.name as string) || email;
          token.twoFactorVerified = false; // explicit — no main-site access without a user row
          token.twoFactorPending = false;
          token.isSuperAdmin = false;
          token.isFirmAdmin = false;
          token.isPortfolioOwner = false;
          token.isMethodologyAdmin = false;
          token.isResourceAdmin = false;
          token.isTestBuilder = false;
          token.firmId = null;
          token.firmName = null;
          token.displayId = null;
          return token;
        }

        if (!dbUser.isActive) {
          token.error = 'AccountDisabled';
          return token;
        }

        // Store Azure AD object ID if not already set. `entraObjId`
        // was resolved at the top of the block — reuse it.
        if (entraObjId && !dbUser.entraObjectId) {
          await prisma.user.update({
            where: { id: dbUser.id },
            data: { entraObjectId: entraObjId },
          }).catch(() => {}); // Non-critical — don't fail login
        }

        token.id = dbUser.id;
        token.email = dbUser.email;
        token.name = dbUser.name;
        token.twoFactorVerified = true; // Microsoft auth skips 2FA
        token.twoFactorPending = false;
        token.isSuperAdmin = dbUser.isSuperAdmin;
        token.isFirmAdmin = dbUser.isFirmAdmin;
        token.isPortfolioOwner = dbUser.isPortfolioOwner;
        token.isMethodologyAdmin = dbUser.isMethodologyAdmin;
        token.isResourceAdmin = (dbUser as any).isResourceAdmin ?? false;
        token.isTestBuilder = (dbUser as any).isTestBuilder ?? false;
        token.firmId = dbUser.firmId;
        token.firmName = dbUser.firm.name;
        token.displayId = dbUser.displayId;
        token.msalPendingSetup = false;
        return token;
      }

      // Credentials sign-in
      if (user) {
        token.id = user.id;
        token.isSuperAdmin = (user as any).isSuperAdmin;
        token.isFirmAdmin = (user as any).isFirmAdmin;
        token.isPortfolioOwner = (user as any).isPortfolioOwner;
        token.isMethodologyAdmin = (user as any).isMethodologyAdmin;
        token.isResourceAdmin = (user as any).isResourceAdmin;
        token.isTestBuilder = (user as any).isTestBuilder;
        token.firmId = (user as any).firmId;
        token.firmName = (user as any).firmName;
        token.displayId = (user as any).displayId;
        token.twoFactorPending = (user as any).twoFactorPending ?? false;
        token.twoFactorVerified = (user as any).twoFactorVerified ?? false;
      }

      // Live flag refresh with a short window cache. The `jwt`
      // callback runs on every request that touches `auth()`, which
      // would be 5–15 ms of Prisma round-trip on every page and API
      // hit if we re-fetched unconditionally. Instead we cache the
      // last refresh timestamp on the token itself (carried along
      // via the JWT cookie) and skip the lookup when it's less than
      // REFRESH_WINDOW_MS old.
      //
      // Effect for users:
      //   • Admin grants a flag (e.g. isMethodologyAdmin) → takes
      //     effect for the user within REFRESH_WINDOW_MS, no
      //     sign-out required.
      //   • User deleted or deactivated → same latency before their
      //     next page redirects to /login.
      //   • Typical page-to-page navigation → zero extra DB load
      //     inside the window.
      //
      // Wrapped in try/catch because a transient DB error MUST NOT
      // break auth — we keep the existing token flags on failure
      // and intentionally DON'T bump `lastFreshAt` so the next
      // request retries.
      const REFRESH_WINDOW_MS = 60_000; // 1 minute — flag changes show up within a minute, no more than one lookup per minute per active tab.
      const isNotSignIn = !account && !user;
      const lastFreshAt = Number((token as any).lastFreshAt) || 0;
      const needsRefresh = isNotSignIn && token.id && (Date.now() - lastFreshAt > REFRESH_WINDOW_MS);
      if (needsRefresh) {
        try {
          const fresh = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: {
              isSuperAdmin: true, isFirmAdmin: true, isPortfolioOwner: true,
              isMethodologyAdmin: true, isResourceAdmin: true, isTestBuilder: true,
              isActive: true, firmId: true, displayId: true, firm: { select: { name: true } },
            },
          });
          if (fresh) {
            if (!fresh.isActive) {
              token.error = 'AccountDisabled';
            } else if (token.error === 'AccountDisabled') {
              delete (token as any).error; // re-enabled since last snapshot
            }
            token.isSuperAdmin = fresh.isSuperAdmin;
            token.isFirmAdmin = fresh.isFirmAdmin;
            token.isPortfolioOwner = fresh.isPortfolioOwner;
            token.isMethodologyAdmin = fresh.isMethodologyAdmin;
            token.isResourceAdmin = fresh.isResourceAdmin;
            token.isTestBuilder = fresh.isTestBuilder;
            token.firmId = fresh.firmId;
            token.firmName = fresh.firm?.name ?? token.firmName;
            token.displayId = fresh.displayId;
          } else {
            // Row deleted since the JWT was issued.
            token.error = 'AccountDisabled';
          }
          (token as any).lastFreshAt = Date.now();
        } catch {
          /* transient DB issue — retry on next request (don't bump lastFreshAt) */
        }
      }
      // On fresh sign-in, set the timestamp so we don't immediately
      // re-query on the next request.
      if (!isNotSignIn && token.id && !(token as any).lastFreshAt) {
        (token as any).lastFreshAt = Date.now();
      }

      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.isSuperAdmin = token.isSuperAdmin as boolean;
        session.user.isFirmAdmin = token.isFirmAdmin as boolean;
        session.user.isPortfolioOwner = token.isPortfolioOwner as boolean;
        session.user.isMethodologyAdmin = token.isMethodologyAdmin as boolean;
        session.user.isResourceAdmin = token.isResourceAdmin as boolean;
        session.user.isTestBuilder = token.isTestBuilder as boolean;
        session.user.firmId = token.firmId as string;
        session.user.firmName = token.firmName as string;
        session.user.displayId = token.displayId as string;
        session.user.twoFactorPending = token.twoFactorPending as boolean;
        session.user.twoFactorVerified = token.twoFactorVerified as boolean;
        (session.user as any).msalPendingSetup = token.msalPendingSetup ?? false;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 hours
  },
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
});
