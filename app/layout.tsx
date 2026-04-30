import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Navbar } from '@/components/Navbar';
import { PortalFooterHider } from '@/components/portal/PortalFooterHider';
import { AuthProvider } from '@/components/AuthProvider';
import { BackgroundTaskProvider } from '@/components/BackgroundTaskProvider';
import { Toaster } from '@/components/ui/toaster';
import { KeyboardShortcutProvider } from '@/components/ui/KeyboardShortcutProvider';
import { HowToGlobalMount } from '@/components/howto/HowToGlobalMount';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Acumon Intelligence',
  description: 'Intelligent tools for statutory audit and assurance professionals.',
  keywords: 'statutory audit, assurance, AI tools, financial data extraction, document summary',
  icons: {
    icon: '/icon.svg',
    apple: '/apple-icon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          <BackgroundTaskProvider>
          <KeyboardShortcutProvider>
          <div className="min-h-screen flex flex-col">
            <Navbar />
            <main className="flex-1">{children}</main>
            <PortalFooterHider />
          </div>
          <HowToGlobalMount />
          <Toaster />
          </KeyboardShortcutProvider>
          </BackgroundTaskProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
