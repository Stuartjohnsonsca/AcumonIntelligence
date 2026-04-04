'use client';

import { useState, useEffect } from 'react';
import { Plus, Loader2, X, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PointData {
  id: string;
  chatNumber: number;
  status: string;
  heading: string | null;
  description: string;
  body: string | null;
  createdByName: string;
  createdAt: string;
  closedByName?: string;
  closedAt?: string;
  updatedAt: string;
}

interface Props {
  engagementId: string;
  pointType: 'management' | 'representation';
  title: string;
  headingOptions?: string[];
  onClose: () => void;
}

function formatDateTime(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ManagementPointPanel({ engagementId, pointType, title, headingOptions: initialHeadings = [], onClose }: Props) {
  const [points, setPoints] = useState<PointData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [headingOptions, setHeadingOptions] = useState<string[]>(initialHeadings);

  // Fetch headings from methodology template
  useEffect(() => {
    if (initialHeadings.length > 0) return;
    const templateType = pointType === 'management' ? 'management_headings' : 'representation_headings';
    fetch(`/api/methodology-admin/templates?type=${templateType}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.template?.items && Array.isArray(data.template.items)) {
          setHeadingOptions(data.template.items);
        }
      })
      .catch(() => {});
  }, [pointType, initialHeadings.length]);
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null);

  // Create form
  const [heading, setHeading] = useState('');
  const [customHeading, setCustomHeading] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => { loadPoints(); }, [engagementId]);

  async function loadPoints() {
    setLoading(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/audit-points?type=${pointType}`);
      if (res.ok) setPoints((await res.json()).points || []);
    } finally { setLoading(false); }
  }

  async function createPoint() {
    const h = heading === '__custom' ? customHeading.trim() : heading;
    if (!description.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/audit-points`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pointType, description: description.trim(), heading: h || null, body: body.trim() || null, reference: window.location.href }),
      });
      if (res.ok) {
        setDescription(''); setBody(''); setHeading(''); setCustomHeading('');
        setShowCreate(false);
        loadPoints();
      }
    } finally { setCreating(false); }
  }

  async function handleAction(pointId: string, action: 'commit' | 'cancel') {
    await fetch(`/api/engagements/${engagementId}/audit-points`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pointId, action }),
    });
    loadPoints();
  }

  async function updatePoint(pointId: string, updates: Partial<PointData>) {
    await fetch(`/api/engagements/${engagementId}/audit-points`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pointId, action: 'update', ...updates }),
    });
    loadPoints();
  }

  const openPoints = points.filter(p => p.status === 'open');
  const closedPoints = points.filter(p => p.status !== 'open');
  const color = pointType === 'management' ? { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', btn: 'bg-orange-600 hover:bg-orange-700' }
    : { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', btn: 'bg-purple-600 hover:bg-purple-700' };

  return (
    <div className="fixed inset-0 z-[60] bg-black/30 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-2xl w-[900px] max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h2 className="text-sm font-bold text-slate-800">{title}</h2>
            <p className="text-[10px] text-slate-500">{openPoints.length} open, {closedPoints.length} committed/cancelled</p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => setShowCreate(!showCreate)} size="sm" variant="outline"><Plus className="h-3.5 w-3.5 mr-1" />New Point</Button>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded"><X className="h-5 w-5 text-slate-400" /></button>
          </div>
        </div>

        {/* Create form */}
        {showCreate && (
          <div className={`px-4 py-3 border-b ${color.bg}`}>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Heading</label>
                <select value={heading} onChange={e => setHeading(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">Select heading...</option>
                  {headingOptions.map(h => <option key={h} value={h}>{h}</option>)}
                  <option value="__custom">Other (free text)</option>
                </select>
                {heading === '__custom' && (
                  <input value={customHeading} onChange={e => setCustomHeading(e.target.value)}
                    placeholder="Enter custom heading..." className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-2" />
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Description of issue</label>
                <textarea value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="Explain the issue..."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[80px]" rows={3} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Detail</label>
                <textarea value={body} onChange={e => setBody(e.target.value)}
                  placeholder="Supporting detail, findings, recommendations..."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[60px]" rows={3} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <Button onClick={() => setShowCreate(false)} size="sm" variant="outline">Cancel</Button>
              <Button onClick={createPoint} size="sm" disabled={!description.trim() || creating} className={color.btn}>
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
            <div className="text-center py-8 text-slate-400 text-sm">No points yet. Click "New Point" to create one.</div>
          ) : (
            <>
              {openPoints.map(p => (
                <div key={p.id} className={`border rounded-lg overflow-hidden ${color.border}`}>
                  <div className="px-3 py-2 flex items-center justify-between bg-white">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-400">#{p.chatNumber}</span>
                      {p.heading && <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${color.bg} ${color.text}`}>{p.heading}</span>}
                      <span className="text-[8px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">Open</span>
                    </div>
                    <div className="text-[9px] text-slate-400">{p.createdByName} &middot; {formatDateTime(p.createdAt)}</div>
                  </div>
                  <div className="px-3 py-2 text-sm text-slate-700 whitespace-pre-wrap border-t border-slate-100">{p.description}</div>
                  {p.body && <div className="px-3 py-2 text-xs text-slate-600 whitespace-pre-wrap border-t border-slate-50 bg-slate-50/50">{p.body}</div>}
                  <div className="px-3 py-2 border-t border-slate-100 flex items-center justify-between bg-slate-50">
                    <div className="text-[9px] text-slate-400">Last modified: {formatDateTime(p.updatedAt)}</div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleAction(p.id, 'commit')}
                        className="text-[9px] px-2 py-0.5 bg-green-600 text-white rounded hover:bg-green-700 font-medium">
                        <CheckCircle2 className="h-2.5 w-2.5 inline mr-0.5" />Commit
                      </button>
                      <button onClick={() => handleAction(p.id, 'cancel')}
                        className="text-[9px] px-2 py-0.5 bg-red-100 text-red-600 rounded hover:bg-red-200 font-medium">
                        <XCircle className="h-2.5 w-2.5 inline mr-0.5" />Cancel
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {closedPoints.length > 0 && (
                <>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pt-2">Committed / Cancelled</div>
                  {closedPoints.map(p => (
                    <div key={p.id} className="border border-slate-100 rounded-lg overflow-hidden opacity-60">
                      <div className="px-3 py-2 flex items-center justify-between bg-slate-50">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-400">#{p.chatNumber}</span>
                          {p.heading && <span className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">{p.heading}</span>}
                          <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-medium ${p.status === 'committed' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{p.status}</span>
                        </div>
                      </div>
                      <div className="px-3 py-2 text-sm text-slate-500">{p.description}</div>
                      {p.closedByName && <div className="px-3 py-1.5 bg-slate-50 text-[9px] text-slate-400 border-t">{p.status === 'committed' ? 'Committed' : 'Cancelled'} by {p.closedByName} on {p.closedAt ? formatDateTime(p.closedAt) : ''}</div>}
                    </div>
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
