'use client';
import { useSearchParams } from 'next/navigation';
import { ServiceChatBot } from '@/components/portal/ServiceChatBot';

export default function PortalConsultingPage() {
  const token = useSearchParams().get('token') || '';
  return <ServiceChatBot serviceType="consulting" title="Consulting Support" description="Business advisory, strategy, and operational improvement assistance" token={token} />;
}
