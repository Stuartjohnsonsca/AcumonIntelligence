'use client';

import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, Cpu, Users, Leaf, Scale } from 'lucide-react';
import { AssuranceChatWindow, type ChatMessage } from './AssuranceChatWindow';

interface AssuranceHubClientProps {
  clientId: string;
  clientName: string;
  initialChatId?: string;
}

const SUB_TOOLS = [
  {
    key: 'Governance',
    label: 'Agentic AI & Governance',
    description: 'AI governance frameworks, algorithmic accountability, and automation controls',
    icon: Cpu,
    href: '/tools/governance',
    color: 'bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-200',
    iconColor: 'text-violet-600',
  },
  {
    key: 'CyberResiliance',
    label: 'Cyber Risk',
    description: 'Cybersecurity resilience, data protection, and IT controls',
    icon: Shield,
    href: '/tools/cyber-resilience',
    color: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100',
    iconColor: 'text-red-600',
  },
  {
    key: 'TalentRisk',
    label: 'Workforce & Talent Risk',
    description: 'HR controls, succession planning, and labour compliance',
    icon: Users,
    href: '/tools/talent-risk',
    color: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
    iconColor: 'text-amber-600',
  },
  {
    key: 'ESGSustainability',
    label: 'ESG & Sustainability',
    description: 'Environmental, social, and governance reporting frameworks',
    icon: Leaf,
    href: '/tools/esg-sustainability',
    color: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
    iconColor: 'text-emerald-600',
  },
  {
    key: 'Diversity',
    label: 'Meritocracy & Diversity',
    description: 'DEI assurance, pay equity, and inclusion metrics',
    icon: Scale,
    href: '/tools/diversity',
    color: 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100',
    iconColor: 'text-sky-600',
  },
];

export function AssuranceHubClient({ clientId, clientName, initialChatId }: AssuranceHubClientProps) {
  const router = useRouter();
  const [chatId, setChatId] = useState<string | null>(initialChatId || null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [recommendedTool, setRecommendedTool] = useState<string | null>(null);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const messageQueue = useRef<string[]>([]);
  const processingRef = useRef(false);
  const chatIdRef = useRef<string | null>(initialChatId || null);

  chatIdRef.current = chatId;

  const sendToApi = useCallback(async (message: string) => {
    const res = await fetch('/api/assurance/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, chatId: chatIdRef.current, message, mode: 'triage' }),
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to send message');
    }
    return res.json();
  }, [clientId]);

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    if (messageQueue.current.length === 0) {
      setIsLoading(false);
      return;
    }

    processingRef.current = true;
    setIsLoading(true);

    const queued = [...messageQueue.current];
    messageQueue.current = [];
    setQueuedMessages([]);

    const combined = queued.length === 1
      ? queued[0]
      : queued.map((msg, i) => `[${i + 1}] ${msg}`).join('\n\n');

    try {
      const data = await sendToApi(combined);
      setChatId(data.chatId);
      chatIdRef.current = data.chatId;

      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.message,
        metadata: data.metadata,
      };
      setMessages(prev => [...prev, assistantMsg]);

      if (data.metadata?.recommendedSubTool) {
        setRecommendedTool(data.metadata.recommendedSubTool);
      }
    } catch (err) {
      console.error('Chat error:', err);
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'I apologise, but I encountered an error processing your message. Please try again.',
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      processingRef.current = false;
      if (messageQueue.current.length > 0) {
        processQueue();
      } else {
        setIsLoading(false);
      }
    }
  }, [sendToApi]);

  const handleSendMessage = useCallback(async (message: string) => {
    // Show user message in chat immediately
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message,
    };
    setMessages(prev => [...prev, userMsg]);

    if (processingRef.current) {
      messageQueue.current.push(message);
      setQueuedMessages([...messageQueue.current]);
      return;
    }

    messageQueue.current.push(message);
    processQueue();
  }, [processQueue]);

  function handleSubToolClick(subToolKey: string) {
    const tool = SUB_TOOLS.find(t => t.key === subToolKey);
    if (tool) {
      const params = new URLSearchParams();
      if (chatId) params.set('chatId', chatId);
      params.set('clientId', clientId);
      router.push(`${tool.href}?${params.toString()}`);
    }
  }

  function handleBooking() {
    const subject = encodeURIComponent(`Assurance Discussion - ${clientName}`);
    const body = encodeURIComponent(
      `Dear Thanzil,\n\nI would like to arrange a meeting to discuss assurance requirements for ${clientName}.\n\nPlease let me know your availability during office hours.\n\nBest regards`
    );
    window.open(`mailto:thanzil.khan@acumon.com?subject=${subject}&body=${body}`, '_blank');
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="container mx-auto">
          <p className="text-sm font-medium text-blue-600 uppercase tracking-wide">Assurance</p>
          <h1 className="text-2xl font-bold text-slate-900">Internal Audit & Assurance Hub</h1>
          <p className="text-sm text-slate-500 mt-1">
            {clientName} &mdash; Select a service area or chat with our AI advisor
          </p>
        </div>
      </div>

      <div className="container mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Chat Window - 3 columns */}
          <div className="lg:col-span-3">
            <AssuranceChatWindow
              chatId={chatId}
              clientId={clientId}
              messages={messages}
              onSendMessage={handleSendMessage}
              onSubToolRecommended={handleSubToolClick}
              onBookingRequested={handleBooking}
              isLoading={isLoading}
              queuedMessages={queuedMessages}
              className="h-[600px]"
            />
          </div>

          {/* Sub-tool Buttons - 2 columns */}
          <div className="lg:col-span-2 flex flex-col">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Assurance Services
            </h3>
            <div className="grid grid-cols-1 gap-3 auto-rows-fr">
              {SUB_TOOLS.map((tool) => {
                const Icon = tool.icon;
                const isRecommended = recommendedTool === tool.key;
                return (
                  <button
                    key={tool.key}
                    onClick={() => handleSubToolClick(tool.key)}
                    className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left ${tool.color} ${
                      isRecommended ? 'ring-2 ring-blue-500 ring-offset-2 scale-[1.02]' : ''
                    }`}
                  >
                    <div className={`flex-shrink-0 p-2.5 rounded-lg bg-white/80 ${tool.iconColor}`}>
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm">{tool.label}</p>
                        {isRecommended && (
                          <span className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-bold rounded-full uppercase">
                            Recommended
                          </span>
                        )}
                      </div>
                      <p className="text-xs mt-1 opacity-75 line-clamp-2">{tool.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
