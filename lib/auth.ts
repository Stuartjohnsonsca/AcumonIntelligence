import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { generateOTP } from '@/lib/utils';
import { sendTwoFactorCode } from '@/lib/email';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      id: 'credentials',
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
          include: { firm: true },
        });

        if (!user || !user.isActive) return null;

        // Check expiry
        if (user.expiryDate && user.expiryDate < new Date()) return null;

        const isValid = await bcrypt.compare(credentials.password as string, user.passwordHash);
        if (!isValid) return null;

        // Generate and send 2FA code
        const code = generateOTP();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        await prisma.twoFactorCode.create({
          data: {
            userId: user.id,
            code,
            expiresAt,
          },
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
    async jwt({ token, user }) {
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
