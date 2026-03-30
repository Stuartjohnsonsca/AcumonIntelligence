import type { Metadata } from 'next';
import { PortalNav } from '@/components/portal/PortalNav';

export const metadata: Metadata = {
  title: 'Client Portal — Acumon Intelligence',
  description: 'Securely access audit, accounting, tax, consulting and technology support.',
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <PortalNav />
      <main className="max-w-6xl mx-auto px-6 py-8">
        {children}
      </main>
    </div>
  );
}
