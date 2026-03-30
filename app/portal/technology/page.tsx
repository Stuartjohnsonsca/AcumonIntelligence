'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ServiceChatBot } from '@/components/portal/ServiceChatBot';

function TechnologyContent() {
  const token = useSearchParams().get('token') || '';
  return <ServiceChatBot serviceType="technology" title="Technology Support" description="IT systems, software, digital transformation, and tech infrastructure help" token={token} />;
}

export default function PortalTechnologyPage() {
  return <Suspense><TechnologyContent /></Suspense>;
}
