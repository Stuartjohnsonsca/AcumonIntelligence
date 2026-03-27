'use client';

import { useState, useEffect, useCallback } from 'react';
import { ThumbsUp, ThumbsDown, AlertTriangle, ChevronDown, ChevronUp, MessageSquare, Send } from 'lucide-react';

interface FeedbackEntry {
  targetId: string;
  rating: string;
  comment?: string;
}

interface Message {
  id: string;
  role: string;
  content: string;
}

interface RiskFeedbackPanelProps {
  chatId: string | null;
  messages: Message[];
}

export function RiskFeedbackPanel({ chatId, messages }: RiskFeedbackPanelProps) {
  const [feedback, setFeedback] = useState<Record<string, FeedbackEntry>>({});
  const [expandedMessage, setExpandedMessage] = useState<string | null>(null);
  const [commentText, setCommentText] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);

  // Load existing feedback for this chat
  const loadFeedback = useCallback(async () => {
    if (!chatId) return;
    try {
      const res = await fetch(`/api/risk/feedback/${chatId}`);
      if (res.ok) {
        const data = await res.json();
        const map: Record<string, FeedbackEntry> = {};
        for (const fb of data.feedback || []) {
          map[fb.targetId] = { targetId: fb.targetId, rating: fb.rating, comment: fb.comment };
        }
        setFeedback(map);
      }
    } catch { /* ignore */ }
  }, [chatId]);

  useEffect(() => { loadFeedback(); }, [loadFeedback]);

  const assistantMessages = messages.filter(m => m.role === 'assistant');

  async function submitFeedback(messageId: string, rating: string) {
    setSubmitting(messageId);
    try {
      const res = await fetch('/api/risk/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: 'chat_message',
          targetId: messageId,
          chatId,
          rating,
          comment: commentText[messageId] || null,
        }),
      });
      if (res.ok) {
        setFeedback(prev => ({
          ...prev,
          [messageId]: { targetId: messageId, rating, comment: commentText[messageId] },
        }));
      }
    } catch { /* silent */ }
    setSubmitting(null);
  }

  async function submitComment(messageId: string) {
    const existing = feedback[messageId];
    if (!existing) return;
    await submitFeedback(messageId, existing.rating);
  }

  if (assistantMessages.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5" />
          Tester Feedback
        </h3>
        <p className="text-xs text-slate-500">
          Lyra&apos;s responses will appear here for your detailed feedback. Rate each response
          and add comments to help us improve.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col max-h-[700px]">
      <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100">
        <h3 className="text-xs font-semibold text-indigo-700 uppercase tracking-wide flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5" />
          Tester Feedback Panel
        </h3>
        <p className="text-[10px] text-indigo-500 mt-0.5">
          Rate each Lyra response and add detailed comments
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {assistantMessages.map((msg, idx) => {
          const existing = feedback[msg.id];
          const isExpanded = expandedMessage === msg.id;
          const isSubmitting = submitting === msg.id;

          return (
            <div
              key={msg.id}
              className={`rounded-lg border p-3 transition-colors ${
                existing
                  ? existing.rating === 'helpful'
                    ? 'border-green-200 bg-green-50'
                    : existing.rating === 'unhelpful'
                    ? 'border-red-200 bg-red-50'
                    : 'border-amber-200 bg-amber-50'
                  : 'border-slate-200 bg-white'
              }`}
            >
              {/* Message snippet */}
              <p className="text-xs text-slate-600 line-clamp-2 mb-2">
                <span className="font-medium text-indigo-500">#{idx + 1}:</span>{' '}
                {msg.content.slice(0, 100)}{msg.content.length > 100 ? '...' : ''}
              </p>

              {/* Rating buttons */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => submitFeedback(msg.id, 'helpful')}
                  disabled={isSubmitting}
                  className={`p-1.5 rounded transition-colors ${
                    existing?.rating === 'helpful'
                      ? 'bg-green-200 text-green-700'
                      : 'bg-slate-100 text-slate-400 hover:bg-green-100 hover:text-green-600'
                  }`}
                  title="Helpful"
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => submitFeedback(msg.id, 'unhelpful')}
                  disabled={isSubmitting}
                  className={`p-1.5 rounded transition-colors ${
                    existing?.rating === 'unhelpful'
                      ? 'bg-red-200 text-red-700'
                      : 'bg-slate-100 text-slate-400 hover:bg-red-100 hover:text-red-600'
                  }`}
                  title="Unhelpful"
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => submitFeedback(msg.id, 'needs_improvement')}
                  disabled={isSubmitting}
                  className={`p-1.5 rounded transition-colors ${
                    existing?.rating === 'needs_improvement'
                      ? 'bg-amber-200 text-amber-700'
                      : 'bg-slate-100 text-slate-400 hover:bg-amber-100 hover:text-amber-600'
                  }`}
                  title="Needs improvement"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                </button>

                {/* Toggle comment */}
                <button
                  onClick={() => setExpandedMessage(isExpanded ? null : msg.id)}
                  className="ml-auto p-1 text-slate-400 hover:text-indigo-600 transition-colors"
                  title="Add detailed comment"
                >
                  {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              </div>

              {/* Expandable comment area */}
              {isExpanded && (
                <div className="mt-2">
                  <textarea
                    value={commentText[msg.id] || existing?.comment || ''}
                    onChange={(e) => setCommentText(prev => ({ ...prev, [msg.id]: e.target.value }))}
                    placeholder="Describe what was good, bad, or could be improved..."
                    rows={3}
                    className="w-full px-2.5 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                  />
                  {existing && (
                    <button
                      onClick={() => submitComment(msg.id)}
                      disabled={isSubmitting}
                      className="mt-1.5 inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors disabled:opacity-50"
                    >
                      <Send className="h-3 w-3" />
                      Save Feedback
                    </button>
                  )}
                </div>
              )}

              {/* Existing comment display */}
              {!isExpanded && existing?.comment && (
                <p className="mt-1.5 text-[10px] text-slate-500 italic line-clamp-2">
                  &ldquo;{existing.comment}&rdquo;
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
