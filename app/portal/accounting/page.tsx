'use client';
import { useSearchParams } from 'next/navigation';
import { ServiceChatBot } from '@/components/portal/ServiceChatBot';

export default function PortalAccountingPage() {
  const token = useSearchParams().get('token') || '';
  return <ServiceChatBot serviceType="accounting" title="Accounting Support" description="Get help with bookkeeping, financial reporting, and accounting queries" token={token} />;
}
