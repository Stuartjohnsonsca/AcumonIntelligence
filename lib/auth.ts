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
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID!}/v2.0`,
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
          firmId: user.firmId,
          firmName: user.firm.name,
          displayId: user.displayId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, account, profile }) {
      // Microsoft Entra ID sign-in — look up or create user in our DB
      if (account?.provider === 'microsoft-entra-id' && profile?.email) {
        const email = profile.email as string;
        let dbUser = await prisma.user.findUnique({
          where: { email },
          include: { firm: true },
        });

        // Auto-create user if they exist in Azure AD but not yet in our DB
        // (Super Admin can pre-register them, or we create a pending account)
        if (!dbUser) {
          // Find a firm to attach them to — default to the first firm or leave firmId null
          // Super Admin will need to assign them to a firm afterwards
          token.msalPendingSetup = true;
          token.email = email;
          token.name = (profile.name as string) || email;
          token.twoFactorVerified = true; // Microsoft auth counts as verified
          token.twoFactorPending = false;
          token.isSuperAdmin = false;
          token.isFirmAdmin = false;
          token.isPortfolioOwner = false;
          token.firmId = null;
          token.firmName = null;
          token.displayId = null;
          return token;
        }

        if (!dbUser.isActive) {
          token.error = 'AccountDisabled';
          return token;
        }

        token.id = dbUser.id;
        token.email = dbUser.email;
        token.name = dbUser.name;
        token.twoFactorVerified = true; // Microsoft auth skips 2FA
        token.twoFactorPending = false;
        token.isSuperAdmin = dbUser.isSuperAdmin;
        token.isFirmAdmin = dbUser.isFirmAdmin;
        token.isPortfolioOwner = dbUser.isPortfolioOwner;
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
        token.firmId = (user as any).firmId;
        token.firmName = (user as any).firmName;
        token.displayId = (user as any).displayId;
        token.twoFactorPending = (user as any).twoFactorPending ?? false;
        token.twoFactorVerified = (user as any).twoFactorVerified ?? false;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.isSuperAdmin = token.isSuperAdmin as boolean;
        session.user.isFirmAdmin = token.isFirmAdmin as boolean;
        session.user.isPortfolioOwner = token.isPortfolioOwner as boolean;
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
});
