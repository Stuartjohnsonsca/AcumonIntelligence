'use client';

import { ArrowLeft, Construction } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

interface ToolLandingPageProps {
  toolName: string;
  category: string;
  description: string;
}

export function ToolLandingPage({ toolName, category, description }: ToolLandingPageProps) {
  const router = useRouter();

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 p-6">
      <div className="max-w-lg w-full text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-blue-100 flex items-center justify-center">
          <Construction className="h-8 w-8 text-blue-600" />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-blue-600 uppercase tracking-wide">{category}</p>
          <h1 className="text-3xl font-bold text-slate-900">{toolName}</h1>
          <p className="text-slate-500 text-lg">{description}</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <p className="text-slate-600 text-sm leading-relaxed">
            This tool is currently under development. We&apos;re working hard to bring you
            a powerful, AI-driven experience. Check back soon for updates.
          </p>
        </div>

        <Button
          variant="outline"
          onClick={() => router.back()}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Go Back
        </Button>
      </div>
    </div>
  );
}
