'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { loadProfiles, deleteProfile, type AssessmentProfile } from '@/lib/riskForumAssessment';

export default function AssessmentHubClient() {
  const [profiles, setProfiles] = useState<AssessmentProfile[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setProfiles(loadProfiles());
    setLoaded(true);
  }, []);

  const handleDelete = (id: string) => {
    if (!confirm('Delete this profile? This cannot be undone.')) return;
    deleteProfile(id);
    setProfiles(loadProfiles());
  };

  return (
    <div className="min-h-[calc(100vh-4rem)]" style={{ background: '#080808', color: '#C8C8C0' }}>
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <div className="text-xs tracking-widest mb-1 font-mono" style={{ color: '#2A2A2A' }}>RISK INTELLIGENCE</div>
            <div className="flex items-baseline gap-4">
              <h1 className="text-2xl font-normal" style={{ fontFamily: 'Georgia, serif', color: '#E8E8E0', letterSpacing: '0.03em' }}>
                Behavioural Assessments
              </h1>
              <span className="text-xs font-mono tracking-wider" style={{ color: '#6EC8E8' }}>
                {profiles.length} PROFILE{profiles.length === 1 ? '' : 'S'}
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed max-w-2xl" style={{ color: '#555' }}>
              Build defensible behavioural profiles through structured survey and AI-led interview. Saved profiles can be used as participants in a Risk Forum simulation.
            </p>
          </div>
          <div className="flex flex-col gap-2 flex-shrink-0">
            <Link
              href="/tools/risk-forum/assessments/new"
              className="px-5 py-2.5 rounded text-xs font-bold tracking-widest uppercase text-center"
              style={{ background: '#6EC8E8', color: '#080808', border: 'none' }}
            >
              + New Assessment
            </Link>
            <Link
              href="/tools/risk-forum"
              className="px-5 py-2 rounded text-xs font-mono tracking-wider text-center"
              style={{ background: 'transparent', border: '1px solid #1E1E1E', color: '#666' }}
            >
              ← Risk Forum
            </Link>
          </div>
        </div>

        {/* Profiles list */}
        {!loaded ? (
          <div className="p-10 text-center text-xs font-mono" style={{ color: '#444' }}>Loading…</div>
        ) : profiles.length === 0 ? (
          <div className="p-10 rounded-lg text-center" style={{ background: '#0D0D0D', border: '1px solid #1A1A1A' }}>
            <div className="text-xs font-mono tracking-widest mb-2" style={{ color: '#555' }}>NO PROFILES YET</div>
            <p className="text-sm leading-relaxed max-w-lg mx-auto mb-6" style={{ color: '#888', fontFamily: 'Georgia, serif' }}>
              Create your first behavioural profile. The process takes ~15 minutes per person — a short structured survey followed by an AI-led interview that probes past crisis behaviour, with adaptive follow-up.
            </p>
            <Link
              href="/tools/risk-forum/assessments/new"
              className="inline-block px-5 py-2.5 rounded text-xs font-bold tracking-widest uppercase"
              style={{ background: '#6EC8E8', color: '#080808', border: 'none' }}
            >
              Start First Assessment →
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {profiles.map(p => {
              const created = new Date(p.createdAtIso);
              return (
                <div
                  key={p.id}
                  className="p-4 rounded-lg flex items-start gap-4"
                  style={{ background: '#0D0D0D', border: '1px solid #1A1A1A' }}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center font-mono font-bold flex-shrink-0"
                    style={{
                      background: '#111',
                      border: `2px solid ${p.displayColor ?? '#888'}`,
                      color: p.displayColor ?? '#888',
                      fontSize: '12px',
                    }}
                  >
                    {p.displayInitials ?? '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold" style={{ color: '#E8E8E0' }}>{p.subjectName}</span>
                      <span className="text-xs font-mono" style={{ color: p.displayColor ?? '#888' }}>{p.subjectRole}</span>
                      {p.subjectFirm && <span className="text-xs" style={{ color: '#555' }}>· {p.subjectFirm}</span>}
                    </div>
                    <p className="text-xs mt-1 leading-relaxed line-clamp-2" style={{ color: '#888', fontFamily: 'Georgia, serif' }}>
                      {p.behaviouralSummary}
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-[10px] font-mono" style={{ color: '#444' }}>
                      <span>{p.attributes.length} attributes</span>
                      <span>·</span>
                      <span>{p.interviewTranscript.filter(t => t.role === 'subject').length} interview answers</span>
                      <span>·</span>
                      <span>Created {created.toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    <Link
                      href={`/tools/risk-forum/assessments/${p.id}`}
                      className="px-3 py-1.5 rounded text-xs font-mono tracking-wider text-center"
                      style={{ background: 'transparent', border: '1px solid #1E1E1E', color: '#888' }}
                    >
                      View
                    </Link>
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="px-3 py-1.5 rounded text-xs font-mono tracking-wider"
                      style={{ background: 'transparent', border: '1px solid #1E1E1E', color: '#554040' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-xs mt-6 leading-relaxed" style={{ color: '#333' }}>
          Profiles are currently stored locally in your browser. Production build will migrate to server-side storage with audit log, subject right-of-reply, and profile re-validation cycle.
        </p>
      </div>
    </div>
  );
}
