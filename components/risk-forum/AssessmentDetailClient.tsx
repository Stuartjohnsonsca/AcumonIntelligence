'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  getProfile,
  deleteProfile,
  DIMENSION_LABELS,
  type AssessmentProfile,
  type AssessmentDimension,
} from '@/lib/riskForumAssessment';

export default function AssessmentDetailClient({ profileId }: { profileId: string }) {
  const router = useRouter();
  const [profile, setProfile] = useState<AssessmentProfile | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setProfile(getProfile(profileId));
    setLoaded(true);
  }, [profileId]);

  if (!loaded) return <div className="min-h-[calc(100vh-4rem)] p-8 text-xs font-mono" style={{ background: '#080808', color: '#444' }}>Loading…</div>;

  if (!profile) return (
    <div className="min-h-[calc(100vh-4rem)] p-8" style={{ background: '#080808', color: '#C8C8C0' }}>
      <div className="max-w-3xl mx-auto">
        <p className="text-sm">Profile not found. It may have been deleted, or it was created in a different browser.</p>
        <Link href="/tools/risk-forum/assessments" className="inline-block mt-4 px-4 py-2 rounded text-xs font-mono" style={{ border: '1px solid #1E1E1E', color: '#888' }}>← Back to assessments</Link>
      </div>
    </div>
  );

  const handleDelete = () => {
    if (!confirm('Delete this profile? This cannot be undone.')) return;
    deleteProfile(profile.id);
    router.push('/tools/risk-forum/assessments');
  };

  const createdAt = new Date(profile.createdAtIso);

  return (
    <div className="min-h-[calc(100vh-4rem)]" style={{ background: '#080808', color: '#C8C8C0' }}>
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center font-mono font-bold"
              style={{
                background: '#111',
                border: `2px solid ${profile.displayColor ?? '#888'}`,
                color: profile.displayColor ?? '#888',
                fontSize: '16px',
              }}
            >
              {profile.displayInitials ?? '?'}
            </div>
            <div>
              <h1 className="text-2xl font-normal" style={{ fontFamily: 'Georgia, serif', color: '#E8E8E0' }}>{profile.subjectName}</h1>
              <div className="text-xs font-mono" style={{ color: profile.displayColor ?? '#888' }}>{profile.subjectRole}{profile.subjectFirm ? ` · ${profile.subjectFirm}` : ''}</div>
              <div className="text-[10px] font-mono mt-1" style={{ color: '#444' }}>Created {createdAt.toLocaleString()}</div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Link href="/tools/risk-forum/assessments" className="px-4 py-2 rounded text-xs font-mono text-center" style={{ border: '1px solid #1E1E1E', color: '#888' }}>← All profiles</Link>
            <button onClick={handleDelete} className="px-4 py-2 rounded text-xs font-mono" style={{ border: '1px solid #1E1E1E', color: '#554040' }}>Delete profile</button>
          </div>
        </div>

        {/* Summary */}
        <div className="p-5 rounded-lg mb-4" style={{ background: '#0D0D0D', border: '1px solid #1A1A1A' }}>
          <div className="text-xs font-mono tracking-widest mb-2" style={{ color: '#555' }}>BEHAVIOURAL SUMMARY</div>
          <p className="text-sm leading-relaxed" style={{ color: '#C8C8C0', fontFamily: 'Georgia, serif' }}>
            {profile.behaviouralSummary}
          </p>
        </div>

        {/* Attributes */}
        <div className="p-5 rounded-lg mb-4" style={{ background: '#0D0D0D', border: '1px solid #1A1A1A' }}>
          <div className="text-xs font-mono tracking-widest mb-4" style={{ color: '#555' }}>ATTRIBUTES WITH EVIDENCE</div>
          <div className="flex flex-col gap-4">
            {profile.attributes.map((a, i) => (
              <div key={i} className="pl-3" style={{ borderLeft: `2px solid ${a.confidence === 'high' ? '#6EC860' : a.confidence === 'medium' ? '#E8A040' : '#888'}` }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-bold" style={{ color: '#E0E0D8' }}>{a.statement}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{
                    background: a.confidence === 'high' ? '#081408' : a.confidence === 'medium' ? '#140F08' : '#0F0F0F',
                    color: a.confidence === 'high' ? '#6EC860' : a.confidence === 'medium' ? '#E8A040' : '#888',
                  }}>{a.confidence.toUpperCase()}</span>
                </div>
                <div className="flex flex-col gap-1 mt-1">
                  {a.citations.map((c, j) => (
                    <div key={j} className="text-xs leading-relaxed pl-3" style={{ color: '#888', borderLeft: '1px solid #1A1A1A' }}>
                      <span className="font-mono text-[10px] mr-2" style={{ color: c.source === 'survey' ? '#6EC8E8' : '#E8A040' }}>
                        [{c.source.toUpperCase()}]
                      </span>
                      <span>{c.evidence}</span>
                      {c.reference && <span className="italic ml-1" style={{ color: '#555' }}>— &quot;{c.reference}&quot;</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Dimension notes */}
        <div className="p-5 rounded-lg mb-4" style={{ background: '#0D0D0D', border: '1px solid #1A1A1A' }}>
          <div className="text-xs font-mono tracking-widest mb-4" style={{ color: '#555' }}>DIMENSION NOTES</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(Object.keys(DIMENSION_LABELS) as AssessmentDimension[]).map(dim => {
              const note = profile.dimensionNotes?.[dim];
              if (!note) return null;
              return (
                <div key={dim} className="p-3 rounded" style={{ background: '#0A0A0A', border: '1px solid #1A1A1A' }}>
                  <div className="text-[10px] font-mono tracking-widest mb-1" style={{ color: '#6EC8E8' }}>{DIMENSION_LABELS[dim].toUpperCase()}</div>
                  <p className="text-xs leading-relaxed" style={{ color: '#999', fontFamily: 'Georgia, serif' }}>{note}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Raw inputs */}
        <details className="p-5 rounded-lg" style={{ background: '#0D0D0D', border: '1px solid #1A1A1A' }}>
          <summary className="text-xs font-mono tracking-widest cursor-pointer" style={{ color: '#555' }}>
            RAW INPUTS (SURVEY + INTERVIEW TRANSCRIPT)
          </summary>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-[10px] font-mono tracking-widest mb-2" style={{ color: '#6EC8E8' }}>SURVEY</div>
              <div className="text-xs leading-relaxed" style={{ color: '#888' }}>
                <div>{Object.keys(profile.surveyAnswers.likert).length} Likert answers</div>
                <div>{Object.keys(profile.surveyAnswers.forcedChoice).length} forced-choice answers</div>
              </div>
            </div>
            <div>
              <div className="text-[10px] font-mono tracking-widest mb-2" style={{ color: '#E8A040' }}>INTERVIEW</div>
              <div className="flex flex-col gap-2 max-h-96 overflow-y-auto pr-2">
                {profile.interviewTranscript.map((t, i) => (
                  <div key={i} className="text-xs leading-relaxed">
                    <div className="font-mono text-[9px] mb-0.5" style={{ color: t.role === 'interviewer' ? '#6EC8E8' : '#E8A040' }}>
                      {t.role === 'interviewer' ? 'Q' : 'A'}
                    </div>
                    <div style={{ color: '#999', fontFamily: 'Georgia, serif' }}>{t.text}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
