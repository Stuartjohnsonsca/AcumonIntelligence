'use client';
import { useSearchParams } from 'next/navigation';
import { ServiceChatBot } from '@/components/portal/ServiceChatBot';

export default function PortalTechnologyPage() {
  const token = useSearchParams().get('token') || '';
  return <ServiceChatBot serviceType="technology" title="Technology Support" description="IT systems, software, digital transformation, and tech infrastructure help" token={token} />;
}
