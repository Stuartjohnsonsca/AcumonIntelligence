'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

interface Props {
  href: string;
  label?: string;
}

export function BackButton({ href, label = 'Back' }: Props) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 mb-4">
      <ArrowLeft className="h-3 w-3" /> {label}
    </Link>
  );
}
