import { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      isSuperAdmin: boolean;
      isFirmAdmin: boolean;
      isPortfolioOwner: boolean;
      isMethodologyAdmin: boolean;
      isResourceAdmin: boolean;
      isTestBuilder: boolean;
      firmId: string;
      firmName: string;
      displayId: string;
      twoFactorPending: boolean;
      twoFactorVerified: boolean;
    } & DefaultSession['user'];
  }
}
