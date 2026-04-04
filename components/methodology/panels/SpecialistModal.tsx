'use client';

import { useState } from 'react';
import { X, Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Specialist {
  id: string;
  name: string;
  email?: string;
  specialistType: string;
  firmName?: string;
}

interface Props {
  specialists: Specialist[];
  engagementId: string;
  contextMessage?: string;
  onClose: () => void;
  onSent?: () => void;
}

export function SpecialistModal({ specialists, engagementId, contextMessage, onClose, onSent }: Props) {
  const [selectedId, setSelectedId] = useState('');
  const [message, setMessage] = useState(contextMessage || '');
  const [sending, setSending] = useState(false);

  async function handleSend() {
    if (!selectedId || !message.trim()) return;
    setSending(true);
    try {
      // Create outstanding item for specialist communication
      await fetch(`/api/engagements/${engagementId}/outstanding`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'specialist_request',
          title: `Specialist Query: ${specialists.find(s => s.id === selectedId)?.name || 'Specialist'}`,
          description: message.trim(),
          source: 'manual',
          status: 'awaiting_team',
          assignedTo: selectedId,
          priority: 'normal',
        }),
      });
      onSent?.();
      onClose();
    } finally { setSending(false); }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/30 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-xl w-[500px] max-h-[80vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800">Ask Specialist</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Select Specialist</label>
            <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">Choose...</option>
              {specialists.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.specialistType}){s.firmName ? ` — ${s.firmName}` : ''}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Message</label>
            <textarea value={message} onChange={e => setMessage(e.target.value)}
              placeholder="Describe what you need from the specialist..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[100px]" rows={4} />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button onClick={onClose} size="sm" variant="outline">Cancel</Button>
          <Button onClick={handleSend} size="sm" disabled={!selectedId || !message.trim() || sending} className="bg-purple-600 hover:bg-purple-700">
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Send className="h-3.5 w-3.5 mr-1" />}
            Send to Specialist
          </Button>
        </div>
      </div>
    </div>
  );
}
