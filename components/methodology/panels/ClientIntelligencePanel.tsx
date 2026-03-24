'use client';

import { useState, useEffect, useCallback } from 'react';
import { INTELLIGENCE_CATEGORIES } from '@/types/methodology';

interface IntelligenceItem {
  id: string;
  category: string;
  content: string;
  source: string | null;
  significantChange: boolean;
  lastUpdated: string;
  reviews: { id: string; userId: string; user: { id: string; name: string }; reviewedAt: string }[];
}

interface Props {
  engagementId: string;
  clientId?: string;
  teamMemberCount: number;
  currentUserId: string;
}

export function ClientIntelligencePanel({ engagementId, clientId, teamMemberCount, currentUserId }: Props) {
  const [intelligence, setIntelligence] = useState<IntelligenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiPopulating, setAiPopulating] = useState(false);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [savingCategory, setSavingCategory] = useState<string | null>(null);

  const loadIntelligence = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/intelligence`);
      if (res.ok) {
        const data = await res.json();
        setIntelligence(data.intelligence || []);
      }
    } catch (err) {
      console.error('Failed to load intelligence:', err);
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => { loadIntelligence(); }, [loadIntelligence]);

  // Auto-populate with AI when intelligence is empty and clientId is available
  useEffect(() => {
    if (!loading && intelligence.length === 0 && clientId && engagementId) {
      populateWithAI();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, intelligence.length, clientId, engagementId]);

  async function populateWithAI() {
    setAiPopulating(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/intelligence`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ai_populate', clientId }),
      });
      if (res.ok) {
        await loadIntelligence();
      }
    } catch (err) {
      console.error('Failed to AI populate:', err);
    } finally {
      setAiPopulating(false);
    }
  }

  async function saveCategory(category: string) {
    setSavingCategory(category);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/intelligence`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, content: editContent, source: 'manual' }),
      });
      if (res.ok) {
        await loadIntelligence();
        setEditingCategory(null);
      }
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setSavingCategory(null);
    }
  }

  async function markReviewed(intelligenceId: string) {
    try {
      await fetch(`/api/engagements/${engagementId}/intelligence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'review', intelligenceId }),
      });
      await loadIntelligence();
    } catch (err) {
      console.error('Failed to review:', err);
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-4 h-full">
        <h3 className="text-sm font-semibold text-slate-800 mb-2">Client Intelligence</h3>
        <p className="text-xs text-slate-400 animate-pulse">Loading...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 h-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-800">Client Intelligence</h3>
        <div className="flex items-center gap-2">
          {aiPopulating && (
            <span className="text-xs text-purple-500 animate-pulse flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-purple-400 animate-ping" />
              AI researching...
            </span>
          )}
          <button
            onClick={populateWithAI}
            disabled={aiPopulating}
            className="text-xs px-2 py-1 bg-purple-50 text-purple-600 rounded hover:bg-purple-100 disabled:opacity-50"
            title="Research client using AI"
          >
            🔍 AI Refresh
          </button>
        </div>
      </div>

      <div className="space-y-2 max-h-[550px] overflow-auto">
        {INTELLIGENCE_CATEGORIES.map(cat => {
          const item = intelligence.find(i => i.category === cat.key);
          const isEditing = editingCategory === cat.key;
          const hasContent = item && item.content?.length > 0;
          const hasUpdate = item?.significantChange;
          const reviewCount = item?.reviews?.length || 0;
          const isAiSource = item?.source === 'ai';

          return (
            <div key={cat.key} className={`border rounded p-2 ${hasUpdate ? 'border-orange-200 bg-orange-50/30' : 'border-slate-100'}`}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  {/* Status dot */}
                  <span className={`inline-block w-2 h-2 rounded-full ${
                    hasUpdate ? 'bg-orange-400' :
                    hasContent ? 'bg-green-400' :
                    'bg-gray-300'
                  }`} />
                  <span className="text-xs font-medium text-slate-700">{cat.label}</span>
                  {isAiSource && hasContent && (
                    <span className="text-[9px] bg-purple-100 text-purple-600 px-1 rounded">AI</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {/* Review dots */}
                  {item && Array.from({ length: teamMemberCount }).map((_, idx) => {
                    const review = item.reviews?.[idx];
                    return (
                      <button
                        key={idx}
                        onClick={() => !review && item.id && markReviewed(item.id)}
                        className={`w-3 h-3 rounded-full border ${
                          review
                            ? hasUpdate ? 'bg-orange-300 border-orange-400' : 'bg-green-300 border-green-400'
                            : 'bg-white border-slate-300 hover:border-blue-400'
                        }`}
                        title={review ? `${review.user.name} - ${new Date(review.reviewedAt).toLocaleDateString()}` : 'Click to mark as reviewed'}
                      />
                    );
                  })}
                  <span className="text-[10px] text-slate-400 ml-1">
                    {reviewCount > 0 && `${reviewCount} reviewed`}
                  </span>
                </div>
              </div>

              {isEditing ? (
                <div className="mt-1">
                  <textarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    className="w-full border border-slate-200 rounded p-1.5 text-xs min-h-[60px] focus:outline-none focus:ring-1 focus:ring-blue-300"
                    placeholder="Enter intelligence details..."
                  />
                  <div className="flex gap-1 mt-1">
                    <button
                      onClick={() => saveCategory(cat.key)}
                      disabled={savingCategory === cat.key}
                      className="text-xs px-2 py-0.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                    >
                      {savingCategory === cat.key ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={() => setEditingCategory(null)}
                      className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded hover:bg-slate-200"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => { setEditingCategory(cat.key); setEditContent(item?.content || ''); }}
                  className="text-xs text-slate-500 mt-1 cursor-pointer hover:bg-slate-50 rounded p-1 min-h-[20px]"
                >
                  {hasContent ? (
                    <span className="line-clamp-3">{item.content}</span>
                  ) : (
                    <span className="italic text-slate-300">Click to add details...</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
