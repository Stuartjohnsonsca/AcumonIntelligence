'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ServiceChatBot } from '@/components/portal/ServiceChatBot';

function ConsultingContent() {
  const token = useSearchParams().get('token') || '';
  return <ServiceChatBot serviceType="consulting" title="Consulting Support" description="Business advisory, strategy, and operational improvement assistance" token={token} />;
}

export default function PortalConsultingPage() {
  return <Suspense><ConsultingContent /></Suspense>;
}
