'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AssuranceFeedbackPanel } from './AssuranceFeedbackPanel';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: {
    recommendedSubTool?: string;
    shouldBook?: boolean;
    projectDetails?: Record<string, string>;
  };
}

interface AssuranceChatWindowProps {
  chatId: string | null;
  clientId: string;
  messages: ChatMessage[];
  onSendMessage: (message: string) => Promise<void>;
  onSubToolRecommended?: (subTool: string) => void;
  onBookingRequested?: () => void;
  isLoading: boolean;
  welcomeMessage?: string;
  className?: string;
}

const SUB_TOOL_DISPLAY: Record<string, string> = {
  Governance: 'Agentic AI & Governance',
  CyberResiliance: 'Cyber Risk',
  TalentRisk: 'Workforce & Talent Risk',
  ESGSustainability: 'ESG & Sustainability',
  Diversity: 'Meritocracy & Diversity',
};

export function AssuranceChatWindow({
  chatId,
  messages,
  onSendMessage,
  onSubToolRecommended,
  onBookingRequested,
  isLoading,
  welcomeMessage = 'How can we help you today? What are your concerns? I can help produce terms of reference for any particular area.',
  className,
}: AssuranceChatWindowProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isFeedbackUser, setIsFeedbackUser] = useState(false);

  // Check if current user is a feedback user
  useEffect(() => {
    fetch('/api/assurance/feedback')
      .then(res => res.json())
      .then(data => setIsFeedbackUser(data.isFeedbackUser === true))
      .catch(() => {});
  }, []);

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
    <div className={cn('flex gap-3', className)}>
      {/* Feedback Panel — left side, only for IA Feedback Users */}
      {isFeedbackUser && chatId && (
        <AssuranceFeedbackPanel chatId={chatId} messages={messages} />
      )}

      {/* Chat Window */}
      <div className="flex-1 flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm min-h-0">
      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[300px] max-h-[500px]">
        {/* Welcome message */}
        {messages.length === 0 && (
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
              <span className="text-white text-xs font-bold">AI</span>
            </div>
            <div className="flex-1">
              <div className="bg-blue-50 rounded-lg rounded-tl-none p-3 text-sm text-slate-700 leading-relaxed">
                {welcomeMessage}
              </div>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={cn('flex gap-3', msg.role === 'user' && 'flex-row-reverse')}>
            <div className={cn(
              'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
              msg.role === 'user' ? 'bg-slate-600' : 'bg-blue-600',
            )}>
              <span className="text-white text-xs font-bold">
                {msg.role === 'user' ? 'You' : 'AI'}
              </span>
            </div>
            <div className="flex-1 max-w-[80%]">
              <div className={cn(
                'rounded-lg p-3 text-sm leading-relaxed',
                msg.role === 'user'
                  ? 'bg-slate-100 rounded-tr-none text-slate-800'
                  : 'bg-blue-50 rounded-tl-none text-slate-700',
              )}>
                {msg.content.split('\n').map((line, i) => (
                  <p key={i} className={i > 0 ? 'mt-2' : ''}>
                    {line.startsWith('**') && line.endsWith('**')
                      ? <strong>{line.slice(2, -2)}</strong>
                      : line}
                  </p>
                ))}
              </div>

              {/* Sub-tool recommendation badge */}
              {msg.metadata?.recommendedSubTool && (
                <div className="mt-2">
                  <button
                    onClick={() => onSubToolRecommended?.(msg.metadata!.recommendedSubTool!)}
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-full hover:bg-blue-700 transition-colors"
                  >
                    Recommended: {SUB_TOOL_DISPLAY[msg.metadata.recommendedSubTool] || msg.metadata.recommendedSubTool}
                    <span className="text-blue-200">&rarr;</span>
                  </button>
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
                    Book a meeting with our specialist
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
              <span className="text-white text-xs font-bold">AI</span>
            </div>
            <div className="flex-1">
              <div className="bg-blue-50 rounded-lg rounded-tl-none p-3">
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
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
          placeholder="Type your message..."
          rows={1}
          className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          disabled={isLoading}
        />
        <Button
          type="submit"
          size="sm"
          disabled={!input.trim() || isLoading}
          className="self-end"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
      </div>
    </div>
  );
}
