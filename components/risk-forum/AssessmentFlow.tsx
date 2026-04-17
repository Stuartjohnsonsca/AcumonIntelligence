'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  SURVEY_QUESTIONS,
  DIMENSION_LABELS,
  loadProfiles,
  saveProfile,
  avatarDetailsForName,
  type AssessmentProfile,
  type AssessmentSurveyAnswers,
  type AssessmentInterviewTurn,
  type AssessmentDimension,
  type ProfileAttribute,
  type LikertQuestion,
  type ForcedChoiceQuestion,
} from '@/lib/riskForumAssessment';

type Stage = 'subject' | 'survey' | 'interview' | 'synthesising' | 'review';

interface SynthesisResult {
  behaviouralSummary: string;
  attributes: ProfileAttribute[];
  dimensionNotes: Partial<Record<AssessmentDimension, string>>;
}

export default function AssessmentFlow() {
  const router = useRouter();

  // Subject
  const [subjectName, setSubjectName] = useState('');
  const [subjectRole, setSubjectRole] = useState('');
  const [subjectFirm, setSubjectFirm] = useState('');

  // Survey
  const [likertAnswers, setLikertAnswers] = useState<Record<string, number>>({});
  const [choiceAnswers, setChoiceAnswers] = useState<Record<string, string>>({});
  const [surveyIdx, setSurveyIdx] = useState(0);

  // Interview
  const [interviewTurns, setInterviewTurns] = useState<AssessmentInterviewTurn[]>([]);
  const [currentSubjectReply, setCurrentSubjectReply] = useState('');
  const [interviewLoading, setInterviewLoading] = useState(false);
  const [interviewComplete, setInterviewComplete] = useState(false);

  // Synthesis
  const [synthesis, setSynthesis] = useState<SynthesisResult | null>(null);
  const [synthesisError, setSynthesisError] = useState<string | null>(null);

  // Flow
  const [stage, setStage] = useState<Stage>('subject');

  const interviewScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (interviewScrollRef.current) interviewScrollRef.current.scrollTop = interviewScrollRef.current.scrollHeight;
  }, [interviewTurns, interviewLoading]);

  const surveyAnswered = Object.keys(likertAnswers).length + Object.keys(choiceAnswers).length;
  const surveyTotal = SURVEY_QUESTIONS.length;

  // ── Survey helpers ──────────────────────────────────────────────────────────
  const currentQuestion = SURVEY_QUESTIONS[surveyIdx];

  const handleSurveyAnswer = (value: string | number) => {
    if (!currentQuestion) return;
    if (currentQuestion.kind === 'likert') {
      setLikertAnswers(prev => ({ ...prev, [currentQuestion.id]: Number(value) }));
    } else {
      setChoiceAnswers(prev => ({ ...prev, [currentQuestion.id]: String(value) }));
    }
    if (surveyIdx < SURVEY_QUESTIONS.length - 1) {
      setTimeout(() => setSurveyIdx(i => i + 1), 150);
    }
  };

  const buildSurveySummary = (): string => {
    const parts: string[] = [];
    for (const q of SURVEY_QUESTIONS) {
      if (q.kind === 'likert') {
        const v = likertAnswers[q.id];
        if (v !== undefined) parts.push(`• "${q.text}" → ${v}/5`);
      } else {
        const v = choiceAnswers[q.id];
        if (v !== undefined) {
          const opt = (q as ForcedChoiceQuestion).options.find(o => o.value === v);
          parts.push(`• "${q.text}" → "${opt?.label ?? v}"`);
        }
      }
    }
    return parts.join('\n');
  };

  // ── Interview turn handler ─────────────────────────────────────────────────
  const fetchNextInterviewerTurn = useCallback(async (transcript: AssessmentInterviewTurn[]) => {
    setInterviewLoading(true);
    try {
      const res = await fetch('/api/risk-forum/assessment/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectName,
          subjectRole,
          transcript,
          surveySummary: buildSurveySummary(),
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const question = data.question ?? '...';
      setInterviewTurns(prev => [...prev, { role: 'interviewer', text: question }]);
      if (data.isComplete) setInterviewComplete(true);
    } catch (e) {
      console.error('Interview fetch failed', e);
    } finally {
      setInterviewLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectName, subjectRole, likertAnswers, choiceAnswers]);

  const startInterview = async () => {
    setStage('interview');
    setInterviewTurns([]);
    setInterviewComplete(false);
    await fetchNextInterviewerTurn([]);
  };

  const submitSubjectReply = async () => {
    if (!currentSubjectReply.trim() || interviewLoading) return;
    const updated: AssessmentInterviewTurn[] = [
      ...interviewTurns,
      { role: 'subject' as const, text: currentSubjectReply.trim() },
    ];
    setInterviewTurns(updated);
    setCurrentSubjectReply('');
    if (!interviewComplete) {
      await fetchNextInterviewerTurn(updated);
    }
  };

  // ── Synthesis ──────────────────────────────────────────────────────────────
  const runSynthesis = async () => {
    setStage('synthesising');
    setSynthesisError(null);
    try {
      const surveyAnswers: AssessmentSurveyAnswers = { likert: likertAnswers, forcedChoice: choiceAnswers };
      const surveyQuestionText: Record<string, string> = {};
      for (const q of SURVEY_QUESTIONS) surveyQuestionText[q.id] = q.text;

      const res = await fetch('/api/risk-forum/assessment/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectName,
          subjectRole,
          surveyAnswers,
          surveyQuestionText,
          interviewTranscript: interviewTurns,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSynthesisError(data?.error ?? 'Synthesis failed');
        setStage('interview');
        return;
      }
      const data = await res.json();
      setSynthesis(data.profile as SynthesisResult);
      setStage('review');
    } catch (e) {
      console.error('Synthesis failed', e);
      setSynthesisError('Synthesis failed — please try again.');
      setStage('interview');
    }
  };

  const saveAndReturn = () => {
    if (!synthesis) return;
    const avatar = avatarDetailsForName(subjectName);
    const profile: AssessmentProfile = {
      id: `prof-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      version: 1,
      schemaVersion: 1,
      createdAtIso: new Date().toISOString(),
      updatedAtIso: new Date().toISOString(),
      subjectName,
      subjectRole,
      subjectFirm: subjectFirm || undefined,
      surveyAnswers: { likert: likertAnswers, forcedChoice: choiceAnswers },
      interviewTranscript: interviewTurns,
      behaviouralSummary: synthesis.behaviouralSummary,
      attributes: synthesis.attributes,
      dimensionNotes: synthesis.dimensionNotes,
      displayColor: avatar.color,
      displayInitials: avatar.initials,
    };
    saveProfile(profile);
    router.push('/tools/risk-forum/assessments');
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-[calc(100vh-4rem)]" style={{ background: '#080808', color: '#C8C8C0' }}>
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="text-xs tracking-widest mb-1 font-mono" style={{ color: '#2A2A2A' }}>RISK INTELLIGENCE</div>
          <div className="flex items-baseline gap-4">
            <h1 className="text-2xl font-normal" style={{ fontFamily: 'Georgia, serif', color: '#E8E8E0', letterSpacing: '0.03em' }}>
              Behavioural Assessment
            </h1>
            <span className="text-xs font-mono tracking-wider" style={{ color: '#6EC8E8' }}>
              {stage === 'subject' ? 'STEP 1 / 4 · SUBJECT' :
               stage === 'survey' ? `STEP 2 / 4 · SURVEY (${surveyAnswered}/${surveyTotal})` :
               stage === 'interview' ? `STEP 3 / 4 · INTERVIEW (${interviewTurns.filter(t => t.role === 'subject').length} answers)` :
               stage === 'synthesising' ? 'STEP 4 / 4 · SYNTHESIS' :
               'STEP 4 / 4 · REVIEW'}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed max-w-2xl" style={{ color: '#555' }}>
            Structured survey + AI-led behavioural interview → synthesised profile with source citations. Use the output to model this person as a participant in a Risk Forum simulation.
          </p>
        </div>

        {/* Stage: Subject ─────────────────────────────────────────────── */}
        {stage === 'subject' && (
          <div className="p-6 rounded-lg" style={{ background: '#0D0D0D', border: '1px solid #1A1A1A' }}>
            <div className="text-xs font-mono tracking-widest mb-4" style={{ color: '#555' }}>SUBJECT DETAILS</div>
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-mono tracking-wider" style={{ color: '#666' }}>FULL NAME</span>
                <input
                  type="text"
                  value={subjectName}
                  onChange={e => setSubjectName(e.target.value)}
                  placeholder="e.g. Sarah Chen"
                  className="px-3 py-2 rounded text-sm"
                  style={{ background: '#080808', border: '1px solid #2A2A2A', color: '#C8C8C0' }}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-mono tracking-wider" style={{ color: '#666' }}>ROLE</span>
                <input
                  type="text"
                  value={subjectRole}
                  onChange={e => setSubjectRole(e.target.value)}
                  placeholder="e.g. Chief Executive Officer"
                  className="px-3 py-2 rounded text-sm"
                  style={{ background: '#080808', border: '1px solid #2A2A2A', color: '#C8C8C0' }}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-mono tracking-wider" style={{ color: '#666' }}>FIRM (optional)</span>
                <input
                  type="text"
                  value={subjectFirm}
                  onChange={e => setSubjectFirm(e.target.value)}
                  placeholder="Organisation name"
                  className="px-3 py-2 rounded text-sm"
                  style={{ background: '#080808', border: '1px solid #2A2A2A', color: '#C8C8C0' }}
                />
              </label>
              <p className="text-xs leading-relaxed mt-2" style={{ color: '#444' }}>
                Profile is stored locally in your browser. Production build will add server-side storage with audit trail and subject right-of-reply.
              </p>
              <button
                onClick={() => setStage('survey')}
                disabled={!subjectName.trim() || !subjectRole.trim()}
                className="self-start px-6 py-2.5 rounded text-xs font-bold tracking-widest uppercase transition-all"
                style={{
                  background: subjectName.trim() && subjectRole.trim() ? '#6EC8E8' : '#111',
                  color: subjectName.trim() && subjectRole.trim() ? '#080808' : '#2E2E2E',
                  border: 'none',
                }}
              >
                Begin Survey →
              </button>
            </div>
          </div>
        )}

        {/* Stage: Survey ─────────────────────────────────────────────── */}
        {stage === 'survey' && currentQuestion && (
          <div className="p-6 rounded-lg" style={{ background: '#0D0D0D', border: '1px solid #1A1A1A' }}>
            {/* Progress bar */}
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-mono tracking-widest" style={{ color: '#6EC8E8' }}>
                {DIMENSION_LABELS[currentQuestion.dimension].toUpperCase()}
              </div>
              <div className="text-xs font-mono" style={{ color: '#555' }}>
                {surveyIdx + 1} / {surveyTotal}
              </div>
            </div>
            <div className="w-full h-0.5 mb-6 rounded-full" style={{ background: '#1A1A1A' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${((surveyIdx + 1) / surveyTotal) * 100}%`, background: '#6EC8E8' }}
              />
            </div>

            <p className="text-lg leading-relaxed mb-6" style={{ color: '#E0E0D8', fontFamily: 'Georgia, serif' }}>
              {currentQuestion.text}
            </p>

            {currentQuestion.kind === 'likert' && (
              <div className="flex gap-2">
                {['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'].map((label, idx) => {
                  const val = idx + 1;
                  const selected = likertAnswers[currentQuestion.id] === val;
                  return (
                    <button
                      key={val}
                      onClick={() => handleSurveyAnswer(val)}
                      className="flex-1 px-3 py-4 rounded text-xs font-mono transition-all text-center"
                      style={{
                        background: selected ? '#0F1A22' : '#0A0A0A',
                        border: `1px solid ${selected ? '#6EC8E8' : '#1A1A1A'}`,
                        color: selected ? '#6EC8E8' : '#888',
                      }}
                    >
                      <div className="text-lg font-bold mb-1">{val}</div>
                      <div style={{ fontSize: '9px' }}>{label}</div>
                    </button>
                  );
                })}
              </div>
            )}

            {currentQuestion.kind === 'forced_choice' && (
              <div className="flex flex-col gap-2">
                {(currentQuestion as ForcedChoiceQuestion).options.map(opt => {
                  const selected = choiceAnswers[currentQuestion.id] === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => handleSurveyAnswer(opt.value)}
                      className="p-3 rounded text-left text-sm transition-all"
                      style={{
                        background: selected ? '#0F1A22' : '#0A0A0A',
                        border: `1px solid ${selected ? '#6EC8E8' : '#1A1A1A'}`,
                        color: selected ? '#E0E0D8' : '#888',
                        fontFamily: 'Georgia, serif',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between mt-8">
              <button
                onClick={() => setSurveyIdx(Math.max(0, surveyIdx - 1))}
                disabled={surveyIdx === 0}
                className="px-4 py-2 rounded text-xs font-mono tracking-wider"
                style={{ background: 'transparent', border: '1px solid #1E1E1E', color: surveyIdx === 0 ? '#222' : '#888' }}
              >
                ← Back
              </button>
              {surveyIdx < surveyTotal - 1 ? (
                <button
                  onClick={() => setSurveyIdx(Math.min(surveyTotal - 1, surveyIdx + 1))}
                  className="px-4 py-2 rounded text-xs font-mono tracking-wider"
                  style={{ background: 'transparent', border: '1px solid #1E1E1E', color: '#888' }}
                >
                  Skip →
                </button>
              ) : (
                <button
                  onClick={startInterview}
                  disabled={surveyAnswered < Math.floor(surveyTotal * 0.8)}
                  className="px-6 py-2.5 rounded text-xs font-bold tracking-widest uppercase transition-all"
                  style={{
                    background: surveyAnswered >= Math.floor(surveyTotal * 0.8) ? '#6EC8E8' : '#111',
                    color: surveyAnswered >= Math.floor(surveyTotal * 0.8) ? '#080808' : '#2E2E2E',
                    border: 'none',
                  }}
                >
                  Begin Interview →
                </button>
              )}
            </div>
            {surveyIdx === surveyTotal - 1 && surveyAnswered < Math.floor(surveyTotal * 0.8) && (
              <p className="text-xs mt-3 text-right" style={{ color: '#E8A040' }}>
                Please answer at least {Math.floor(surveyTotal * 0.8)} of {surveyTotal} questions before moving on.
              </p>
            )}
          </div>
        )}

        {/* Stage: Interview ────────────────────────────────────────── */}
        {stage === 'interview' && (
          <div className="rounded-lg overflow-hidden" style={{ background: '#0D0D0D', border: '1px solid #1A1A1A' }}>
            <div className="px-6 py-3 border-b flex items-center justify-between" style={{ borderColor: '#1A1A1A' }}>
              <div className="text-xs font-mono tracking-widest" style={{ color: '#555' }}>BEHAVIOURAL INTERVIEW</div>
              {interviewComplete && (
                <span className="text-xs font-mono" style={{ color: '#6EC860' }}>✓ Interviewer has signalled completion</span>
              )}
            </div>

            <div ref={interviewScrollRef} className="px-6 py-5 max-h-[500px] overflow-y-auto flex flex-col gap-4">
              {interviewTurns.length === 0 && interviewLoading && (
                <div className="text-xs italic" style={{ color: '#444' }}>Preparing opening question…</div>
              )}
              {interviewTurns.map((t, i) => (
                <div key={i} className={`flex flex-col ${t.role === 'subject' ? 'items-end' : 'items-start'}`}>
                  <div className="text-[10px] font-mono tracking-widest mb-1" style={{ color: t.role === 'subject' ? '#E8A040' : '#6EC8E8' }}>
                    {t.role === 'subject' ? subjectName.toUpperCase() : 'INTERVIEWER'}
                  </div>
                  <div className="max-w-[80%] px-4 py-2.5 rounded-lg text-sm leading-relaxed" style={{
                    background: t.role === 'subject' ? '#1A0F00' : '#0A0F1A',
                    border: `1px solid ${t.role === 'subject' ? '#E8A04044' : '#6EC8E844'}`,
                    color: '#C8C8C0',
                    fontFamily: 'Georgia, serif',
                  }}>
                    {t.text}
                  </div>
                </div>
              ))}
              {interviewLoading && interviewTurns.length > 0 && (
                <div className="text-[10px] font-mono tracking-widest italic" style={{ color: '#6EC8E8' }}>
                  Interviewer is considering your answer…
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t" style={{ borderColor: '#1A1A1A', background: '#080808' }}>
              {!interviewComplete ? (
                <>
                  <textarea
                    value={currentSubjectReply}
                    onChange={e => setCurrentSubjectReply(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        submitSubjectReply();
                      }
                    }}
                    placeholder="Answer in your own words — specific past events are more useful than generalities. ⌘+Enter to submit."
                    className="w-full h-24 rounded p-3 text-sm resize-none leading-relaxed mb-2"
                    style={{ background: '#0A0A0A', border: '1px solid #1A1A1A', color: '#C8C8C0', fontFamily: 'Georgia, serif' }}
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono" style={{ color: '#444' }}>
                      {interviewTurns.filter(t => t.role === 'subject').length} answer{interviewTurns.filter(t => t.role === 'subject').length !== 1 ? 's' : ''} so far
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setInterviewComplete(true)}
                        className="px-3 py-1.5 rounded text-xs font-mono tracking-wider"
                        style={{ background: 'transparent', border: '1px solid #1E1E1E', color: '#666' }}
                        title="Skip remaining questions and synthesise now"
                      >
                        End early
                      </button>
                      <button
                        onClick={submitSubjectReply}
                        disabled={!currentSubjectReply.trim() || interviewLoading}
                        className="px-5 py-1.5 rounded text-xs font-bold tracking-widest uppercase transition-all"
                        style={{
                          background: currentSubjectReply.trim() && !interviewLoading ? '#6EC8E8' : '#111',
                          color: currentSubjectReply.trim() && !interviewLoading ? '#080808' : '#2E2E2E',
                          border: 'none',
                        }}
                      >
                        Submit
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: '#6EC860' }}>Interview complete. Ready to synthesise the profile.</span>
                  <button
                    onClick={runSynthesis}
                    className="px-5 py-2 rounded text-xs font-bold tracking-widest uppercase"
                    style={{ background: '#6EC8E8', color: '#080808', border: 'none' }}
                  >
                    Synthesise Profile →
                  </button>
                </div>
              )}
              {synthesisError && <p className="mt-2 text-xs" style={{ color: '#C84040' }}>{synthesisError}</p>}
            </div>
          </div>
        )}

        {/* Stage: Synthesising ────────────────────────────────────── */}
        {stage === 'synthesising' && (
          <div className="p-10 rounded-lg text-center" style={{ background: '#0D0D0D', border: '1px solid #1A1A1A' }}>
            <div className="text-xs font-mono tracking-widest" style={{ color: '#6EC8E8' }}>SYNTHESISING PROFILE</div>
            <p className="mt-3 text-xs" style={{ color: '#555' }}>
              Combining {Object.keys(likertAnswers).length + Object.keys(choiceAnswers).length} survey answers and{' '}
              {interviewTurns.filter(t => t.role === 'subject').length} interview responses…
            </p>
          </div>
        )}

        {/* Stage: Review ──────────────────────────────────────────── */}
        {stage === 'review' && synthesis && (
          <div className="flex flex-col gap-4">
            <div className="p-6 rounded-lg" style={{ background: '#0D0D0D', border: '1px solid #1A1A1A' }}>
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center font-mono font-bold"
                  style={{
                    background: '#111',
                    border: `2px solid ${avatarDetailsForName(subjectName).color}`,
                    color: avatarDetailsForName(subjectName).color,
                    fontSize: '14px',
                  }}
                >
                  {avatarDetailsForName(subjectName).initials}
                </div>
                <div>
                  <div className="text-base font-bold" style={{ color: '#E8E8E0' }}>{subjectName}</div>
                  <div className="text-xs font-mono" style={{ color: '#888' }}>{subjectRole}{subjectFirm ? ` · ${subjectFirm}` : ''}</div>
                </div>
              </div>

              <div className="text-xs font-mono tracking-widest mb-2" style={{ color: '#555' }}>BEHAVIOURAL SUMMARY</div>
              <p className="text-sm leading-relaxed" style={{ color: '#C8C8C0', fontFamily: 'Georgia, serif' }}>
                {synthesis.behaviouralSummary}
              </p>
            </div>

            <div className="p-6 rounded-lg" style={{ background: '#0D0D0D', border: '1px solid #1A1A1A' }}>
              <div className="text-xs font-mono tracking-widest mb-4" style={{ color: '#555' }}>ATTRIBUTES WITH EVIDENCE</div>
              <div className="flex flex-col gap-4">
                {synthesis.attributes.map((a, i) => (
                  <div key={i} className="pl-3" style={{ borderLeft: `2px solid ${a.confidence === 'high' ? '#6EC860' : a.confidence === 'medium' ? '#E8A040' : '#888'}` }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-bold" style={{ color: '#E0E0D8' }}>{a.statement}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{
                        background: a.confidence === 'high' ? '#081408' : a.confidence === 'medium' ? '#140F08' : '#0F0F0F',
                        color: a.confidence === 'high' ? '#6EC860' : a.confidence === 'medium' ? '#E8A040' : '#888',
                      }}>
                        {a.confidence.toUpperCase()}
                      </span>
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

            <div className="p-6 rounded-lg" style={{ background: '#0D0D0D', border: '1px solid #1A1A1A' }}>
              <div className="text-xs font-mono tracking-widest mb-4" style={{ color: '#555' }}>DIMENSION NOTES</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(Object.keys(DIMENSION_LABELS) as AssessmentDimension[]).map(dim => {
                  const note = synthesis.dimensionNotes?.[dim];
                  if (!note) return null;
                  return (
                    <div key={dim} className="p-3 rounded" style={{ background: '#0A0A0A', border: '1px solid #1A1A1A' }}>
                      <div className="text-[10px] font-mono tracking-widest mb-1" style={{ color: '#6EC8E8' }}>
                        {DIMENSION_LABELS[dim].toUpperCase()}
                      </div>
                      <p className="text-xs leading-relaxed" style={{ color: '#999', fontFamily: 'Georgia, serif' }}>
                        {note}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => {
                  setStage('interview');
                  setSynthesis(null);
                }}
                className="px-4 py-2 rounded text-xs font-mono tracking-wider"
                style={{ background: 'transparent', border: '1px solid #1E1E1E', color: '#888' }}
              >
                ← Back to interview
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={runSynthesis}
                  className="px-4 py-2 rounded text-xs font-mono tracking-wider"
                  style={{ background: 'transparent', border: '1px solid #1E1E1E', color: '#888' }}
                >
                  Regenerate
                </button>
                <button
                  onClick={saveAndReturn}
                  className="px-6 py-2.5 rounded text-xs font-bold tracking-widest uppercase"
                  style={{ background: '#6EC860', color: '#080808', border: 'none' }}
                >
                  Save Profile
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Suppress unused warnings for types imported for JSDoc reference purposes
export type _LikertQ = LikertQuestion;
export function _loadUnused() { return loadProfiles(); }
