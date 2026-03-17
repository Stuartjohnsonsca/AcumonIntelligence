import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Navbar } from '@/components/Navbar';
import { AuthProvider } from '@/components/AuthProvider';
import { BackgroundTaskProvider } from '@/components/BackgroundTaskProvider';
import { Toaster } from '@/components/ui/toaster';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Acumon Intelligence',
  description: 'Intelligent tools for statutory audit and assurance professionals.',
  keywords: 'statutory audit, assurance, AI tools, financial data extraction, document summary',
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
          <div className="min-h-screen flex flex-col">
            <Navbar />
            <main className="flex-1">{children}</main>
            <footer className="border-t py-8 bg-slate-900 text-slate-400">
              <div className="container mx-auto px-4 text-center">
                <p className="text-sm">
                  &copy; {new Date().getFullYear()} Acumon Intelligence. All rights reserved.
                </p>
              </div>
            </footer>
          </div>
          <Toaster />
          </BackgroundTaskProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
