'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Calendar, ArrowLeft, Bot, User } from 'lucide-react';
import Link from 'next/link';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  serviceType: 'accounting' | 'consulting' | 'tax' | 'technology';
  title: string;
  description: string;
  token: string;
}

const SERVICE_PROMPTS: Record<string, string> = {
  accounting: 'You are a helpful accounting support assistant for an audit firm\'s client portal. Help clients with bookkeeping queries, financial reporting questions, chart of accounts, VAT/GST, payroll, and general accounting matters. Be professional and concise. If the query needs specialist attention, suggest booking a meeting.',
  consulting: 'You are a business consulting support assistant for an audit firm\'s client portal. Help clients with business strategy, operational efficiency, risk management, growth planning, and business improvement queries. Be professional and concise. If the query needs specialist attention, suggest booking a meeting.',
  tax: 'You are a tax support assistant for an audit firm\'s client portal. Help clients with tax planning queries, compliance questions, corporation tax, personal tax, VAT, capital gains, inheritance tax, and general tax matters. Be professional and concise. Always remind clients that specific tax advice requires a qualified tax adviser and suggest booking a meeting for detailed matters.',
  technology: 'You are a technology support assistant for an audit firm\'s client portal. Help clients with IT systems, software selection, digital transformation, cybersecurity, cloud migration, data management, and technology infrastructure queries. Be professional and concise. If the query needs specialist attention, suggest booking a meeting.',
};

export function ServiceChatBot({ serviceType, title, description, token }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showBooking, setShowBooking] = useState(false);
  const [bookingName, setBookingName] = useState('');
  const [bookingEmail, setBookingEmail] = useState('');
  const [bookingMessage, setBookingMessage] = useState('');
  const [bookingPreferredDate, setBookingPreferredDate] = useState('');
  const [bookingSent, setBookingSent] = useState(false);
  const [bookingSending, setBookingSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || loading) return;
    const userMsg: Message = { id: `u_${Date.now()}`, role: 'user', content: input.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/portal/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          serviceType,
          systemPrompt: SERVICE_PROMPTS[serviceType],
          messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(prev => [...prev, { id: `a_${Date.now()}`, role: 'assistant', content: data.response }]);
      } else {
        setMessages(prev => [...prev, { id: `a_${Date.now()}`, role: 'assistant', content: 'Sorry, I wasn\'t able to process your request. Please try again or book a meeting with a specialist.' }]);
      }
    } catch {
      setMessages(prev => [...prev, { id: `a_${Date.now()}`, role: 'assistant', content: 'Connection error. Please try again.' }]);
    }
    setLoading(false);
  }

  async function handleBookMeeting() {
    if (!bookingEmail || !bookingName) return;
    setBookingSending(true);
    try {
      await fetch('/api/portal/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          action: 'book_meeting',
          serviceType,
          name: bookingName,
          email: bookingEmail,
          message: bookingMessage,
          preferredDate: bookingPreferredDate,
          chatSummary: messages.map(m => `${m.role}: ${m.content}`).join('\n'),
        }),
      });
      setBookingSent(true);
    } catch {}
    setBookingSending(false);
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Link href={`/portal/dashboard?token=${token}`} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> Home
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-900">{title}</h1>
            <p className="text-xs text-slate-500">{description}</p>
          </div>
        </div>
        <button
          onClick={() => setShowBooking(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Calendar className="h-4 w-4" />
          Book a Meeting
        </button>
      </div>

      {/* Chat area */}
      <div className="bg-white rounded-xl border border-slate-200 flex flex-col" style={{ height: '60vh' }}>
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <Bot className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-500">Ask me anything about {serviceType}.</p>
              <p className="text-xs text-slate-400 mt-1">I&apos;ll help identify solutions and can arrange a meeting with a specialist if needed.</p>
            </div>
          )}
          {messages.map(msg => (
            <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <Bot className="h-4 w-4 text-blue-600" />
                </div>
              )}
              <div className={`max-w-[75%] px-4 py-2.5 rounded-xl text-sm ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-slate-100 text-slate-800 rounded-bl-sm'
              }`}>
                {msg.content}
              </div>
              {msg.role === 'user' && (
                <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                  <User className="h-4 w-4 text-slate-600" />
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex gap-2">
              <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center">
                <Bot className="h-4 w-4 text-blue-600" />
              </div>
              <div className="bg-slate-100 px-4 py-3 rounded-xl rounded-bl-sm">
                <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-slate-200 p-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder={`Ask about ${serviceType}...`}
              className="flex-1 px-4 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Book a Meeting Modal */}
      {showBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-5">
            <h3 className="text-base font-semibold text-slate-900 mb-4">
              {bookingSent ? 'Meeting Request Sent' : `Book a ${title} Meeting`}
            </h3>

            {bookingSent ? (
              <div className="text-center py-4">
                <Calendar className="h-10 w-10 text-green-500 mx-auto mb-3" />
                <p className="text-sm text-green-700">Your meeting request has been sent. A specialist will be in touch shortly.</p>
                <button onClick={() => { setShowBooking(false); setBookingSent(false); }} className="mt-4 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  Close
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Your Name *</label>
                  <input type="text" value={bookingName} onChange={e => setBookingName(e.target.value)} className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Email *</label>
                  <input type="email" value={bookingEmail} onChange={e => setBookingEmail(e.target.value)} className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Preferred Date</label>
                  <input type="date" value={bookingPreferredDate} onChange={e => setBookingPreferredDate(e.target.value)} className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Message</label>
                  <textarea value={bookingMessage} onChange={e => setBookingMessage(e.target.value)} rows={3} placeholder="Brief description of what you'd like to discuss..." className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none" />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => setShowBooking(false)} className="px-4 py-2 text-xs text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200">Cancel</button>
                  <button onClick={handleBookMeeting} disabled={bookingSending || !bookingName || !bookingEmail} className="px-4 py-2 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40">
                    {bookingSending ? <Loader2 className="h-3 w-3 animate-spin inline mr-1" /> : null}
                    Send Request
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
