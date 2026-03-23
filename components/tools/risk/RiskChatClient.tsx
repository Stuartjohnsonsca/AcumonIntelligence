'use client';

import { useState, useCallback } from 'react';
import { Shield, Bot, UserCheck, Code } from 'lucide-react';
import { RiskChatWindow, type RiskChatMessage } from './RiskChatWindow';

interface RiskChatClientProps {
  clientId: string;
  clientName: string;
  initialChatId?: string;
}

const COMMITMENT_TYPES = [
  {
    key: 'user_activity',
    label: 'User Activity',
    description: 'You do the risk work with our detailed guidance, documents, and work programmes',
    icon: UserCheck,
    color: 'bg-blue-50 text-blue-700 border-blue-200',
    iconColor: 'text-blue-600',
  },
  {
    key: 'system_work',
    label: 'AI System Work',
    description: 'Our AI agent reviews documents, analyses procedures, and identifies control weaknesses',
    icon: Bot,
    color: 'bg-violet-50 text-violet-700 border-violet-200',
    iconColor: 'text-violet-600',
  },
  {
    key: 'auditor_work',
    label: 'Professional Auditor',
    description: 'An Acumon professional forms opinions, conducts interviews, and provides formal assurance',
    icon: Shield,
    color: 'bg-amber-50 text-amber-700 border-amber-200',
    iconColor: 'text-amber-600',
  },
  {
    key: 'software_dev',
    label: 'Software Development',
    description: 'We develop custom software to manage risk: dashboards, monitoring, and compliance tracking',
    icon: Code,
    color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    iconColor: 'text-emerald-600',
  },
];

export function RiskChatClient({ clientId, clientName, initialChatId }: RiskChatClientProps) {
  const [chatId, setChatId] = useState<string | null>(initialChatId || null);
  const [messages, setMessages] = useState<RiskChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [planAccepted, setPlanAccepted] = useState(false);

  const handleSendMessage = useCallback(async (message: string) => {
    setIsLoading(true);

    const userMsg: RiskChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message,
    };
    setMessages(prev => [...prev, userMsg]);

    try {
      const res = await fetch('/api/risk/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, chatId, message }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to send message');
      }

      const data = await res.json();
      setChatId(data.chatId);

      const assistantMsg: RiskChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.message,
        metadata: data.metadata,
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      console.error('Risk chat error:', err);
      const errorMsg: RiskChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'I apologise, but I encountered an error processing your message. Please try again.',
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [clientId, chatId]);

  async function handleAcceptPlan() {
    if (!chatId) return;
    try {
      await fetch('/api/risk/chat', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, action: 'accept' }),
      });
      setPlanAccepted(true);
    } catch (err) {
      console.error('Failed to accept plan:', err);
    }
  }

  async function handleRejectPlan() {
    if (!chatId) return;
    try {
      await fetch('/api/risk/chat', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, action: 'reject' }),
      });
      // Add a system message prompting re-discussion
      const reviseMsg: RiskChatMessage = {
        id: `system-${Date.now()}`,
        role: 'assistant',
        content: 'No problem — let me know what you would like to change about the action plan, and I will revise it for you.',
      };
      setMessages(prev => [...prev, reviseMsg]);
    } catch (err) {
      console.error('Failed to reject plan:', err);
    }
  }

  function handleBooking() {
    const subject = encodeURIComponent(`Risk Advisory Discussion - ${clientName}`);
    const body = encodeURIComponent(
      `Dear Thanzil,\n\nI would like to arrange a meeting to discuss risk management requirements for ${clientName}.\n\nPlease let me know your availability during office hours.\n\nBest regards`
    );
    window.open(`mailto:thanzil.khan@acumon.com?subject=${subject}&body=${body}`, '_blank');
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-slate-50 to-indigo-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="container mx-auto">
          <p className="text-sm font-medium text-indigo-600 uppercase tracking-wide">Internal Audit</p>
          <h1 className="text-2xl font-bold text-slate-900">Risk Advisory — Lyra</h1>
          <p className="text-sm text-slate-500 mt-1">
            {clientName} &mdash; AI-powered risk advisory and action planning
          </p>
        </div>
      </div>

      <div className="container mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Chat Window - 3 columns */}
          <div className="lg:col-span-3">
            <RiskChatWindow
              chatId={chatId}
              messages={messages}
              onSendMessage={handleSendMessage}
              onBookingRequested={handleBooking}
              onAcceptPlan={handleAcceptPlan}
              onRejectPlan={handleRejectPlan}
              isLoading={isLoading}
              className="h-[700px]"
            />

            {planAccepted && (
              <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
                <p className="text-sm font-semibold text-emerald-800">Action plan accepted</p>
                <p className="text-xs text-emerald-600 mt-1">
                  Your action plan has been saved. You will receive updates as tasks progress.
                </p>
              </div>
            )}
          </div>

          {/* Service Types - 2 columns */}
          <div className="lg:col-span-2 space-y-3">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
              How Lyra Can Help
            </h3>
            {COMMITMENT_TYPES.map((type) => {
              const Icon = type.icon;
              return (
                <div
                  key={type.key}
                  className={`flex items-start gap-4 p-4 rounded-xl border-2 ${type.color}`}
                >
                  <div className={`flex-shrink-0 p-2 rounded-lg bg-white/80 ${type.iconColor}`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{type.label}</p>
                    <p className="text-xs mt-1 opacity-75">{type.description}</p>
                  </div>
                </div>
              );
            })}

            <div className="mt-6 p-4 bg-slate-50 rounded-xl border border-slate-200">
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">About Lyra</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Lyra is your AI risk advisor. Describe your risk concerns and Lyra will guide you
                through a structured conversation to produce a comprehensive action plan with clear
                tasks, responsibilities, and deadlines.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
