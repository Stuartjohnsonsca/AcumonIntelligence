'use client';
import { useSearchParams } from 'next/navigation';
import { ServiceChatBot } from '@/components/portal/ServiceChatBot';

export default function PortalTaxPage() {
  const token = useSearchParams().get('token') || '';
  return <ServiceChatBot serviceType="tax" title="Tax Support" description="Tax planning, compliance, VAT queries, and tax return assistance" token={token} />;
}
