'use client';

import { useState, useEffect } from 'react';
import { Plus, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuditChatThread } from './AuditChatThread';

interface Props {
  engagementId: string;
  userId: string;
  onClose: () => void;
  onAction?: (action: string, pointId: string) => void;
}

export function ReviewPointsPanel({ engagementId, userId, onClose, onAction }: Props) {
  const [points, setPoints] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => { loadPoints(); }, [engagementId]);

  async function loadPoints() {
    setLoading(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/audit-points?type=review_point`);
      if (res.ok) setPoints((await res.json()).points || []);
    } finally { setLoading(false); }
  }

  async function createPoint() {
    if (!newDesc.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/audit-points`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pointType: 'review_point', description: newDesc.trim(), reference: window.location.href }),
      });
      if (res.ok) {
        setNewDesc('');
        setShowCreate(false);
        loadPoints();
      }
    } finally { setCreating(false); }
  }

  async function handleRespond(pointId: string, message: string) {
    await fetch(`/api/engagements/${engagementId}/audit-points`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pointId, action: 'respond', message }),
    });
    loadPoints();
  }

  async function handleClose(pointId: string) {
    await fetch(`/api/engagements/${engagementId}/audit-points`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pointId, action: 'close' }),
    });
    loadPoints();
  }

  const openPoints = points.filter(p => p.status === 'open');
  const closedPoints = points.filter(p => p.status !== 'open');

  return (
    <div className="fixed inset-0 z-[60] bg-black/30 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-2xl w-[800px] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h2 className="text-sm font-bold text-slate-800">Review Points</h2>
            <p className="text-[10px] text-slate-500">{openPoints.length} open, {closedPoints.length} closed</p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => setShowCreate(!showCreate)} size="sm" variant="outline"><Plus className="h-3.5 w-3.5 mr-1" />New Point</Button>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded"><X className="h-5 w-5 text-slate-400" /></button>
          </div>
        </div>

        {/* Create form */}
        {showCreate && (
          <div className="px-4 py-3 border-b bg-amber-50/30">
            <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)}
              placeholder="Describe the review point..."
              className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm min-h-[80px]" rows={3} autoFocus />
            <div className="flex justify-end gap-2 mt-2">
              <Button onClick={() => setShowCreate(false)} size="sm" variant="outline">Cancel</Button>
              <Button onClick={createPoint} size="sm" disabled={!newDesc.trim() || creating} className="bg-amber-600 hover:bg-amber-700">
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}Create
              </Button>
            </div>
          </div>
        )}

        {/* Points list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {loading ? (
            <div className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin text-blue-500 mx-auto" /></div>
          ) : points.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">No review points yet. Click "New Point" to create one.</div>
          ) : (
            <>
              {openPoints.map(point => (
                <AuditChatThread
                  key={point.id}
                  point={{ ...point, responses: point.responses || [] }}
                  actions={{ canClose: true, canRespond: true, showRaiseError: true, showAskClient: true, showAskSpecialist: true, showRaiseRepMgt: true }}
                  currentUserId={userId}
                  onRespond={handleRespond}
                  onClose={handleClose}
                  onAction={(pid, act) => onAction?.(act, pid)}
                />
              ))}
              {closedPoints.length > 0 && (
                <>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pt-2">Closed</div>
                  {closedPoints.map(point => (
                    <AuditChatThread
                      key={point.id}
                      point={{ ...point, responses: point.responses || [] }}
                      actions={{ canClose: false, canRespond: false }}
                      currentUserId={userId}
                      onRespond={handleRespond}
                      onClose={handleClose}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
