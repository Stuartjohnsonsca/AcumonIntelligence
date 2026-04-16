'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Persona {
  id: string;
  name: string;
  role: string;
  dept: string;
  m365Summary: string;
  color: string;
  initial: string;
}

interface ScenarioPhase {
  label: string;
  text: string;
}

interface Scenario {
  id: string;
  title: string;
  icon: string;
  description: string;
  severity: string;
  basePhases: ScenarioPhase[];
  curveballs: string[];
}

interface SimMessage {
  id: string;
  type: 'phase' | 'curveball' | 'message';
  personaId?: string;
  text: string;
  label?: string;
  time?: string;
}

interface DebriefData {
  overallRating: 'RED' | 'AMBER' | 'GREEN';
  ratingRationale: string;
  executiveSummary: string;
  planDeficiencies: { title: string; whatHappened: string; impact: string }[];
  humanBehaviourInsights: { person: string; behaviourObserved: string; underPressurePattern: string; trainingRecommendation: string }[];
  curveballResponses: { curveball: string; howHandled: string; gap: string }[];
  protocolAdherence: string;
  boardReassurance: string[];
  immediateActions: { priority: 'HIGH' | 'MEDIUM'; action: string; owner: string }[];
}

interface Props {
  user: { name?: string | null; email?: string | null };
}

// ── Data ──────────────────────────────────────────────────────────────────────

const DEFAULT_PERSONAS: Persona[] = [
  {
    id: 'sarah', name: 'Sarah Chen', role: 'CEO', dept: 'Executive',
    m365Summary: 'High message volume. Writes in short bursts. Rarely uses punctuation in Teams. Delegates heavily but follows up obsessively. Uses voice notes when stressed. Has a habit of going quiet when overwhelmed then overcorrecting. Close personal relationship with ops lead. Tends to text informally before sending formal emails. When scared, asks questions rather than gives direction.',
    color: '#E8C547', initial: 'SC',
  },
  {
    id: 'marcus', name: 'Marcus Webb', role: 'CTO', dept: 'Technology',
    m365Summary: 'Responds within 90 seconds at all hours. Extremely terse in messages — often single words or emojis. Has a dark sense of humour under pressure. Loyal to his team to a fault. When something goes wrong technically he becomes hyperactive and starts working before briefing anyone. Often forgets to update leadership for hours. Swears in private channels. Has a tendency to fixate on the wrong problem first.',
    color: '#6EC8E8', initial: 'MW',
  },
  {
    id: 'diana', name: 'Diana Okafor', role: 'CFO', dept: 'Finance',
    m365Summary: 'Measured, thoughtful communicator. Long considered messages. Often edits emails multiple times before sending. Gets very quiet and focused under pressure — colleagues find this unnerving. Strong moral compass. Has two young children and when crises hit outside school hours her messages show visible conflict. Asks clarifying questions, rarely panics, but can freeze on decisions that feel irreversible.',
    color: '#9EE87A', initial: 'DO',
  },
  {
    id: 'tom', name: 'Tom Bassett', role: 'HR Director', dept: 'People',
    m365Summary: 'Highest Teams message volume in the org. Knows everyone by name including their families. Uses humour to defuse tension — sometimes inappropriately. Will immediately check on specific individuals he is worried about before worrying about process. Loyal to people over policy. His panic is visible in typos and broken sentences. Rumour travels through him even when he does not intend it.',
    color: '#E87A9E', initial: 'TB',
  },
  {
    id: 'priya', name: 'Priya Nair', role: 'Operations Manager', dept: 'Operations',
    m365Summary: 'Extremely calm in messages — short, clear, decisive. Has dealt with crises before at a previous firm. Occasionally comes across as cold when she is being efficient. Will not speculate — only states what she knows. Can clash with people who are venting rather than problem-solving. Has a slight tendency to work around rather than through people she finds inefficient. Respects protocol but adapts it fast when it is clearly not working.',
    color: '#B87AE8', initial: 'PN',
  },
  {
    id: 'james', name: 'James Forsythe', role: 'General Counsel', dept: 'Legal',
    m365Summary: 'Writes very long emails. Deeply uncomfortable with uncertainty. Asks for things in writing constantly. Under genuine crisis pressure, actually becomes more decisive — the clarity of emergency suits him. Has a tendency to assume the worst case immediately and then work backwards. Close with the CEO — they have a direct line. Worries about personal liability as much as the firm. Becomes very protective of information flow when legal exposure is on the table.',
    color: '#E8A06E', initial: 'JF',
  },
];

const SCENARIOS: Scenario[] = [
  {
    id: 'fire', title: 'Office Fire', icon: '🔥', severity: 'CRITICAL',
    description: 'Fire alarm triggered in your 6-floor HQ at 2:17pm on a Tuesday. 200 staff present. Initial assumption: false alarm.',
    basePhases: [
      { label: 'T+0 min', text: 'Fire alarm sounds across the building. It is the third false alarm this month.' },
      { label: 'T+4 min', text: 'Smoke confirmed on floor 3. Evacuation is underway but patchy — some staff have not moved.' },
      { label: 'T+12 min', text: 'Fire brigade on scene. Roll call at assembly point: 4 people unaccounted for.' },
      { label: 'T+45 min', text: 'Building declared unsafe for 48 hours. No injuries confirmed but one person taken to hospital as a precaution.' },
    ],
    curveballs: [
      'A staff member has posted a photo of flames from inside the building — it is already being shared widely.',
      'One of the unaccounted persons is a client who was in a meeting on floor 3.',
      'The server room is on floor 3 — IT are asking if they can re-enter to retrieve backup drives.',
      'A journalist is at the assembly point asking questions. Two staff members are talking to them.',
      'Facilities confirms the last fire drill was 14 months ago, not the 6 months stated in the compliance report.',
    ],
  },
  {
    id: 'breach', title: 'IT Security Breach', icon: '🔓', severity: 'CRITICAL',
    description: 'SOC alert at 11:43pm Friday: ransomware detected, spreading across the network. On-call engineer escalates immediately.',
    basePhases: [
      { label: 'T+0', text: 'Alert fired. On-call engineer has isolated 3 servers but the malware is still spreading.' },
      { label: 'T+1hr', text: '60% of file systems encrypted. Email server is down. Staff are communicating on personal phones.' },
      { label: 'T+3hr', text: 'Scope confirmed: customer database accessed. Volume and nature of data exfiltrated is unknown.' },
      { label: 'T+8hr', text: 'Ransom note received demanding significant payment in 72 hours. External IR firm engaged, arriving in 4 hours.' },
    ],
    curveballs: [
      'Reports on a finance forum: someone is offering what appears to be your customer data for sale. Screenshots are circulating.',
      'Three customers have called the main line saying their bank accounts show suspicious transactions since last night.',
      'A team member has recognised the attack signature — it matches a breach at their previous employer two years ago.',
      'The attacker has emailed the CEO directly from an internal email address, which should be impossible.',
      'A journalist from a technology publication has emailed asking for comment on the breach. It is 6am Saturday.',
      'Your cyber insurance broker has indicated the policy may be void as encryption keys were not rotated — a step IT skipped last quarter.',
    ],
  },
  {
    id: 'fraud', title: 'Internal Fraud Discovery', icon: '💸', severity: 'HIGH',
    description: 'Saturday morning: auditors flag significant funds moved to unknown accounts over 8 months. The employee is at their desk Monday.',
    basePhases: [
      { label: 'Hour 0', text: 'CFO receives the audit flag. The suspected employee — a trusted 7-year senior — is due in at 9am.' },
      { label: 'Hour 2', text: 'Forensic review confirms it is deliberate. Police advised. The employee is in a meeting with the CEO right now, unaware.' },
      { label: 'Hour 4', text: 'Employee suspended and escorted out. 40 colleagues witnessed it. Rumours have started spreading.' },
      { label: 'Hour 8', text: 'Board called for emergency session. Press have picked up a Companies House filing anomaly.' },
    ],
    curveballs: [
      'The suspended employee has posted on LinkedIn claiming unfair dismissal — it has significant engagement within the hour.',
      'A second anomaly found — different account, different period. Possibly two people involved.',
      'The employee was the main relationship contact for your two largest clients. Both are calling asking for reassurance.',
      'It emerges the employee had flagged a personal financial crisis to HR six months ago. Nothing was done.',
      'The employee\'s manager says they knew something felt wrong but did not feel they could raise it.',
    ],
  },
  {
    id: 'health', title: 'Leadership Health Crisis', icon: '🏥', severity: 'HIGH',
    description: 'The CEO collapses during a board presentation. Ambulance called. No succession plan has been formally activated.',
    basePhases: [
      { label: 'Immediate', text: 'CEO collapses mid-sentence in the boardroom. Ambulance is en route. 12 people are in the room.' },
      { label: '30 mins', text: 'CEO taken to hospital. Status unknown. Board members are on their phones. Staff are asking questions.' },
      { label: '2 hours', text: 'CEO in surgery. Likely to be out of action for weeks. No deputy CEO has been formally designated.' },
      { label: 'Next morning', text: 'CEO stable but incapacitated. Major client announcement due this week. Market observers are watching.' },
    ],
    curveballs: [
      'Someone in the boardroom has posted a personal message on social media. It is spreading before any official statement is out.',
      'The CEO\'s personal assistant is refusing to hand over calendar access without explicit authorisation.',
      'A competitor has approached two of your senior leaders directly in the last hour.',
      'The CEO\'s family have requested that no medical information be shared with the firm.',
      'A major contract renewal is due Friday — only the CEO had the client relationship.',
    ],
  },
];

const RATING_COLORS = { RED: '#C84040', AMBER: '#E8A040', GREEN: '#6EC860' };
const PRIORITY_COLORS = { HIGH: '#C84040', MEDIUM: '#E8A040' };

// ── Sub-components ────────────────────────────────────────────────────────────

function TypingIndicator({ persona }: { persona: Persona }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
        style={{ background: '#111', border: `1.5px solid ${persona.color}`, color: persona.color, boxShadow: `0 0 6px ${persona.color}44` }}
      >
        {persona.initial}
      </div>
      <div className="flex gap-1 px-3 py-2 rounded-tr-xl rounded-br-xl rounded-bl-xl" style={{ background: '#0A0A0A', border: `1px solid ${persona.color}18` }}>
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: persona.color, animation: `rfBounce 1s ease-in-out ${i * 0.15}s infinite` }}
          />
        ))}
      </div>
    </div>
  );
}

function TypingIndicators({ personas }: { personas: Persona[] }) {
  if (personas.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {personas.map(p => <TypingIndicator key={p.id} persona={p} />)}
    </div>
  );
}

function SimMessageRow({ msg, personas }: { msg: SimMessage; personas: Persona[] }) {
  if (msg.type === 'phase') return (
    <div className="flex items-center gap-3 py-4">
      <div className="flex-1 h-px" style={{ background: '#1A1A1A' }} />
      <div className="px-4 py-1 rounded-full text-xs font-mono tracking-wider" style={{ background: '#0D0808', border: '1px solid #C8404066', color: '#C84040' }}>
        {msg.label} — {msg.text}
      </div>
      <div className="flex-1 h-px" style={{ background: '#1A1A1A' }} />
    </div>
  );

  if (msg.type === 'curveball') return (
    <div className="my-2 p-3 rounded-lg" style={{ background: '#0D0A08', border: '1px solid #E8A04066', borderLeft: '3px solid #E8A040' }}>
      <div className="text-xs font-mono tracking-widest mb-1" style={{ color: '#E8A040' }}>⚡ DEVELOPING SITUATION</div>
      <div className="text-sm leading-relaxed" style={{ color: '#C8B090', fontFamily: 'Georgia, serif' }}>{msg.text}</div>
    </div>
  );

  const persona = personas.find(p => p.id === msg.personaId);
  if (!persona) return null;

  return (
    <div className="flex gap-3 items-start">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
        style={{ background: '#111', border: `1.5px solid ${persona.color}`, color: persona.color, boxShadow: `0 0 6px ${persona.color}33` }}
      >
        {persona.initial}
      </div>
      <div className="flex-1">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-xs font-bold font-mono" style={{ color: persona.color }}>{persona.name}</span>
          <span className="text-xs font-mono" style={{ color: '#2E2E2E' }}>{persona.role}</span>
          <span className="text-xs font-mono ml-auto" style={{ color: '#1E1E1E' }}>{msg.time}</span>
        </div>
        <div className="text-sm leading-relaxed px-3 py-2 rounded-tr-xl rounded-br-xl rounded-bl-xl" style={{ background: '#0A0A0A', border: `1px solid ${persona.color}15`, color: '#BEBEB6', fontFamily: 'Georgia, serif' }}>
          {msg.text}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function RiskForumClient({ user }: Props) {
  const [view, setView] = useState<'setup' | 'sim' | 'debrief'>('setup');
  const [personas, setPersonas] = useState<Persona[]>(DEFAULT_PERSONAS);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [customScenario, setCustomScenario] = useState('');
  const [protocol, setProtocol] = useState('');
  const [useProtocol, setUseProtocol] = useState(false);
  const [messages, setMessages] = useState<SimMessage[]>([]);
  const [typingPersonas, setTypingPersonas] = useState<Persona[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentPhaseIdx, setCurrentPhaseIdx] = useState(0);
  const [debrief, setDebrief] = useState<DebriefData | null>(null);
  const [debriefLoading, setDebriefLoading] = useState(false);
  const [editingPersonaId, setEditingPersonaId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);
  const historyRef = useRef<SimMessage[]>([]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, typingPersonas]);

  const getTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const activeScenario: Scenario | null = selectedScenarioId
    ? SCENARIOS.find(s => s.id === selectedScenarioId) ?? null
    : customScenario.trim()
    ? {
        id: 'custom', title: 'Custom Scenario', icon: '⚡', severity: 'HIGH',
        description: customScenario,
        basePhases: [
          { label: 'T+0', text: 'Situation first reported. Scope unknown.' },
          { label: 'T+30min', text: 'Initial response underway. More information emerging.' },
          { label: 'T+2hr', text: 'Situation escalating. Decisions required.' },
          { label: 'T+6hr', text: 'Critical juncture — full response now active.' },
        ],
        curveballs: [
          'A staff member has shared details externally before an official position is agreed.',
          'A key stakeholder is calling and will not accept a holding response.',
          'A second related problem has emerged that may be connected to the first.',
          'Someone senior has gone off-script in a way that contradicts the agreed response.',
        ],
      }
    : null;

  const addMessage = useCallback((msg: SimMessage) => {
    historyRef.current = [...historyRef.current, msg];
    setMessages(prev => [...prev, msg]);
  }, []);

  const callPersonaAPI = async (persona: Persona, phaseText: string, curveball: string | null) => {
    // Use live history so each speaker sees what previous speakers said
    const conversationHistory = historyRef.current
      .filter(m => m.type === 'message')
      .slice(-14)
      .map(m => {
        const p = personas.find(a => a.id === m.personaId);
        return { name: p?.name ?? '', role: p?.role ?? '', text: m.text };
      });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch('/api/risk-forum/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          persona: { name: persona.name, role: persona.role, m365Summary: persona.m365Summary },
          conversationHistory,
          scenario: { description: activeScenario?.description },
          phaseText,
          curveball,
          protocol,
          useProtocol,
        }),
      });

      clearTimeout(timeout);
      if (!res.ok) {
        console.error(`Risk Forum API error for ${persona.name}: ${res.status}`);
        return `[${persona.name} is unavailable — API error ${res.status}]`;
      }
      const data = await res.json();
      const text = data.text?.trim();
      if (!text || text === '...' || text === '[No response]') {
        return `[${persona.name} didn't respond]`;
      }
      return text;
    } catch (err) {
      clearTimeout(timeout);
      console.error(`Risk Forum fetch error for ${persona.name}:`, err);
      return `[${persona.name} timed out]`;
    }
  };

  const runDebrief = async () => {
    setDebriefLoading(true);
    const transcript = historyRef.current
      .filter(m => m.type === 'message')
      .map(m => {
        const p = personas.find(a => a.id === m.personaId);
        return `${p?.name} (${p?.role}): ${m.text}`;
      }).join('\n');

    const curveballs = historyRef.current
      .filter(m => m.type === 'curveball')
      .map(m => m.text).join('\n');

    const res = await fetch('/api/risk-forum/debrief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, curveballs, scenario: activeScenario, protocol, useProtocol }),
    });

    if (res.ok) {
      const data = await res.json();
      setDebrief(data.debrief);
    }
    setDebriefLoading(false);
  };

  const runSimulation = async () => {
    if (!activeScenario) return;
    abortRef.current = false;
    historyRef.current = [];
    setIsRunning(true);
    setMessages([]);
    setCurrentPhaseIdx(0);
    setDebrief(null);
    setView('sim');

    const phases = activeScenario.basePhases;
    const curveballs = [...activeScenario.curveballs].sort(() => Math.random() - 0.5);
    let curveballIdx = 0;

    for (let phaseIdx = 0; phaseIdx < phases.length; phaseIdx++) {
      if (abortRef.current) break;
      const phase = phases[phaseIdx];

      addMessage({ id: `phase-${phaseIdx}`, type: 'phase', label: phase.label, text: phase.text });
      setCurrentPhaseIdx(phaseIdx);

      let curveball: string | null = null;
      if (phaseIdx > 0 && Math.random() > 0.3 && curveballIdx < curveballs.length) {
        curveball = curveballs[curveballIdx++];
        if (!abortRef.current) {
          addMessage({ id: `cb-${phaseIdx}`, type: 'curveball', text: curveball });
        }
      }

      // Pick speakers — more voices in first phase, varies after
      const count = phaseIdx === 0 ? 5 : 3 + Math.floor(Math.random() * 2);
      const speakers = [...personas].sort(() => Math.random() - 0.5).slice(0, count);

      // Sequential: each speaker sees what all previous speakers said
      for (const persona of speakers) {
        if (abortRef.current) break;

        // Show this person typing — the API response time IS the typing delay
        setTypingPersonas([persona]);

        const text = await callPersonaAPI(persona, phase.text, curveball);
        if (abortRef.current) break;

        setTypingPersonas([]);

        addMessage({
          id: `${persona.id}-${Date.now()}`,
          type: 'message',
          personaId: persona.id,
          text: text ?? `[${persona.name} — no response]`,
          time: getTime(),
        });
      }

      setTypingPersonas([]);
    }

    setTypingPersonas([]);
    setIsRunning(false);

    if (!abortRef.current) {
      await runDebrief();
      setView('debrief');
    }
  };

  const editingPersona = personas.find(p => p.id === editingPersonaId);

  // ── SETUP VIEW ───────────────────────────────────────────────────────────────
  if (view === 'setup') return (
    <div className="min-h-screen flex flex-col" style={{ background: '#080808', color: '#C8C8C0' }}>
      <style>{`
        @keyframes rfBounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-5px)} }
        @keyframes rfPulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes rfSlide { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes rfFade { from{opacity:0} to{opacity:1} }
        @keyframes rfFlash { 0%{opacity:0;transform:scaleY(0.8)} 100%{opacity:1;transform:scaleY(1)} }
      `}</style>

      {/* Header */}
      <div className="px-8 pt-6 pb-5 border-b" style={{ borderColor: '#111' }}>
        <div className="text-xs tracking-widest mb-1 font-mono" style={{ color: '#2A2A2A' }}>RISK INTELLIGENCE</div>
        <div className="flex items-baseline gap-4">
          <h1 className="text-2xl font-normal" style={{ fontFamily: 'Georgia, serif', color: '#E8E8E0', letterSpacing: '0.03em' }}>
            Risk Forum
          </h1>
          <span className="text-xs font-mono tracking-wider" style={{ color: '#C84040' }}>BEHAVIOURAL SIMULATION</span>
        </div>
        <p className="mt-2 text-xs leading-relaxed max-w-xl" style={{ color: '#444' }}>
          Simulate how your people actually behave under crisis — not how they should. Profiles are derived from observed communication patterns.
        </p>
      </div>

      <div className="grid flex-1 overflow-hidden" style={{ gridTemplateColumns: '1.1fr 0.9fr' }}>

        {/* Left: Scenario + Protocol */}
        <div className="p-6 overflow-y-auto border-r" style={{ borderColor: '#111' }}>
          <div className="text-xs font-mono tracking-widest mb-3" style={{ color: '#333' }}>SELECT SCENARIO</div>

          <div className="grid grid-cols-2 gap-2 mb-4">
            {SCENARIOS.map(s => (
              <div
                key={s.id}
                onClick={() => { setSelectedScenarioId(s.id); setCustomScenario(''); }}
                className="p-3 rounded-lg cursor-pointer transition-all"
                style={{
                  background: selectedScenarioId === s.id ? '#0E0A0A' : '#0A0A0A',
                  border: `1px solid ${selectedScenarioId === s.id ? '#C84040' : '#1A1A1A'}`,
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-base">{s.icon}</span>
                  <span className="text-xs font-bold" style={{ color: '#E0E0D8' }}>{s.title}</span>
                  <span className="ml-auto text-xs px-1.5 py-0.5 rounded font-mono" style={{
                    background: s.severity === 'CRITICAL' ? '#1A0808' : '#0F0A08',
                    border: `1px solid ${s.severity === 'CRITICAL' ? '#C8404055' : '#C8804055'}`,
                    color: s.severity === 'CRITICAL' ? '#C84040' : '#C88040',
                    fontSize: '9px',
                  }}>{s.severity}</span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: '#555' }}>{s.description.substring(0, 75)}...</p>
                <p className="text-xs mt-1 font-mono" style={{ color: '#2A2A2A' }}>{s.curveballs.length} curveballs</p>
              </div>
            ))}
          </div>

          <textarea
            value={customScenario}
            onChange={e => { setCustomScenario(e.target.value); setSelectedScenarioId(null); }}
            placeholder="Or describe your own scenario..."
            className="w-full h-16 rounded p-3 text-xs resize-none leading-relaxed mb-5"
            style={{ background: '#0A0A0A', border: '1px solid #1A1A1A', color: '#C8C8C0', fontFamily: 'Georgia, serif' }}
          />

          {/* Protocol toggle */}
          <div className="mb-5">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-mono tracking-widest" style={{ color: '#333' }}>ORGANISATION PROTOCOL</span>
              <button
                onClick={() => setUseProtocol(!useProtocol)}
                className="relative rounded-full transition-all"
                style={{ width: 36, height: 18, background: useProtocol ? '#C84040' : '#1A1A1A', border: '1px solid #2A2A2A' }}
              >
                <div
                  className="absolute rounded-full transition-all"
                  style={{ width: 12, height: 12, top: 2, left: useProtocol ? 20 : 2, background: '#E8E8E0' }}
                />
              </button>
              <span className="text-xs font-mono" style={{ color: useProtocol ? '#C84040' : '#333' }}>
                {useProtocol ? 'Active' : 'Off'}
              </span>
            </div>
            {useProtocol && (
              <textarea
                value={protocol}
                onChange={e => setProtocol(e.target.value)}
                placeholder="Paste your incident response protocol or BCP here. Agents are aware of it but will follow it based on their personality — not perfectly."
                className="w-full h-24 rounded p-3 text-xs resize-none leading-relaxed"
                style={{ background: '#0A0A0A', border: '1px solid #C8404033', color: '#C8C8C0', fontFamily: 'Georgia, serif' }}
              />
            )}
          </div>

          <button
            onClick={runSimulation}
            disabled={!activeScenario}
            className="w-full py-3 rounded font-bold text-xs tracking-widest uppercase transition-all"
            style={{
              background: activeScenario ? '#C84040' : '#111',
              border: 'none',
              color: activeScenario ? '#FFF' : '#2E2E2E',
            }}
          >
            ▶ Run Simulation
          </button>
        </div>

        {/* Right: Personas */}
        <div className="p-6 overflow-y-auto">
          <div className="flex justify-between items-center mb-4">
            <span className="text-xs font-mono tracking-widest" style={{ color: '#333' }}>PARTICIPANTS</span>
            <span className="text-xs font-mono" style={{ color: '#2A2A2A' }}>Click to edit profile</span>
          </div>
          <div className="flex flex-col gap-2">
            {personas.map(p => (
              <div
                key={p.id}
                onClick={() => setEditingPersonaId(p.id)}
                className="p-3 rounded-lg cursor-pointer"
                style={{ background: '#0C0C0C', border: '1px solid #1A1A1A', borderLeft: `3px solid ${p.color}` }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 font-mono"
                    style={{ background: '#111', border: `2px solid ${p.color}`, color: p.color, boxShadow: `0 0 6px ${p.color}33` }}
                  >{p.initial}</div>
                  <div>
                    <div className="text-xs font-bold" style={{ color: '#E8E8E0' }}>{p.name}</div>
                    <div className="text-xs font-mono" style={{ color: p.color, fontSize: '10px' }}>{p.role} · {p.dept}</div>
                  </div>
                </div>
                <p className="text-xs leading-relaxed line-clamp-2" style={{ color: '#555', fontFamily: 'Georgia, serif' }}>
                  {p.m365Summary}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Edit modal */}
      {editingPersona && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: '#000000DD' }}
          onClick={() => setEditingPersonaId(null)}
        >
          <div
            className="rounded-lg p-6 w-full max-w-lg"
            style={{ background: '#0D0D0D', border: '1px solid #2A2A2A', borderLeft: `3px solid ${editingPersona.color}` }}
            onClick={e => e.stopPropagation()}
          >
            <div className="text-sm font-bold mb-1" style={{ color: '#E8E8E0' }}>{editingPersona.name}</div>
            <div className="text-xs font-mono mb-4" style={{ color: editingPersona.color }}>{editingPersona.role} · {editingPersona.dept}</div>
            <div className="text-xs font-mono tracking-widest mb-2" style={{ color: '#444' }}>BEHAVIOURAL PROFILE</div>
            <textarea
              value={editingPersona.m365Summary}
              onChange={e => setPersonas(prev => prev.map(x => x.id === editingPersona.id ? { ...x, m365Summary: e.target.value } : x))}
              className="w-full h-40 rounded p-3 text-xs resize-none leading-relaxed"
              style={{ background: '#080808', border: '1px solid #1E1E1E', color: '#C8C8C0', fontFamily: 'Georgia, serif' }}
            />
            <p className="text-xs mt-2 mb-4 leading-relaxed" style={{ color: '#333' }}>
              Describe communication style, stress responses, interpersonal tendencies, and behavioural blind spots as observed from their communication patterns.
            </p>
            <button
              onClick={() => setEditingPersonaId(null)}
              className="px-5 py-2 rounded text-xs font-bold tracking-wider"
              style={{ background: editingPersona.color, border: 'none', color: '#080808' }}
            >
              Save Profile
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // ── SIMULATION VIEW ──────────────────────────────────────────────────────────
  if (view === 'sim') return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col" style={{ background: '#080808', color: '#C8C8C0' }}>
      <style>{`
        @keyframes rfBounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-5px)} }
        @keyframes rfPulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes rfSlide { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes rfFade { from{opacity:0} to{opacity:1} }
        @keyframes rfFlash { 0%{opacity:0;transform:scaleY(0.8)} 100%{opacity:1;transform:scaleY(1)} }
      `}</style>

      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 py-2.5 border-b flex-shrink-0" style={{ borderColor: '#0E0E0E' }}>
        <div
          className="w-2 h-2 rounded-full"
          style={{
            background: isRunning ? '#C84040' : debriefLoading ? '#E8A040' : '#6EC860',
            animation: (isRunning || debriefLoading) ? 'rfPulse 0.9s ease-in-out infinite' : 'none',
          }}
        />
        <span className="text-xs font-mono tracking-wider" style={{ color: '#555' }}>
          {isRunning ? 'LIVE' : debriefLoading ? 'ANALYSING' : 'COMPLETE'}
        </span>
        <span className="text-xs" style={{ color: '#333' }}>{activeScenario?.icon} {activeScenario?.title}</span>
        <div className="ml-auto flex items-center gap-2">
          {personas.map(p => (
            <div
              key={p.id}
              className="w-6 h-6 rounded-full flex items-center justify-center font-mono font-bold transition-all"
              style={{
                fontSize: '8px',
                background: '#0D0D0D',
                border: `1.5px solid ${typingPersonas.some(t => t.id === p.id) ? p.color : '#181818'}`,
                color: typingPersonas.some(t => t.id === p.id) ? p.color : '#2A2A2A',
                boxShadow: typingPersonas.some(t => t.id === p.id) ? `0 0 8px ${p.color}55` : 'none',
              }}
            >{p.initial}</div>
          ))}
          {isRunning && (
            <button
              onClick={() => { abortRef.current = true; setIsRunning(false); }}
              className="ml-2 px-2.5 py-1 rounded text-xs font-mono tracking-wider"
              style={{ background: 'transparent', border: '1px solid #C84040', color: '#C84040' }}
            >STOP</button>
          )}
          {!isRunning && !debriefLoading && (
            <button
              onClick={() => setView('debrief')}
              className="ml-2 px-2.5 py-1 rounded text-xs font-bold font-mono tracking-wider"
              style={{ background: '#C8A96E', border: 'none', color: '#080808' }}
            >DEBRIEF →</button>
          )}
        </div>
      </div>

      {/* Phase progress */}
      <div className="flex gap-2 px-5 py-2 border-b flex-shrink-0" style={{ borderColor: '#0F0F0F' }}>
        {(activeScenario?.basePhases ?? []).map((ph, i) => (
          <div
            key={i}
            className="flex-1 px-2 py-1.5 rounded text-xs"
            style={{
              background: i <= currentPhaseIdx ? '#0F0A0A' : '#080808',
              border: `1px solid ${i < currentPhaseIdx ? '#C8404044' : i === currentPhaseIdx ? '#C84040' : '#111'}`,
              color: i <= currentPhaseIdx ? '#C84040' : '#222',
            }}
          >
            <div className="font-bold font-mono mb-0.5" style={{ fontSize: '9px' }}>{ph.label}</div>
            <div style={{ fontSize: '9px', color: i <= currentPhaseIdx ? '#664040' : '#1A1A1A' }}>
              {ph.text.split('—')[0].substring(0, 30)}
            </div>
          </div>
        ))}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
        {messages.map(msg => <SimMessageRow key={msg.id} msg={msg} personas={personas} />)}
        <TypingIndicators personas={typingPersonas} />
        {debriefLoading && (
          <div className="text-center py-6 text-xs font-mono tracking-widest" style={{ color: '#2E2E2E' }}>
            SIMULATION COMPLETE · GENERATING REPORT
          </div>
        )}
      </div>
    </div>
  );

  // ── DEBRIEF VIEW ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: '#080808', color: '#C8C8C0' }}>
      <style>{`@keyframes rfPulse{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>

      <div className="flex items-center justify-between px-8 py-4 border-b" style={{ borderColor: '#111' }}>
        <div>
          <div className="text-xs font-mono tracking-widest mb-1" style={{ color: '#2A2A2A' }}>POST-SIMULATION ANALYSIS</div>
          <h2 className="text-xl font-normal" style={{ fontFamily: 'Georgia, serif', color: '#E0E0D8' }}>Board Debrief Report</h2>
        </div>
        <div className="flex items-center gap-3">
          {debrief?.overallRating && (
            <div
              className="px-4 py-1.5 rounded text-sm font-bold font-mono tracking-wider"
              style={{
                background: `${RATING_COLORS[debrief.overallRating]}12`,
                border: `1px solid ${RATING_COLORS[debrief.overallRating]}88`,
                color: RATING_COLORS[debrief.overallRating],
              }}
            >● {debrief.overallRating}</div>
          )}
          <button onClick={() => setView('sim')} className="px-4 py-1.5 rounded text-xs font-mono" style={{ background: 'transparent', border: '1px solid #1E1E1E', color: '#444' }}>← Transcript</button>
          <button onClick={() => { setView('setup'); setMessages([]); historyRef.current = []; setDebrief(null); }} className="px-4 py-1.5 rounded text-xs font-mono" style={{ background: 'transparent', border: '1px solid #1E1E1E', color: '#444' }}>New Simulation</button>
        </div>
      </div>

      {!debrief ? (
        <div className="p-10 text-center text-xs font-mono tracking-widest" style={{ color: '#333' }}>GENERATING ANALYSIS...</div>
      ) : (
        <div className="p-8 flex flex-col gap-4">

          {/* Summary */}
          <div className="p-5 rounded-lg" style={{ background: '#0D0D0D', border: '1px solid #1A1A1A' }}>
            <div className="text-xs font-mono tracking-widest mb-2" style={{ color: '#444' }}>EXECUTIVE SUMMARY</div>
            {debrief.ratingRationale && (
              <div className="text-xs font-mono mb-2" style={{ color: debrief.overallRating ? RATING_COLORS[debrief.overallRating] : '#888' }}>
                {debrief.ratingRationale}
              </div>
            )}
            <p className="text-sm leading-relaxed" style={{ color: '#BEBEB6', fontFamily: 'Georgia, serif' }}>{debrief.executiveSummary}</p>
            {debrief.protocolAdherence && (
              <p className="text-xs mt-3 pt-3 border-t leading-relaxed" style={{ color: '#555', borderColor: '#111' }}>
                <span className="font-mono" style={{ color: '#333', fontSize: '9px', letterSpacing: '0.1em' }}>PROTOCOL: </span>
                {debrief.protocolAdherence}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">

            {/* Plan deficiencies */}
            <div className="p-5 rounded-lg" style={{ background: '#0D0D0D', border: '1px solid #C8404020' }}>
              <div className="text-xs font-mono tracking-widest mb-4" style={{ color: '#C84040' }}>⚠ PLAN DEFICIENCIES</div>
              <div className="flex flex-col gap-4">
                {debrief.planDeficiencies.map((d, i) => (
                  <div key={i} className="pl-3" style={{ borderLeft: '2px solid #C84040' }}>
                    <div className="text-xs font-bold mb-1" style={{ color: '#DDB8B8' }}>{d.title}</div>
                    <div className="text-xs italic mb-1.5 leading-relaxed" style={{ color: '#664040' }}>{d.whatHappened}</div>
                    <div className="text-xs leading-relaxed" style={{ color: '#553030' }}>{d.impact}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Human behaviour */}
            <div className="p-5 rounded-lg" style={{ background: '#0D0D0D', border: '1px solid #E8A04020' }}>
              <div className="text-xs font-mono tracking-widest mb-4" style={{ color: '#E8A040' }}>HUMAN BEHAVIOUR INSIGHTS</div>
              <div className="flex flex-col gap-4">
                {debrief.humanBehaviourInsights.map((h, i) => (
                  <div key={i} className="pl-3" style={{ borderLeft: '2px solid #E8A040' }}>
                    <div className="text-xs font-bold mb-1" style={{ color: '#E0CCA8' }}>{h.person}</div>
                    <div className="text-xs italic mb-1 leading-relaxed" style={{ color: '#665530' }}>{h.behaviourObserved}</div>
                    <div className="text-xs mb-2 leading-relaxed" style={{ color: '#554422' }}>{h.underPressurePattern}</div>
                    <span className="text-xs px-2 py-0.5 rounded inline-block" style={{ color: '#E8A040', background: '#130F00', border: '1px solid #E8A04030' }}>
                      → {h.trainingRecommendation}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Curveball responses */}
            {debrief.curveballResponses?.length > 0 && (
              <div className="p-5 rounded-lg" style={{ background: '#0D0D0D', border: '1px solid #B87AE820' }}>
                <div className="text-xs font-mono tracking-widest mb-4" style={{ color: '#B87AE8' }}>⚡ CURVEBALL RESPONSES</div>
                <div className="flex flex-col gap-3">
                  {debrief.curveballResponses.map((c, i) => (
                    <div key={i} className="pl-3" style={{ borderLeft: '2px solid #B87AE8' }}>
                      <div className="text-xs italic mb-1" style={{ color: '#666' }}>{c.curveball}</div>
                      <div className="text-xs mb-1 leading-relaxed" style={{ color: '#7A6090' }}>{c.howHandled}</div>
                      {c.gap && <div className="text-xs" style={{ color: '#554466' }}>Gap: {c.gap}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reassurance + actions */}
            <div className="flex flex-col gap-4">
              <div className="p-5 rounded-lg flex-1" style={{ background: '#0D0D0D', border: '1px solid #6EC86020' }}>
                <div className="text-xs font-mono tracking-widest mb-3" style={{ color: '#6EC860' }}>✓ BOARD REASSURANCE</div>
                {debrief.boardReassurance.map((r, i) => (
                  <div key={i} className="flex gap-2 text-xs leading-relaxed mb-2" style={{ color: '#80A878' }}>
                    <span style={{ color: '#6EC860', flexShrink: 0 }}>✓</span><span>{r}</span>
                  </div>
                ))}
              </div>
              <div className="p-5 rounded-lg" style={{ background: '#0D0D0D', border: '1px solid #6EC8E820' }}>
                <div className="text-xs font-mono tracking-widest mb-3" style={{ color: '#6EC8E8' }}>IMMEDIATE ACTIONS</div>
                {debrief.immediateActions.map((a, i) => (
                  <div key={i} className="flex gap-2 mb-3 items-start">
                    <span
                      className="text-xs px-1.5 py-0.5 rounded flex-shrink-0 font-mono mt-0.5"
                      style={{
                        fontSize: '9px',
                        background: `${PRIORITY_COLORS[a.priority] || '#444'}18`,
                        border: `1px solid ${PRIORITY_COLORS[a.priority] || '#444'}44`,
                        color: PRIORITY_COLORS[a.priority] || '#888',
                      }}
                    >{a.priority}</span>
                    <div>
                      <div className="text-xs leading-relaxed" style={{ color: '#A0B8B8' }}>{a.action}</div>
                      {a.owner && <div className="text-xs mt-0.5 font-mono" style={{ color: '#2E2E2E' }}>Owner: {a.owner}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
