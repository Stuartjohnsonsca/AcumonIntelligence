'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FileEdit, Presentation, Archive, Loader2, Settings } from 'lucide-react';

interface MeetingCounts {
  prepare: number;
  present: number;
  historic: number;
}

const CARDS = [
  {
    key: 'prepare' as const,
    title: 'Prepare',
    description: 'Draft and schedule upcoming board meetings. Build agendas, attach documents, and assign actions.',
    icon: FileEdit,
    href: '/tools/board/prepare',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
  },
  {
    key: 'present' as const,
    title: 'Present',
    description: 'Run live meetings. Take attendance, record notes, and capture actions and decisions in real time.',
    icon: Presentation,
    href: '/tools/board/present',
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
  },
  {
    key: 'historic' as const,
    title: 'Historic',
    description: 'Review completed meetings. Browse minutes, track outstanding actions, and manage approvals.',
    icon: Archive,
    href: '/tools/board/historic',
    color: 'text-green-600',
    bg: 'bg-green-50',
    border: 'border-green-200',
  },
];

export function BoardLanding() {
  const [counts, setCounts] = useState<MeetingCounts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCounts() {
      try {
        const res = await fetch('/api/board/meetings/counts');
        if (res.ok) {
          const data = await res.json();
          setCounts(data);
        }
      } catch {
        // Non-critical, just show cards without counts
      } finally {
        setLoading(false);
      }
    }
    fetchCounts();
  }, []);

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Board of Directors</h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage board meetings from preparation through to approval.
          </p>
        </div>
        <Link
          href="/tools/board/settings"
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {CARDS.map((card) => {
          const Icon = card.icon;
          const count = counts ? counts[card.key] : null;

          return (
            <Link
              key={card.key}
              href={card.href}
              className={`group block rounded-lg border ${card.border} ${card.bg} p-6 hover:shadow-md transition-all`}
            >
              <div className="flex items-center justify-between mb-4">
                <div className={`p-2 rounded-lg ${card.bg} ${card.color}`}>
                  <Icon className="h-6 w-6" />
                </div>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-slate-300" />
                ) : count !== null && count !== undefined ? (
                  <span className="text-2xl font-bold text-slate-700">{count}</span>
                ) : null}
              </div>
              <h2 className="text-lg font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">
                {card.title}
              </h2>
              <p className="text-sm text-slate-600 mt-1">{card.description}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
