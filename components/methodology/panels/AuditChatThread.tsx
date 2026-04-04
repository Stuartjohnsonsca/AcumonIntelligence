'use client';

import { useState } from 'react';
import { X, Send, Paperclip, ExternalLink, AlertTriangle, Users, MessageCircle, FileText, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Response {
  id: string;
  userId: string;
  userName: string;
  message: string;
  attachments: { name: string; url?: string }[];
  createdAt: string;
}

interface AuditPointData {
  id: string;
  chatNumber: number;
  pointType: string;
  status: string;
  description: string;
  heading?: string;
  reference?: string;
  createdByName: string;
  createdById: string;
  createdAt: string;
  closedByName?: string;
  closedAt?: string;
  responses: Response[];
  attachments?: { name: string; url?: string }[];
}

interface ActionConfig {
  canClose: boolean;
  canRespond: boolean;
  showRaiseError?: boolean;
  showAskClient?: boolean;
  showAskSpecialist?: boolean;
  showRaiseRepMgt?: boolean;
}

interface Props {
  point: AuditPointData;
  actions: ActionConfig;
  currentUserId: string;
  onRespond: (pointId: string, message: string, attachments?: File[]) => void;
  onClose: (pointId: string) => void;
  onAction?: (pointId: string, action: string) => void;
}

function formatDateTime(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function AuditChatThread({ point, actions, currentUserId, onRespond, onClose, onAction }: Props) {
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const isOpen = point.status === 'open';

  function handleSendReply() {
    if (!replyText.trim()) return;
    setReplying(true);
    onRespond(point.id, replyText.trim());
    setReplyText('');
    setReplying(false);
  }

  return (
    <div className={`border rounded-lg overflow-hidden ${isOpen ? 'border-slate-200' : 'border-slate-100 opacity-75'}`}>
      {/* Header */}
      <div className={`px-3 py-2 flex items-center justify-between ${isOpen ? 'bg-white' : 'bg-slate-50'}`}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-400">#{point.chatNumber}</span>
          {point.heading && <span className="text-[9px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">{point.heading}</span>}
          <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-medium ${
            point.status === 'open' ? 'bg-green-100 text-green-700' :
            point.status === 'committed' ? 'bg-blue-100 text-blue-700' :
            point.status === 'cancelled' ? 'bg-slate-100 text-slate-500' :
            'bg-slate-200 text-slate-600'
          }`}>{point.status}</span>
        </div>
        <div className="flex items-center gap-2 text-[9px] text-slate-400">
          <span>{point.createdByName}</span>
          <span>{formatDateTime(point.createdAt)}</span>
          {point.reference && (
            <a href={point.reference} className="text-blue-500 hover:text-blue-700"><ExternalLink className="h-3 w-3" /></a>
          )}
        </div>
      </div>

      {/* Main description */}
      <div className="px-3 py-2 text-sm text-slate-700 whitespace-pre-wrap border-b border-slate-100">
        {point.description}
        {point.attachments && (point.attachments as any[]).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {(point.attachments as any[]).map((att: any, i: number) => (
              <span key={i} className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                <Paperclip className="h-2.5 w-2.5" />{att.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Responses */}
      {point.responses && (point.responses as Response[]).length > 0 && (
        <div className="divide-y divide-slate-50">
          {(point.responses as Response[]).map(resp => (
            <div key={resp.id} className="px-3 py-2 pl-8 bg-slate-50/50">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-medium text-slate-600">{resp.userName}</span>
                <span className="text-[9px] text-slate-400">{formatDateTime(resp.createdAt)}</span>
              </div>
              <div className="text-xs text-slate-700 whitespace-pre-wrap">{resp.message}</div>
              {resp.attachments?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {resp.attachments.map((att, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-[8px] px-1 py-0.5 bg-white text-slate-500 rounded border border-slate-200">
                      <Paperclip className="h-2 w-2" />{att.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Actions + Reply (only if open) */}
      {isOpen && (
        <div className="border-t border-slate-100">
          {/* Action buttons */}
          <div className="flex items-center gap-1 px-3 py-1.5 bg-slate-50 flex-wrap">
            {actions.canClose && (
              <button onClick={() => onClose(point.id)}
                className="text-[9px] px-2 py-0.5 bg-slate-200 text-slate-600 rounded hover:bg-slate-300 font-medium">Close</button>
            )}
            {actions.showRaiseError && (
              <button onClick={() => onAction?.(point.id, 'raise_error')}
                className="text-[9px] px-2 py-0.5 bg-red-100 text-red-700 rounded hover:bg-red-200 font-medium">
                <AlertTriangle className="h-2.5 w-2.5 inline mr-0.5" />Raise Error
              </button>
            )}
            {actions.showAskClient && (
              <button onClick={() => onAction?.(point.id, 'ask_client')}
                className="text-[9px] px-2 py-0.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 font-medium">
                <Users className="h-2.5 w-2.5 inline mr-0.5" />Ask Client
              </button>
            )}
            {actions.showAskSpecialist && (
              <button onClick={() => onAction?.(point.id, 'ask_specialist')}
                className="text-[9px] px-2 py-0.5 bg-purple-100 text-purple-700 rounded hover:bg-purple-200 font-medium">
                <Shield className="h-2.5 w-2.5 inline mr-0.5" />Ask Specialist
              </button>
            )}
            {actions.showRaiseRepMgt && (
              <button onClick={() => onAction?.(point.id, 'raise_rep_mgt')}
                className="text-[9px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded hover:bg-amber-200 font-medium">
                <FileText className="h-2.5 w-2.5 inline mr-0.5" />Raise Rep/Mgt Point
              </button>
            )}
          </div>

          {/* Reply box */}
          {actions.canRespond && (
            <div className="flex items-end gap-2 px-3 py-2">
              <textarea value={replyText} onChange={e => setReplyText(e.target.value)}
                placeholder="Type a response..."
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-xs min-h-[40px] resize-y"
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendReply(); } }}
              />
              <Button onClick={handleSendReply} disabled={!replyText.trim() || replying} size="sm" className="h-9 bg-blue-600 hover:bg-blue-700">
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Closed info */}
      {!isOpen && point.closedByName && (
        <div className="px-3 py-1.5 bg-slate-50 text-[9px] text-slate-400 border-t border-slate-100">
          {point.status === 'committed' ? 'Committed' : point.status === 'cancelled' ? 'Cancelled' : 'Closed'} by {point.closedByName} on {point.closedAt ? formatDateTime(point.closedAt) : ''}
        </div>
      )}
    </div>
  );
}
