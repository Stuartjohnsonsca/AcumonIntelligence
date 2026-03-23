'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Calendar, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface RiskChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: {
    commitmentType?: string;
    actionPlan?: {
      title: string;
      summary: string;
      commitmentType: string;
      tasks: Array<{
        taskNumber: number;
        description: string;
        responsible: string;
        deadline: string;
        deliverable: string;
        guidance?: string;
      }>;
    };
    shouldBook?: boolean;
  };
}

interface RiskChatWindowProps {
  messages: RiskChatMessage[];
  onSendMessage: (message: string) => Promise<void>;
  onBookingRequested?: () => void;
  onAcceptPlan?: () => void;
  onRejectPlan?: () => void;
  isLoading: boolean;
  className?: string;
}

const COMMITMENT_LABELS: Record<string, { label: string; color: string }> = {
  user_activity: { label: 'User Activity', color: 'bg-blue-100 text-blue-800' },
  system_work: { label: 'AI System Work', color: 'bg-violet-100 text-violet-800' },
  auditor_work: { label: 'Professional Auditor', color: 'bg-amber-100 text-amber-800' },
  software_dev: { label: 'Software Development', color: 'bg-emerald-100 text-emerald-800' },
};

export function RiskChatWindow({
  messages,
  onSendMessage,
  onBookingRequested,
  onAcceptPlan,
  onRejectPlan,
  isLoading,
  className,
}: RiskChatWindowProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    setInput('');
    await onSendMessage(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  return (
    <div className={cn('flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm', className)}>
      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[300px] max-h-[600px]">
        {/* Welcome message */}
        {messages.length === 0 && (
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center">
              <span className="text-white text-xs font-bold">L</span>
            </div>
            <div className="flex-1">
              <div className="bg-indigo-50 rounded-lg rounded-tl-none p-3 text-sm text-slate-700 leading-relaxed">
                <p className="font-medium text-indigo-900 mb-1">Lyra — Risk Advisory</p>
                How can I help you with your risk concerns today?
              </div>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={cn('flex gap-3', msg.role === 'user' && 'flex-row-reverse')}>
            <div className={cn(
              'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
              msg.role === 'user' ? 'bg-slate-600' : 'bg-indigo-600',
            )}>
              <span className="text-white text-xs font-bold">
                {msg.role === 'user' ? 'You' : 'L'}
              </span>
            </div>
            <div className="flex-1 max-w-[85%]">
              <div className={cn(
                'rounded-lg p-3 text-sm leading-relaxed',
                msg.role === 'user'
                  ? 'bg-slate-100 rounded-tr-none text-slate-800'
                  : 'bg-indigo-50 rounded-tl-none text-slate-700',
              )}>
                {msg.content.split('\n').map((line, i) => (
                  <p key={i} className={i > 0 ? 'mt-2' : ''}>
                    {line.startsWith('**') && line.endsWith('**')
                      ? <strong>{line.slice(2, -2)}</strong>
                      : line.startsWith('- ')
                        ? <span className="block ml-3">&bull; {line.slice(2)}</span>
                        : line}
                  </p>
                ))}
              </div>

              {/* Action Plan Display */}
              {msg.metadata?.actionPlan && (
                <div className="mt-3 border border-indigo-200 rounded-lg overflow-hidden">
                  <div className="bg-indigo-600 px-4 py-2">
                    <h4 className="text-white font-semibold text-sm">{msg.metadata.actionPlan.title}</h4>
                    {msg.metadata.commitmentType && (
                      <span className={cn(
                        'inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase',
                        COMMITMENT_LABELS[msg.metadata.commitmentType]?.color || 'bg-slate-100 text-slate-800',
                      )}>
                        {COMMITMENT_LABELS[msg.metadata.commitmentType]?.label || msg.metadata.commitmentType}
                      </span>
                    )}
                  </div>
                  <div className="p-3 bg-white">
                    <p className="text-xs text-slate-500 mb-3">{msg.metadata.actionPlan.summary}</p>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-200">
                          <th className="text-left py-1.5 pr-2 font-semibold text-slate-600">#</th>
                          <th className="text-left py-1.5 pr-2 font-semibold text-slate-600">Task</th>
                          <th className="text-left py-1.5 pr-2 font-semibold text-slate-600">Responsible</th>
                          <th className="text-left py-1.5 pr-2 font-semibold text-slate-600">Deadline</th>
                          <th className="text-left py-1.5 font-semibold text-slate-600">Deliverable</th>
                        </tr>
                      </thead>
                      <tbody>
                        {msg.metadata.actionPlan.tasks.map((task) => (
                          <tr key={task.taskNumber} className="border-b border-slate-100 last:border-0">
                            <td className="py-2 pr-2 align-top font-medium text-indigo-600">{task.taskNumber}</td>
                            <td className="py-2 pr-2 align-top text-slate-700">
                              {task.description}
                              {task.guidance && (
                                <p className="mt-1 text-slate-400 italic">{task.guidance}</p>
                              )}
                            </td>
                            <td className="py-2 pr-2 align-top text-slate-600 whitespace-nowrap">{task.responsible}</td>
                            <td className="py-2 pr-2 align-top text-slate-600 whitespace-nowrap">{task.deadline}</td>
                            <td className="py-2 align-top text-slate-600">{task.deliverable}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="border-t border-indigo-100 px-4 py-2 bg-indigo-50 flex gap-2">
                    <button
                      onClick={() => onAcceptPlan?.()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-md hover:bg-emerald-700 transition-colors"
                    >
                      <CheckCircle className="h-3.5 w-3.5" />
                      Accept Plan
                    </button>
                    <button
                      onClick={() => onRejectPlan?.()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-200 text-slate-700 text-xs font-medium rounded-md hover:bg-slate-300 transition-colors"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Revise
                    </button>
                  </div>
                </div>
              )}

              {/* Booking suggestion */}
              {msg.metadata?.shouldBook && (
                <div className="mt-2">
                  <button
                    onClick={() => onBookingRequested?.()}
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-full hover:bg-emerald-700 transition-colors"
                  >
                    <Calendar className="h-3 w-3" />
                    Book a meeting with our risk specialist
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center">
              <span className="text-white text-xs font-bold">L</span>
            </div>
            <div className="flex-1">
              <div className="bg-indigo-50 rounded-lg rounded-tl-none p-3">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-slate-200 p-3 flex gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe your risk concern..."
          rows={1}
          className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          disabled={isLoading}
        />
        <Button
          type="submit"
          size="sm"
          disabled={!input.trim() || isLoading}
          className="self-end bg-indigo-600 hover:bg-indigo-700"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
