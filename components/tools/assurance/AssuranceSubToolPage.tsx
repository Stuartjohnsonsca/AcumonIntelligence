'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileText, Search, AlertTriangle, ArrowLeft, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AssuranceChatWindow, type ChatMessage } from './AssuranceChatWindow';
import { TermsOfReferenceView } from './TermsOfReferenceView';

interface AssuranceSubToolPageProps {
  subToolKey: string;
  subToolName: string;
  clientId: string;
  clientName: string;
  clientSector?: string | null;
}

const ACTION_BUTTONS = [
  {
    key: 'terms_of_reference',
    label: 'I need terms of reference prepared',
    icon: FileText,
    color: 'bg-blue-600 hover:bg-blue-700',
  },
  {
    key: 'sample_testing',
    label: 'I need some help with sample testing',
    icon: Search,
    color: 'bg-emerald-600 hover:bg-emerald-700',
  },
  {
    key: 'duplicate_transactions',
    label: 'I am worried about duplicate transactions',
    icon: AlertTriangle,
    color: 'bg-amber-600 hover:bg-amber-700',
  },
];

interface FrequentAction {
  engagementType: string;
  count: number;
}

export function AssuranceSubToolPage({
  subToolKey,
  subToolName,
  clientId,
  clientName,
  clientSector,
}: AssuranceSubToolPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialChatId = searchParams.get('chatId');

  const [chatId, setChatId] = useState<string | null>(initialChatId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [engagementId, setEngagementId] = useState<string | null>(null);
  const [engagementType, setEngagementType] = useState<string | null>(null);
  const [frequentActions, setFrequentActions] = useState<FrequentAction[]>([]);

  // Load existing chat if chatId provided
  useEffect(() => {
    if (initialChatId) {
      loadChat(initialChatId);
    }
    loadFrequentActions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadChat(id: string) {
    try {
      const res = await fetch(`/api/assurance/chat?chatId=${id}`);
      if (res.ok) {
        const data = await res.json();
        const loadedMessages: ChatMessage[] = data.messages.map(
          (m: { id: string; role: string; content: string; metadata?: Record<string, unknown> }) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            metadata: m.metadata,
          }),
        );
        setMessages(loadedMessages);
        if (data.engagement) {
          setEngagementId(data.engagement.id);
          setEngagementType(data.engagement.engagementType);
        }
      }
    } catch (err) {
      console.error('Failed to load chat:', err);
    }
  }

  async function loadFrequentActions() {
    try {
      const res = await fetch(`/api/assurance/engagement?clientId=${clientId}&frequent=true`);
      if (res.ok) {
        const data = await res.json();
        setFrequentActions(data);
      }
    } catch {
      // Ignore - non-critical
    }
  }

  const handleSendMessage = useCallback(async (message: string) => {
    setIsLoading(true);
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message,
    };
    setMessages(prev => [...prev, userMsg]);

    try {
      const res = await fetch('/api/assurance/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          chatId,
          message,
          mode: 'drill_down',
          subTool: subToolKey,
        }),
      });

      if (!res.ok) throw new Error('Failed to send message');

      const data = await res.json();
      setChatId(data.chatId);

      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.message,
        metadata: data.metadata,
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      console.error('Chat error:', err);
      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'I apologise, but I encountered an error. Please try again.',
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [clientId, chatId, subToolKey]);

  async function handleActionClick(actionKey: string) {
    if (!chatId) {
      // Need to start a chat first
      await handleSendMessage(`I would like to proceed with: ${ACTION_BUTTONS.find(a => a.key === actionKey)?.label}`);
    }

    try {
      const res = await fetch('/api/assurance/engagement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: chatId,
          clientId,
          subTool: subToolKey,
          engagementType: actionKey,
          sector: clientSector,
        }),
      });

      if (!res.ok) throw new Error('Failed to create engagement');

      const data = await res.json();
      setEngagementId(data.id);
      setEngagementType(actionKey);
    } catch (err) {
      console.error('Engagement creation error:', err);
    }
  }

  // If we have an engagement for ToR, show the ToR view
  if (engagementId && engagementType === 'terms_of_reference') {
    return (
      <TermsOfReferenceView
        engagementId={engagementId}
        clientId={clientId}
        clientName={clientName}
        clientSector={clientSector}
        subToolKey={subToolKey}
        subToolName={subToolName}
        chatId={chatId}
        messages={messages}
        onSendMessage={handleSendMessage}
        isLoading={isLoading}
      />
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="container mx-auto">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => router.push(`/tools/assurance?clientId=${clientId}`)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to Hub
            </Button>
            <div>
              <p className="text-sm font-medium text-blue-600 uppercase tracking-wide">Assurance &mdash; {subToolName}</p>
              <h1 className="text-xl font-bold text-slate-900">{clientName}</h1>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-6">
        {/* Chat Window */}
        <div className="mb-6">
          <AssuranceChatWindow
            chatId={chatId}
            clientId={clientId}
            messages={messages}
            onSendMessage={handleSendMessage}
            isLoading={isLoading}
            welcomeMessage={`Welcome to the ${subToolName} service. I'll help you define the scope and requirements for your engagement. What specific areas would you like to focus on?`}
            className="h-[400px]"
          />
        </div>

        {/* Action Buttons + Frequent Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Main Action Buttons - 3 columns */}
          <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            {ACTION_BUTTONS.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.key}
                  onClick={() => handleActionClick(action.key)}
                  className={`flex flex-col items-center gap-3 p-6 rounded-xl text-white transition-all shadow-sm hover:shadow-md ${action.color}`}
                >
                  <Icon className="h-8 w-8" />
                  <span className="text-sm font-medium text-center leading-tight">{action.label}</span>
                </button>
              );
            })}
          </div>

          {/* Frequent Actions Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-1">
                <TrendingUp className="h-3 w-3" /> Popular
              </h4>
              {frequentActions.length > 0 ? (
                <div className="space-y-2">
                  {frequentActions.map((action) => (
                    <button
                      key={action.engagementType}
                      onClick={() => handleActionClick(action.engagementType)}
                      className="w-full text-left px-3 py-2 text-xs text-slate-600 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                    >
                      {ACTION_BUTTONS.find(a => a.key === action.engagementType)?.label || action.engagementType}
                      <span className="ml-1 text-slate-400">({action.count})</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">No frequent actions yet</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
