'use client';

import { useState } from 'react';
import { HelpCircle, Loader2, Send, X } from 'lucide-react';
import { startHowToTour } from './HowToOverlay';

const SUGGESTIONS = [
  'How do I add a new monitoring activity?',
  'How do I register an AI tool?',
  'How do I record a CSF for the Goodwill pillar?',
  'How do I log a remediation action?',
  'How do I seed the standard G3Q defaults?',
];

export function HowToButton() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(q: string) {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/howto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q.trim(),
          currentUrl: typeof window !== 'undefined' ? window.location.pathname : '',
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
      const steps = json?.steps;
      if (!Array.isArray(steps) || steps.length === 0) {
        setError("I couldn't map that question to the screens I know about. Try rephrasing, or check the suggestions below.");
        return;
      }
      startHowToTour(q.trim(), steps);
      setOpen(false);
      setQuestion('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to ask');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-[9990] inline-flex items-center gap-1.5 text-xs px-3 py-2 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 rounded-full shadow-lg font-medium transition-colors"
        title="Ask the screen to show you how"
      >
        <HelpCircle className="h-4 w-4" /> How do I…?
      </button>

      {open && (
        <div className="fixed inset-0 z-[9991] flex items-end sm:items-center justify-center p-4 bg-black/30" onClick={() => !loading && setOpen(false)}>
          <div className="bg-white rounded-lg shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-200 bg-yellow-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-yellow-700" />
                <h2 className="text-sm font-semibold text-slate-900">Ask &ldquo;how do I…&rdquo;</h2>
              </div>
              <button onClick={() => setOpen(false)} disabled={loading} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <p className="text-xs text-slate-500">
                Type a question and the system will walk a yellow dot through the steps on screen. Read-only — the dot points but doesn&apos;t click for you.
              </p>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  ask(question);
                }}
                className="flex items-center gap-2"
              >
                <input
                  autoFocus
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="e.g. how do I record a remediation?"
                  maxLength={500}
                  disabled={loading}
                  className="flex-1 text-sm border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent"
                />
                <button
                  type="submit"
                  disabled={loading || !question.trim()}
                  className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 rounded font-medium disabled:bg-slate-200 disabled:text-slate-400"
                >
                  {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  Ask
                </button>
              </form>

              {error && (
                <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">
                  {error}
                </div>
              )}

              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1.5">Try one of these:</p>
                <div className="space-y-1">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => ask(s)}
                      disabled={loading}
                      className="block w-full text-left text-xs px-2 py-1.5 rounded text-slate-700 hover:bg-yellow-50 hover:text-slate-900 disabled:opacity-50"
                    >
                      &ldquo;{s}&rdquo;
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
