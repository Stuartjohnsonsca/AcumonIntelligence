'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ServiceChatBot } from '@/components/portal/ServiceChatBot';

function TaxContent() {
  const token = useSearchParams().get('token') || '';
  return <ServiceChatBot serviceType="tax" title="Tax Support" description="Tax planning, compliance, VAT queries, and tax return assistance" token={token} />;
}

export default function PortalTaxPage() {
  return <Suspense><TaxContent /></Suspense>;
}
