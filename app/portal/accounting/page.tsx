'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ServiceChatBot } from '@/components/portal/ServiceChatBot';

function AccountingContent() {
  const token = useSearchParams().get('token') || '';
  return <ServiceChatBot serviceType="accounting" title="Accounting Support" description="Get help with bookkeeping, financial reporting, and accounting queries" token={token} />;
}

export default function PortalAccountingPage() {
  return <Suspense><AccountingContent /></Suspense>;
}
