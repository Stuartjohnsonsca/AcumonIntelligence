'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { EXTERNAL_BENCH, type BenchPersona } from './externalBench';

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
  type: 'phase' | 'curveball' | 'message' | 'system';
  personaId?: string;
  text: string;
  label?: string;
  time?: string;
  simClock?: string;
}

// A thread is either the main war room or a breakout sub-conversation.
// Breakouts have a parent (the main room) and a defined set of participants.
interface Thread {
  id: string;
  name: string;                  // display name ("War Room", "Technical Breakout")
  kind: 'main' | 'breakout';
  participantIds: string[];      // persona ids (includes summoned externals once joined)
  parentThreadId?: string;       // for breakouts
  spawnedAtSimMin: number;
  topic?: string;                // what this breakout is about (for breakouts)
  status: 'active' | 'concluded';
  concludedAtSimMin?: number;
  concludedReason?: string;      // audit note: was summary formally agreed?
  messages: SimMessage[];
}

// Audit record of a structural action the orchestrator took during the run.
// Used in the debrief to show the shape of the conversation, not just the content.
interface OrchestratorEvent {
  id: string;
  atSimMin: number;
  type: 'spawn_breakout' | 'summon_external' | 'conclude_breakout' | 'facilitator_inject' | 'facilitator_advance' | 'facilitator_summon' | 'facilitator_breakout';
  description: string;
  reason?: string;
}

// Actions a human facilitator can queue to steer the simulation in real time.
// Processed at the start of the next loop iteration or between API calls.
type FacilitatorAction =
  | { kind: 'inject_event'; text: string }
  | { kind: 'advance_time'; minutes: number }
  | { kind: 'summon_external'; benchId: string }
  | { kind: 'force_breakout'; participantIds: string[]; topic: string; threadName: string };

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

  if (msg.type === 'system') return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 h-px" style={{ background: '#0F0F0F' }} />
      <div className="px-3 py-1 rounded text-xs font-mono tracking-wider" style={{ background: '#080A0D', border: '1px solid #2A3E50', color: '#6E8FA8' }}>
        {msg.simClock && <span className="mr-2" style={{ color: '#3E5468' }}>{msg.simClock}</span>}
        {msg.text}
      </div>
      <div className="flex-1 h-px" style={{ background: '#0F0F0F' }} />
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

  // Threads replace the single messages[] array. The "main" thread always exists;
  // breakouts are spawned by the orchestrator and concluded with a summary post.
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const [threadOrder, setThreadOrder] = useState<string[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>('main');
  const [unreadThreads, setUnreadThreads] = useState<Record<string, number>>({});

  // Personas in play — includes summoned externals once they've joined the room.
  // DEFAULT_PERSONAS seed at setup; new entries appear as the orchestrator summons.
  const [allPersonas, setAllPersonas] = useState<Persona[]>(DEFAULT_PERSONAS);

  // Orchestrator audit trail — what structural moves happened and when.
  const [orchestratorEvents, setOrchestratorEvents] = useState<OrchestratorEvent[]>([]);

  const [typingPersonas, setTypingPersonas] = useState<{ persona: Persona; threadId: string }[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showFacilitator, setShowFacilitator] = useState(false);
  const [injectionText, setInjectionText] = useState('');
  const [forceBreakoutParticipants, setForceBreakoutParticipants] = useState<string[]>([]);
  const [forceBreakoutTopic, setForceBreakoutTopic] = useState('');
  const [forceBreakoutName, setForceBreakoutName] = useState('');
  const [currentPhaseIdx, setCurrentPhaseIdx] = useState(0);
  const [debrief, setDebrief] = useState<DebriefData | null>(null);
  const [debriefLoading, setDebriefLoading] = useState(false);
  const [editingPersonaId, setEditingPersonaId] = useState<string | null>(null);

  // Running AI usage & cost across all calls in this session (simulate + debrief + orchestrate)
  const [totalTokens, setTotalTokens] = useState(0);
  const [apiCalls, setApiCalls] = useState(0);
  // Llama 3.3 70B Turbo on Together AI is $0.88 per million tokens (input+output blended).
  const COST_USD_PER_MILLION_TOKENS = 0.88;
  const USD_TO_GBP = 0.79;

  // Real-time cap on run duration (minutes of wall-clock time).
  const [maxRuntimeMinutes, setMaxRuntimeMinutes] = useState(10);
  // Simulated minutes since T+0, driven by 100x clock compression.
  const [simulatedMinutes, setSimulatedMinutes] = useState(0);
  // Real-world seconds elapsed since the run started.
  const [realSecondsElapsed, setRealSecondsElapsed] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);
  const pausedRef = useRef(false);
  const facilitatorQueueRef = useRef<FacilitatorAction[]>([]);
  // Additional simulated-minute offset applied by facilitator time advances.
  const simMinBoostRef = useRef(0);
  const threadsRef = useRef<Record<string, Thread>>({});
  const allPersonasRef = useRef<Persona[]>(DEFAULT_PERSONAS);
  const simMinutesRef = useRef(0);
  const runStartRef = useRef<number | null>(null);
  // Time compression factor: 1 real second = CLOCK_COMPRESSION simulated seconds.
  const CLOCK_COMPRESSION = 100;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [threads, activeThreadId, typingPersonas]);

  // Clock ticker: updates every second while running, drives the compressed
  // simulated clock and enforces the real-time cap. Paused state freezes the
  // clock from advancing but does NOT pause the real-time cap — the cap is
  // the session budget regardless of whether time is being consumed.
  useEffect(() => {
    if (!isRunning || runStartRef.current === null) return;
    const interval = setInterval(() => {
      const start = runStartRef.current;
      if (start === null) return;
      const realSeconds = (Date.now() - start) / 1000;
      setRealSecondsElapsed(realSeconds);
      if (!pausedRef.current) {
        const simMin = Math.floor((realSeconds * CLOCK_COMPRESSION) / 60) + simMinBoostRef.current;
        simMinutesRef.current = simMin;
        setSimulatedMinutes(simMin);
      }
      if (realSeconds >= maxRuntimeMinutes * 60) {
        abortRef.current = true;
        setIsRunning(false);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [isRunning, maxRuntimeMinutes]);

  // Clear unread indicator when a thread is opened
  useEffect(() => {
    if (activeThreadId) {
      setUnreadThreads(prev => ({ ...prev, [activeThreadId]: 0 }));
    }
  }, [activeThreadId]);

  const formatSimulatedClock = (totalMin: number): string => {
    const days = Math.floor(totalMin / (60 * 24));
    const hours = Math.floor((totalMin % (60 * 24)) / 60);
    const mins = totalMin % 60;
    if (days > 0) return `T+${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `T+${hours}h ${mins}m`;
    return `T+${mins}m`;
  };

  const formatCountdown = (realSec: number): string => {
    const remaining = Math.max(0, maxRuntimeMinutes * 60 - realSec);
    const m = Math.floor(remaining / 60);
    const s = Math.floor(remaining % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Helpers for thread state updates (write through ref AND state for sync access during loop)
  const upsertThread = useCallback((thread: Thread) => {
    threadsRef.current = { ...threadsRef.current, [thread.id]: thread };
    setThreads(prev => ({ ...prev, [thread.id]: thread }));
  }, []);

  const addMessageToThread = useCallback((threadId: string, msg: SimMessage) => {
    const existing = threadsRef.current[threadId];
    if (!existing) return;
    const updated: Thread = { ...existing, messages: [...existing.messages, msg] };
    threadsRef.current = { ...threadsRef.current, [threadId]: updated };
    setThreads(prev => ({ ...prev, [threadId]: updated }));
    // Mark unread if the user is not viewing this thread right now
    setActiveThreadId(current => {
      if (current !== threadId) {
        setUnreadThreads(prev => ({ ...prev, [threadId]: (prev[threadId] || 0) + 1 }));
      }
      return current;
    });
  }, []);

  const addPersona = useCallback((p: Persona) => {
    allPersonasRef.current = [...allPersonasRef.current, p];
    setAllPersonas(prev => [...prev, p]);
  }, []);

  const addOrchestratorEvent = useCallback((e: OrchestratorEvent) => {
    setOrchestratorEvents(prev => [...prev, e]);
  }, []);

  // Record AI token usage reported by any API endpoint so we can show running cost.
  const recordUsage = useCallback((usage: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number } | null | undefined) => {
    if (!usage) { setApiCalls(c => c + 1); return; }
    const t = usage.total_tokens ?? ((usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0));
    setTotalTokens(prev => prev + t);
    setApiCalls(c => c + 1);
  }, []);

  // Facilitator controls ─────────────────────────────────────────────────────
  const enqueueFacilitatorAction = useCallback((a: FacilitatorAction) => {
    facilitatorQueueRef.current = [...facilitatorQueueRef.current, a];
  }, []);

  const togglePause = useCallback(() => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setIsPaused(next);
  }, []);

  // Suspends the sim loop while paused.
  const waitIfPaused = async () => {
    while (pausedRef.current && !abortRef.current) {
      await new Promise(r => setTimeout(r, 200));
    }
  };

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

  const callPersonaAPI = async (persona: Persona, phaseText: string, curveball: string | null, threadId: string) => {
    // Use live history FROM THIS THREAD so each speaker sees what previous speakers
    // said in the same conversation (main room or a breakout — never cross-contaminated).
    const thread = threadsRef.current[threadId];
    const conversationHistory = (thread?.messages ?? [])
      .filter(m => m.type === 'message')
      .slice(-25)
      .map(m => {
        const p = allPersonasRef.current.find(a => a.id === m.personaId);
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
      recordUsage(data.usage);
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

    // Build a transcript that preserves thread structure — the shape of the
    // conversation (where breakouts happened, who joined) is itself assessable.
    const transcriptParts: string[] = [];
    for (const tid of Object.keys(threadsRef.current)) {
      const t = threadsRef.current[tid];
      if (!t.messages.some(m => m.type === 'message')) continue;
      const threadHeader = t.kind === 'main'
        ? '=== MAIN WAR ROOM ==='
        : `=== BREAKOUT: "${t.name}" ${t.topic ? `(${t.topic})` : ''} spawned T+${t.spawnedAtSimMin}m${t.status === 'concluded' ? `, concluded T+${t.concludedAtSimMin}m` : ''} ===`;
      transcriptParts.push(threadHeader);
      for (const m of t.messages) {
        if (m.type === 'message') {
          const p = allPersonasRef.current.find(a => a.id === m.personaId);
          transcriptParts.push(`${p?.name} (${p?.role})${m.simClock ? ` ${m.simClock}` : ''}: ${m.text}`);
        } else if (m.type === 'curveball') {
          transcriptParts.push(`[DEVELOPING: ${m.text}]`);
        } else if (m.type === 'system') {
          transcriptParts.push(`[${m.text}]`);
        }
      }
      transcriptParts.push('');
    }
    const transcript = transcriptParts.join('\n');

    const curveballs = Object.values(threadsRef.current)
      .flatMap(t => t.messages)
      .filter(m => m.type === 'curveball')
      .map(m => m.text).join('\n');

    const res = await fetch('/api/risk-forum/debrief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, curveballs, scenario: activeScenario, protocol, useProtocol }),
    });

    if (res.ok) {
      const data = await res.json();
      recordUsage(data.usage);
      setDebrief(data.debrief);
    }
    setDebriefLoading(false);
  };

  // ── Orchestrator + thread-aware simulation loop ───────────────────────────────

  const formatSimClockForMsg = () => {
    const m = simMinutesRef.current;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return h > 0 ? `T+${h}h${rem.toString().padStart(2, '0')}m` : `T+${rem}m`;
  };

  // Call the supervisory orchestrator — returns structural actions to execute.
  const callOrchestrator = async (scenarioDescription: string) => {
    // Build per-thread recent transcript snapshot
    const threadsTranscript = Object.values(threadsRef.current).map(t => ({
      threadId: t.id,
      threadName: t.name,
      status: t.status,
      recentMessages: t.messages
        .filter(m => m.type === 'message')
        .slice(-8)
        .map(m => {
          const p = allPersonasRef.current.find(a => a.id === m.personaId);
          return { name: p?.name ?? '', role: p?.role ?? '', text: m.text };
        }),
    }));

    const availablePersonas = allPersonasRef.current.map(p => ({ id: p.id, name: p.name, role: p.role }));
    const alreadySummonedIds = new Set(allPersonasRef.current.map(p => p.id));
    const availableExternals = EXTERNAL_BENCH
      .filter(e => !alreadySummonedIds.has(e.id))
      .map(e => ({ id: e.id, name: e.name, role: e.role, summonTriggers: e.summonTriggers }));

    const activeBreakoutIds = Object.values(threadsRef.current)
      .filter(t => t.kind === 'breakout' && t.status === 'active')
      .map(t => t.id);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch('/api/risk-forum/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          threadsTranscript,
          availablePersonas,
          availableExternals,
          activeBreakoutIds,
          scenarioDescription,
          simulatedClockLabel: formatSimClockForMsg(),
        }),
      });
      clearTimeout(timeout);
      if (!res.ok) return { actions: [] };
      const data = await res.json();
      recordUsage(data.usage);
      return data as { actions: Array<Record<string, string | string[] | undefined>> };
    } catch {
      return { actions: [] };
    }
  };

  // Drain facilitator queue and execute each queued action against live state.
  // Called at safe points between API calls inside the main loop.
  const processFacilitatorQueue = async () => {
    if (facilitatorQueueRef.current.length === 0) return;
    const queue = facilitatorQueueRef.current;
    facilitatorQueueRef.current = [];
    for (const action of queue) {
      if (abortRef.current) break;
      const simMin = simMinutesRef.current;
      const clockLabel = formatSimClockForMsg();

      if (action.kind === 'inject_event') {
        addMessageToThread('main', {
          id: `facilitator-inject-${Date.now()}`,
          type: 'curveball',
          text: action.text,
          simClock: clockLabel,
        });
        addOrchestratorEvent({
          id: `evt-${Date.now()}`,
          atSimMin: simMin,
          type: 'facilitator_inject',
          description: `Facilitator injected event: "${action.text}"`,
        });
      }

      if (action.kind === 'advance_time') {
        simMinBoostRef.current += action.minutes;
        simMinutesRef.current += action.minutes;
        setSimulatedMinutes(m => m + action.minutes);
        addMessageToThread('main', {
          id: `facilitator-advance-${Date.now()}`,
          type: 'system',
          text: `[Time jump +${action.minutes} minutes] Facilitator advanced the simulated clock.`,
          simClock: formatSimClockForMsg(),
        });
        addOrchestratorEvent({
          id: `evt-${Date.now()}`,
          atSimMin: simMin,
          type: 'facilitator_advance',
          description: `Facilitator advanced clock +${action.minutes}m`,
        });
      }

      if (action.kind === 'summon_external') {
        const bench = EXTERNAL_BENCH.find(b => b.id === action.benchId);
        if (!bench || allPersonasRef.current.some(p => p.id === bench.id)) continue;
        await executeOrchestratorAction({
          type: 'summon_external',
          benchId: bench.id,
          reason: 'Facilitator summoned',
        });
        addOrchestratorEvent({
          id: `evt-${Date.now()}`,
          atSimMin: simMin,
          type: 'facilitator_summon',
          description: `Facilitator summoned ${bench.name} (${bench.role})`,
        });
      }

      if (action.kind === 'force_breakout') {
        if (action.participantIds.length < 2) continue;
        await executeOrchestratorAction({
          type: 'spawn_breakout',
          participants: action.participantIds,
          topic: action.topic,
          threadName: action.threadName,
          reason: 'Facilitator forced breakout',
        });
        addOrchestratorEvent({
          id: `evt-${Date.now()}`,
          atSimMin: simMin,
          type: 'facilitator_breakout',
          description: `Facilitator forced breakout "${action.threadName}" with ${action.participantIds.map(id => allPersonasRef.current.find(p => p.id === id)?.name ?? id).join(', ')}`,
        });
      }
    }
  };

  // Execute a single orchestrator action against live state
  const executeOrchestratorAction = async (action: Record<string, string | string[] | undefined>) => {
    const simMin = simMinutesRef.current;
    const clockLabel = formatSimClockForMsg();

    if (action.type === 'summon_external') {
      const bench = EXTERNAL_BENCH.find(b => b.id === action.benchId);
      if (!bench || allPersonasRef.current.some(p => p.id === bench.id)) return;
      const newPersona: Persona = {
        id: bench.id, name: bench.name, role: bench.role, dept: bench.dept,
        m365Summary: bench.m365Summary, color: bench.color, initial: bench.initial,
      };
      addPersona(newPersona);
      // Add them as a participant in the main thread
      const mainThread = threadsRef.current['main'];
      if (mainThread) {
        const updated: Thread = { ...mainThread, participantIds: [...mainThread.participantIds, bench.id] };
        upsertThread(updated);
      }
      // System message announcing the join
      addMessageToThread('main', {
        id: `sys-summon-${Date.now()}`,
        type: 'system',
        text: `${bench.name} (${bench.role}) has joined the call.`,
        simClock: clockLabel,
      });
      addOrchestratorEvent({
        id: `evt-${Date.now()}`,
        atSimMin: simMin,
        type: 'summon_external',
        description: `${bench.name} summoned into main room${action.calledBy ? ` by ${allPersonasRef.current.find(p => p.id === action.calledBy)?.name ?? action.calledBy}` : ''}`,
        reason: action.reason as string | undefined,
      });
      // Their opening remark, using the context brief
      const openingText = await callPersonaAPI(
        newPersona,
        `You have just been called into a live crisis. Context brief: ${bench.contextBrief}. The scenario is: ${activeScenario?.description}. You have joined the main room. Make your opening remark — ask your standard opening question or state your position per your behavioural profile.`,
        null,
        'main',
      );
      if (openingText) {
        addMessageToThread('main', {
          id: `${newPersona.id}-${Date.now()}`,
          type: 'message',
          personaId: newPersona.id,
          text: openingText,
          time: getTime(),
          simClock: clockLabel,
        });
      }
      return;
    }

    if (action.type === 'spawn_breakout') {
      const participants = (action.participants as string[] | undefined) ?? [];
      if (participants.length < 2) return;
      const threadId = `thread-${Date.now()}`;
      const newThread: Thread = {
        id: threadId,
        name: (action.threadName as string) ?? 'Breakout',
        kind: 'breakout',
        participantIds: participants,
        parentThreadId: 'main',
        spawnedAtSimMin: simMin,
        topic: action.topic as string | undefined,
        status: 'active',
        messages: [],
      };
      upsertThread(newThread);
      setThreadOrder(prev => [...prev, threadId]);
      // System note in main room that breakout was spawned
      const names = participants
        .map(id => allPersonasRef.current.find(p => p.id === id)?.name ?? id)
        .join(' and ');
      addMessageToThread('main', {
        id: `sys-breakout-${Date.now()}`,
        type: 'system',
        text: `${names} stepped out for a sidebar${action.topic ? `: "${action.topic}"` : ''}.`,
        simClock: clockLabel,
      });
      addOrchestratorEvent({
        id: `evt-${Date.now()}`,
        atSimMin: simMin,
        type: 'spawn_breakout',
        description: `Breakout spawned: "${newThread.name}" with ${names}${action.topic ? ` on "${action.topic}"` : ''}`,
        reason: action.reason as string | undefined,
      });
      return;
    }

    if (action.type === 'conclude_breakout') {
      const threadId = action.threadId as string;
      const thread = threadsRef.current[threadId];
      if (!thread || thread.status !== 'active' || thread.kind !== 'breakout') return;
      const summarizerId = (action.summarizer as string) ?? thread.participantIds[0];
      const summarizer = allPersonasRef.current.find(p => p.id === summarizerId);
      const summary = (action.summary as string) ?? 'Breakout concluded.';
      const concluded: Thread = {
        ...thread,
        status: 'concluded',
        concludedAtSimMin: simMin,
        concludedReason: action.reason as string | undefined,
      };
      upsertThread(concluded);
      // Summary post into main, spoken by the summariser in character
      if (summarizer) {
        addMessageToThread('main', {
          id: `summary-${Date.now()}`,
          type: 'message',
          personaId: summarizerId,
          text: `[Back from ${thread.name}] ${summary}`,
          time: getTime(),
          simClock: clockLabel,
        });
      } else {
        addMessageToThread('main', {
          id: `sys-conclude-${Date.now()}`,
          type: 'system',
          text: `${thread.name} concluded. ${summary}`,
          simClock: clockLabel,
        });
      }
      addOrchestratorEvent({
        id: `evt-${Date.now()}`,
        atSimMin: simMin,
        type: 'conclude_breakout',
        description: `Breakout "${thread.name}" concluded${summarizer ? `; ${summarizer.name} reported back` : ''}`,
        reason: action.reason as string | undefined,
      });
    }
  };

  // Speak one round in a thread — picks participants from that thread and gets each to respond
  const speakRoundInThread = async (threadId: string, phaseText: string, curveball: string | null, numSpeakers: number) => {
    const thread = threadsRef.current[threadId];
    if (!thread || thread.status !== 'active') return;
    const threadPersonas = thread.participantIds
      .map(id => allPersonasRef.current.find(p => p.id === id))
      .filter((p): p is Persona => p !== undefined);
    if (threadPersonas.length === 0) return;
    const speakers = [...threadPersonas].sort(() => Math.random() - 0.5).slice(0, Math.min(numSpeakers, threadPersonas.length));

    for (const persona of speakers) {
      if (abortRef.current) break;
      if (threadsRef.current[threadId]?.status !== 'active') break;

      await waitIfPaused();
      if (abortRef.current) break;

      setTypingPersonas([{ persona, threadId }]);
      const text = await callPersonaAPI(persona, phaseText, curveball, threadId);
      if (abortRef.current) break;
      setTypingPersonas([]);

      // Drain facilitator injections between speakers so events land promptly.
      await processFacilitatorQueue();

      addMessageToThread(threadId, {
        id: `${persona.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: 'message',
        personaId: persona.id,
        text: text ?? `[${persona.name} — no response]`,
        time: getTime(),
        simClock: formatSimClockForMsg(),
      });
    }
    setTypingPersonas([]);
  };

  const runSimulation = async () => {
    if (!activeScenario) return;
    abortRef.current = false;
    pausedRef.current = false;
    setIsPaused(false);
    facilitatorQueueRef.current = [];
    simMinBoostRef.current = 0;
    runStartRef.current = Date.now();
    simMinutesRef.current = 0;
    allPersonasRef.current = [...personas];
    setAllPersonas([...personas]);
    setSimulatedMinutes(0);
    setRealSecondsElapsed(0);
    setIsRunning(true);
    setCurrentPhaseIdx(0);
    setDebrief(null);
    setOrchestratorEvents([]);
    setUnreadThreads({});
    setTotalTokens(0);
    setApiCalls(0);
    setView('sim');

    // Initialise the main war room thread with all starting personas
    const mainThread: Thread = {
      id: 'main',
      name: 'War Room',
      kind: 'main',
      participantIds: personas.map(p => p.id),
      spawnedAtSimMin: 0,
      status: 'active',
      messages: [],
    };
    threadsRef.current = { main: mainThread };
    setThreads({ main: mainThread });
    setThreadOrder(['main']);
    setActiveThreadId('main');

    const phases = activeScenario.basePhases;
    const curveballs = [...activeScenario.curveballs].sort(() => Math.random() - 0.5);
    let curveballIdx = 0;
    let globalPhaseIdx = 0;
    let messagesSinceOrchestrator = 0;

    // Outer loop: keeps generating conversation until the user-set real-time
    // cap is hit (or Stop is pressed). Phases cycle and extend beyond the
    // scripted timeline so a longer cap produces a longer simulation.
    while (!abortRef.current) {
      await waitIfPaused();
      if (abortRef.current) break;
      await processFacilitatorQueue();

      const phase = phases[globalPhaseIdx % phases.length] ?? phases[phases.length - 1];
      const isExtension = globalPhaseIdx >= phases.length;
      const phaseLabel = isExtension ? `Ongoing +${globalPhaseIdx - phases.length + 1}` : phase.label;
      const phaseText = isExtension
        ? `${phase.text} Situation continues to develop — new information, decisions needed, people reacting.`
        : phase.text;

      // Phase marker goes into main thread only
      addMessageToThread('main', { id: `phase-${globalPhaseIdx}`, type: 'phase', label: phaseLabel, text: phaseText, simClock: formatSimClockForMsg() });
      setCurrentPhaseIdx(Math.min(globalPhaseIdx, phases.length - 1));

      let curveball: string | null = null;
      if ((globalPhaseIdx > 0 && Math.random() > 0.3) && curveballIdx < curveballs.length) {
        curveball = curveballs[curveballIdx++];
        if (!abortRef.current) {
          addMessageToThread('main', { id: `cb-${globalPhaseIdx}`, type: 'curveball', text: curveball, simClock: formatSimClockForMsg() });
        }
      }

      // Main room round — a few speakers respond to the phase/curveball
      await waitIfPaused();
      await processFacilitatorQueue();
      const mainCount = globalPhaseIdx === 0 ? 4 : 3;
      await speakRoundInThread('main', phaseText, curveball, mainCount);
      messagesSinceOrchestrator += mainCount;

      // Any active breakouts get a round too, using their own topic as the phase text
      const activeBreakouts = Object.values(threadsRef.current)
        .filter(t => t.kind === 'breakout' && t.status === 'active');
      for (const bt of activeBreakouts) {
        if (abortRef.current) break;
        await waitIfPaused();
        await processFacilitatorQueue();
        const breakoutPhaseText = `You are in a sidebar${bt.topic ? ` on "${bt.topic}"` : ''} away from the main war room. The broader situation is still developing — keep focused on your sub-topic. Continue the sidebar conversation, work towards a conclusion or recommendation.`;
        await speakRoundInThread(bt.id, breakoutPhaseText, null, 3);
        messagesSinceOrchestrator += 3;
      }

      // Orchestrator check — consult the supervisor after a handful of messages
      if (messagesSinceOrchestrator >= 5 && !abortRef.current) {
        await waitIfPaused();
        await processFacilitatorQueue();
        messagesSinceOrchestrator = 0;
        const result = await callOrchestrator(activeScenario.description);
        for (const action of result.actions ?? []) {
          if (abortRef.current) break;
          await executeOrchestratorAction(action);
        }
      }

      globalPhaseIdx++;
      if (globalPhaseIdx > 40) break; // safety cap
    }

    setTypingPersonas([]);
    setIsRunning(false);

    // Always offer debrief — even on Stop or cap cut-off.
    await runDebrief();
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

          {/* Runtime cap */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono tracking-widest" style={{ color: '#333' }}>REAL-TIME CAP</span>
              <span className="text-xs font-mono" style={{ color: '#C8A96E' }}>
                {maxRuntimeMinutes} min · covers ~{Math.round((maxRuntimeMinutes * CLOCK_COMPRESSION) / 60)}h simulated
              </span>
            </div>
            <div className="flex items-center gap-2">
              {[2, 5, 10, 20, 30].map(mins => (
                <button
                  key={mins}
                  onClick={() => setMaxRuntimeMinutes(mins)}
                  className="flex-1 py-2 rounded text-xs font-mono tracking-wider transition-all"
                  style={{
                    background: maxRuntimeMinutes === mins ? '#0F0A0A' : '#0A0A0A',
                    border: `1px solid ${maxRuntimeMinutes === mins ? '#C8A96E' : '#1A1A1A'}`,
                    color: maxRuntimeMinutes === mins ? '#C8A96E' : '#555',
                  }}
                >
                  {mins}m
                </button>
              ))}
            </div>
            <p className="text-xs mt-2 leading-relaxed" style={{ color: '#333' }}>
              Clock runs at {CLOCK_COMPRESSION}x — agents experience hours of crisis in minutes. Sim stops when cap hits, press Stop any time.
            </p>
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
      <div className="flex items-center gap-3 px-5 py-3 border-b flex-shrink-0" style={{ borderColor: '#0E0E0E' }}>
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

        {/* Simulated clock (100x compression) + AI cost */}
        <div className="ml-4 flex items-center gap-3 px-3 py-1 rounded" style={{ background: '#0A0A0A', border: '1px solid #1E1E1E' }}>
          <div className="flex flex-col">
            <span className="text-[9px] font-mono tracking-widest" style={{ color: '#444' }}>SIM CLOCK</span>
            <span className="text-xs font-mono font-bold" style={{ color: '#C8A96E' }}>{formatSimulatedClock(simulatedMinutes)}</span>
          </div>
          <div className="h-6 w-px" style={{ background: '#1E1E1E' }} />
          <div className="flex flex-col">
            <span className="text-[9px] font-mono tracking-widest" style={{ color: '#444' }}>REAL LEFT</span>
            <span className="text-xs font-mono font-bold" style={{ color: realSecondsElapsed / 60 > maxRuntimeMinutes * 0.8 ? '#C84040' : '#6EC860' }}>
              {formatCountdown(realSecondsElapsed)}
            </span>
          </div>
          <div className="h-6 w-px" style={{ background: '#1E1E1E' }} />
          <div className="flex flex-col" title={`${totalTokens.toLocaleString()} tokens across ${apiCalls} AI calls · Llama 3.3 70B Turbo @ $${COST_USD_PER_MILLION_TOKENS}/M`}>
            <span className="text-[9px] font-mono tracking-widest" style={{ color: '#444' }}>AI COST</span>
            <span className="text-xs font-mono font-bold" style={{ color: '#6EC8E8' }}>
              ${((totalTokens / 1_000_000) * COST_USD_PER_MILLION_TOKENS).toFixed(4)} · £{((totalTokens / 1_000_000) * COST_USD_PER_MILLION_TOKENS * USD_TO_GBP).toFixed(4)}
            </span>
          </div>
          <div className="h-6 w-px" style={{ background: '#1E1E1E' }} />
          <div className="flex flex-col" title="Total AI token usage">
            <span className="text-[9px] font-mono tracking-widest" style={{ color: '#444' }}>TOKENS</span>
            <span className="text-xs font-mono font-bold" style={{ color: '#8888A0' }}>
              {totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : totalTokens} · {apiCalls}×
            </span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {allPersonas.map(p => (
            <div
              key={p.id}
              className="w-6 h-6 rounded-full flex items-center justify-center font-mono font-bold transition-all"
              title={`${p.name} · ${p.role}`}
              style={{
                fontSize: '8px',
                background: '#0D0D0D',
                border: `1.5px solid ${typingPersonas.some(t => t.persona.id === p.id) ? p.color : '#181818'}`,
                color: typingPersonas.some(t => t.persona.id === p.id) ? p.color : '#2A2A2A',
                boxShadow: typingPersonas.some(t => t.persona.id === p.id) ? `0 0 8px ${p.color}55` : 'none',
              }}
            >{p.initial}</div>
          ))}
          {isRunning && (
            <>
              <button
                onClick={() => setShowFacilitator(s => !s)}
                className="ml-2 px-3 py-1.5 rounded text-xs font-bold font-mono tracking-widest uppercase transition-all"
                style={{
                  background: showFacilitator ? '#2A1F0F' : 'transparent',
                  border: `1px solid ${showFacilitator ? '#E8A040' : '#2E2E2E'}`,
                  color: showFacilitator ? '#E8A040' : '#888',
                }}
              >◐ FACILITATOR</button>
              <button
                onClick={togglePause}
                className="px-3 py-1.5 rounded text-xs font-bold font-mono tracking-widest uppercase transition-all"
                style={{
                  background: isPaused ? '#1F1A08' : 'transparent',
                  border: `1px solid ${isPaused ? '#E8C547' : '#2E2E2E'}`,
                  color: isPaused ? '#E8C547' : '#888',
                }}
              >{isPaused ? '▶ RESUME' : '❚❚ PAUSE'}</button>
              <button
                onClick={() => { abortRef.current = true; pausedRef.current = false; setIsPaused(false); setIsRunning(false); }}
                className="ml-1 px-4 py-1.5 rounded text-xs font-bold font-mono tracking-widest uppercase transition-all hover:scale-105"
                style={{
                  background: '#C84040',
                  border: '1px solid #E85050',
                  color: '#FFF',
                  boxShadow: '0 0 12px #C8404055',
                }}
              >■ STOP</button>
            </>
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

      {/* Threads layout: left-rail navigator + active thread pane (+ facilitator right panel when open) */}
      <div
        className="flex-1 min-h-0 grid"
        style={{ gridTemplateColumns: showFacilitator ? '240px 1fr 320px' : '240px 1fr' }}
      >

        {/* Left rail: thread list */}
        <div className="border-r overflow-y-auto" style={{ borderColor: '#0F0F0F', background: '#060606' }}>
          <div className="px-4 pt-4 pb-2">
            <div className="text-xs font-mono tracking-widest" style={{ color: '#333' }}>THREADS</div>
          </div>
          <div className="flex flex-col">
            {threadOrder.map(tid => {
              const t = threads[tid];
              if (!t) return null;
              const isActive = tid === activeThreadId;
              const unread = unreadThreads[tid] || 0;
              const statusColor = t.status === 'concluded' ? '#3E6850' : (t.kind === 'main' ? '#C84040' : '#E8A040');
              return (
                <button
                  key={tid}
                  onClick={() => setActiveThreadId(tid)}
                  className="flex items-start gap-2 px-4 py-3 text-left transition-all border-l-2"
                  style={{
                    background: isActive ? '#0C0C0C' : 'transparent',
                    borderLeftColor: isActive ? statusColor : 'transparent',
                    borderBottom: '1px solid #0C0C0C',
                  }}
                >
                  <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{
                    background: statusColor,
                    animation: t.status === 'active' ? 'rfPulse 1.2s ease-in-out infinite' : 'none',
                  }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold truncate" style={{ color: isActive ? '#E8E8E0' : '#999' }}>
                        {t.name}
                      </span>
                      {unread > 0 && !isActive && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: '#C84040', color: '#FFF' }}>
                          {unread}
                        </span>
                      )}
                    </div>
                    {t.kind === 'breakout' && t.topic && (
                      <div className="text-[10px] italic mt-0.5 line-clamp-1" style={{ color: '#555', fontFamily: 'Georgia, serif' }}>
                        {t.topic}
                      </div>
                    )}
                    <div className="flex items-center gap-1 mt-1">
                      {t.participantIds.slice(0, 5).map(pid => {
                        const p = allPersonas.find(a => a.id === pid);
                        if (!p) return null;
                        return (
                          <div key={pid} className="w-4 h-4 rounded-full flex items-center justify-center font-mono font-bold flex-shrink-0" style={{
                            fontSize: '7px', background: '#0A0A0A', border: `1px solid ${p.color}66`, color: p.color,
                          }}>{p.initial}</div>
                        );
                      })}
                      {t.participantIds.length > 5 && (
                        <span className="text-[9px] font-mono" style={{ color: '#444' }}>+{t.participantIds.length - 5}</span>
                      )}
                    </div>
                    {t.status === 'concluded' && (
                      <div className="text-[9px] font-mono mt-1" style={{ color: '#3E6850' }}>✓ concluded</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Active thread pane */}
        <div className="flex flex-col min-h-0">
          {/* Phase progress — only relevant for main thread */}
          {activeThreadId === 'main' && (
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
          )}

          {/* Breakout context bar */}
          {activeThreadId !== 'main' && threads[activeThreadId] && (
            <div className="px-5 py-3 border-b flex items-center gap-3 flex-shrink-0" style={{ borderColor: '#0F0F0F', background: '#0A0A0A' }}>
              <span className="text-xs font-mono tracking-widest" style={{ color: '#E8A040' }}>⊕ BREAKOUT</span>
              {threads[activeThreadId].topic && (
                <span className="text-xs" style={{ color: '#C8B090', fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
                  {threads[activeThreadId].topic}
                </span>
              )}
              <span className="ml-auto text-xs font-mono" style={{ color: '#444' }}>
                spawned T+{threads[activeThreadId].spawnedAtSimMin}m
              </span>
              {threads[activeThreadId].status === 'concluded' && (
                <span className="text-xs font-mono" style={{ color: '#6EC860' }}>✓ concluded</span>
              )}
            </div>
          )}

          {/* Messages for active thread */}
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-3">
            {(threads[activeThreadId]?.messages ?? []).map(msg => (
              <SimMessageRow key={msg.id} msg={msg} personas={allPersonas} />
            ))}
            {typingPersonas.filter(t => t.threadId === activeThreadId).length > 0 && (
              <TypingIndicators personas={typingPersonas.filter(t => t.threadId === activeThreadId).map(t => t.persona)} />
            )}
            {debriefLoading && (
              <div className="text-center py-6 text-xs font-mono tracking-widest" style={{ color: '#2E2E2E' }}>
                SIMULATION COMPLETE · GENERATING REPORT
              </div>
            )}
          </div>
        </div>

        {/* Facilitator panel (right side, toggled) */}
        {showFacilitator && (
          <div className="border-l overflow-y-auto flex flex-col" style={{ borderColor: '#1A1A1A', background: '#060606' }}>
            <div className="px-4 pt-4 pb-3 border-b" style={{ borderColor: '#1A1A1A' }}>
              <div className="text-xs font-mono tracking-widest mb-1" style={{ color: '#E8A040' }}>FACILITATOR CONTROL</div>
              <p className="text-xs leading-relaxed" style={{ color: '#555' }}>
                Steer the scenario in real time. Actions queue and land at the next safe point.
              </p>
              {isPaused && (
                <div className="mt-2 px-2 py-1 rounded text-xs font-mono tracking-wider" style={{ background: '#1F1A08', border: '1px solid #E8C547', color: '#E8C547' }}>
                  ❚❚ SIMULATION PAUSED
                </div>
              )}
            </div>

            {/* Inject event */}
            <div className="p-4 border-b" style={{ borderColor: '#0F0F0F' }}>
              <div className="text-xs font-mono tracking-widest mb-2" style={{ color: '#555' }}>INJECT EVENT</div>
              <textarea
                value={injectionText}
                onChange={e => setInjectionText(e.target.value)}
                placeholder="e.g. 'A journalist is at reception asking for the CEO by name'"
                className="w-full h-20 rounded p-2 text-xs resize-none leading-relaxed mb-2"
                style={{ background: '#0A0A0A', border: '1px solid #E8A04033', color: '#C8C8C0', fontFamily: 'Georgia, serif' }}
              />
              <button
                onClick={() => {
                  if (!injectionText.trim()) return;
                  enqueueFacilitatorAction({ kind: 'inject_event', text: injectionText.trim() });
                  setInjectionText('');
                }}
                disabled={!injectionText.trim()}
                className="w-full py-2 rounded text-xs font-mono tracking-widest uppercase transition-all"
                style={{
                  background: injectionText.trim() ? '#E8A040' : '#111',
                  color: injectionText.trim() ? '#080808' : '#2E2E2E',
                  border: 'none',
                  fontWeight: 'bold',
                }}
              >Queue Injection</button>
            </div>

            {/* Advance time */}
            <div className="p-4 border-b" style={{ borderColor: '#0F0F0F' }}>
              <div className="text-xs font-mono tracking-widest mb-2" style={{ color: '#555' }}>ADVANCE SIMULATED CLOCK</div>
              <div className="grid grid-cols-4 gap-1.5">
                {[30, 60, 120, 240].map(m => (
                  <button
                    key={m}
                    onClick={() => enqueueFacilitatorAction({ kind: 'advance_time', minutes: m })}
                    className="py-1.5 rounded text-xs font-mono tracking-wider transition-all"
                    style={{ background: '#0A0A0A', border: '1px solid #2A2A2A', color: '#888' }}
                  >+{m >= 60 ? `${m / 60}h` : `${m}m`}</button>
                ))}
              </div>
            </div>

            {/* Summon external */}
            <div className="p-4 border-b" style={{ borderColor: '#0F0F0F' }}>
              <div className="text-xs font-mono tracking-widest mb-2" style={{ color: '#555' }}>SUMMON EXTERNAL</div>
              <div className="flex flex-col gap-1.5">
                {EXTERNAL_BENCH.map(bench => {
                  const alreadyIn = allPersonas.some(p => p.id === bench.id);
                  return (
                    <button
                      key={bench.id}
                      onClick={() => enqueueFacilitatorAction({ kind: 'summon_external', benchId: bench.id })}
                      disabled={alreadyIn}
                      className="flex items-center gap-2 px-2 py-1.5 rounded text-left transition-all"
                      style={{
                        background: alreadyIn ? '#080808' : '#0A0A0A',
                        border: `1px solid ${alreadyIn ? '#0F0F0F' : '#1A1A1A'}`,
                        opacity: alreadyIn ? 0.4 : 1,
                      }}
                    >
                      <div className="w-5 h-5 rounded-full flex items-center justify-center font-mono font-bold flex-shrink-0"
                        style={{ fontSize: '8px', background: '#080808', border: `1px solid ${bench.color}66`, color: bench.color }}>
                        {bench.initial}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold truncate" style={{ color: alreadyIn ? '#444' : '#C8C8C0' }}>{bench.name}</div>
                        <div className="text-[10px] font-mono truncate" style={{ color: bench.color, opacity: alreadyIn ? 0.3 : 0.6 }}>{bench.role}</div>
                      </div>
                      {alreadyIn && <span className="text-[9px] font-mono" style={{ color: '#6EC860' }}>IN</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Force breakout */}
            <div className="p-4 border-b" style={{ borderColor: '#0F0F0F' }}>
              <div className="text-xs font-mono tracking-widest mb-2" style={{ color: '#555' }}>FORCE BREAKOUT</div>
              <input
                value={forceBreakoutName}
                onChange={e => setForceBreakoutName(e.target.value)}
                placeholder="Breakout name"
                className="w-full px-2 py-1.5 rounded text-xs mb-2"
                style={{ background: '#0A0A0A', border: '1px solid #1A1A1A', color: '#C8C8C0' }}
              />
              <input
                value={forceBreakoutTopic}
                onChange={e => setForceBreakoutTopic(e.target.value)}
                placeholder="Topic"
                className="w-full px-2 py-1.5 rounded text-xs mb-2"
                style={{ background: '#0A0A0A', border: '1px solid #1A1A1A', color: '#C8C8C0' }}
              />
              <div className="text-[10px] font-mono mb-1.5" style={{ color: '#444' }}>Select at least 2 participants:</div>
              <div className="flex flex-wrap gap-1 mb-2 max-h-32 overflow-y-auto">
                {allPersonas.map(p => {
                  const selected = forceBreakoutParticipants.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => setForceBreakoutParticipants(prev =>
                        prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id]
                      )}
                      className="px-2 py-1 rounded text-xs font-mono"
                      style={{
                        background: selected ? `${p.color}18` : '#0A0A0A',
                        border: `1px solid ${selected ? p.color : '#1A1A1A'}`,
                        color: selected ? p.color : '#666',
                      }}
                    >{p.initial}</button>
                  );
                })}
              </div>
              <button
                onClick={() => {
                  if (forceBreakoutParticipants.length < 2 || !forceBreakoutName.trim() || !forceBreakoutTopic.trim()) return;
                  enqueueFacilitatorAction({
                    kind: 'force_breakout',
                    participantIds: forceBreakoutParticipants,
                    threadName: forceBreakoutName.trim(),
                    topic: forceBreakoutTopic.trim(),
                  });
                  setForceBreakoutParticipants([]);
                  setForceBreakoutName('');
                  setForceBreakoutTopic('');
                }}
                disabled={forceBreakoutParticipants.length < 2 || !forceBreakoutName.trim() || !forceBreakoutTopic.trim()}
                className="w-full py-2 rounded text-xs font-mono tracking-widest uppercase transition-all"
                style={{
                  background: (forceBreakoutParticipants.length >= 2 && forceBreakoutName.trim() && forceBreakoutTopic.trim()) ? '#C8A96E' : '#111',
                  color: (forceBreakoutParticipants.length >= 2 && forceBreakoutName.trim() && forceBreakoutTopic.trim()) ? '#080808' : '#2E2E2E',
                  border: 'none',
                  fontWeight: 'bold',
                }}
              >Queue Breakout</button>
            </div>

            {/* Recent structural events */}
            <div className="p-4 flex-1 overflow-y-auto">
              <div className="text-xs font-mono tracking-widest mb-2" style={{ color: '#555' }}>STRUCTURAL EVENTS</div>
              {orchestratorEvents.length === 0 ? (
                <p className="text-xs italic" style={{ color: '#333' }}>No structural moves yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {orchestratorEvents.slice().reverse().map(e => {
                    const isFacilitator = e.type.startsWith('facilitator_');
                    return (
                      <div key={e.id} className="text-xs leading-relaxed pl-2" style={{
                        borderLeft: `2px solid ${isFacilitator ? '#E8A040' : '#6EC8E8'}`,
                      }}>
                        <div className="font-mono" style={{ fontSize: '9px', color: isFacilitator ? '#E8A040' : '#6EC8E8' }}>
                          T+{e.atSimMin}m · {isFacilitator ? 'FACILITATOR' : 'ORCHESTRATOR'}
                        </div>
                        <div style={{ color: '#999' }}>{e.description}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
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
          <button
            onClick={() => {
              setView('setup');
              threadsRef.current = {};
              setThreads({});
              setThreadOrder([]);
              setActiveThreadId('main');
              setUnreadThreads({});
              setOrchestratorEvents([]);
              setDebrief(null);
              allPersonasRef.current = DEFAULT_PERSONAS;
              setAllPersonas(DEFAULT_PERSONAS);
            }}
            className="px-4 py-1.5 rounded text-xs font-mono"
            style={{ background: 'transparent', border: '1px solid #1E1E1E', color: '#444' }}
          >New Simulation</button>
        </div>
      </div>

      {!debrief ? (
        <div className="p-10 text-center text-xs font-mono tracking-widest" style={{ color: '#333' }}>GENERATING ANALYSIS...</div>
      ) : (
        <div className="p-8 flex flex-col gap-4">

          {/* Conversation shape — threads, breakouts, structural events */}
          <div className="p-5 rounded-lg" style={{ background: '#0D0D0D', border: '1px solid #1A1A1A' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs font-mono tracking-widest" style={{ color: '#444' }}>CONVERSATION SHAPE</div>
              <div className="text-xs font-mono" style={{ color: '#333' }}>
                {Object.keys(threads).length} threads · {orchestratorEvents.length} structural moves
              </div>
            </div>

            {/* Threads summary table */}
            <div className="mb-5">
              <div className="text-[10px] font-mono tracking-widest mb-2" style={{ color: '#555' }}>THREADS</div>
              <div className="flex flex-col gap-2">
                {threadOrder.map(tid => {
                  const t = threads[tid];
                  if (!t) return null;
                  const msgCount = t.messages.filter(m => m.type === 'message').length;
                  const durationMin = (t.concludedAtSimMin ?? simulatedMinutes) - t.spawnedAtSimMin;
                  return (
                    <div
                      key={tid}
                      className="p-3 rounded"
                      style={{
                        background: '#0A0A0A',
                        borderLeft: `3px solid ${t.kind === 'main' ? '#C84040' : t.status === 'concluded' ? '#3E6850' : '#E8A040'}`,
                      }}
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="text-xs font-bold" style={{ color: '#E0E0D8' }}>{t.name}</div>
                        <div className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{
                          background: t.kind === 'main' ? '#1A0808' : '#0F0A08',
                          color: t.kind === 'main' ? '#C84040' : '#E8A040',
                        }}>{t.kind.toUpperCase()}</div>
                        <div className="text-[10px] font-mono" style={{ color: '#555' }}>
                          T+{t.spawnedAtSimMin}m → {t.concludedAtSimMin !== undefined ? `T+${t.concludedAtSimMin}m (${durationMin}m)` : 'still open'}
                        </div>
                        <div className="text-[10px] font-mono ml-auto" style={{ color: '#555' }}>{msgCount} msgs</div>
                      </div>
                      {t.topic && (
                        <div className="mt-1 text-xs italic" style={{ color: '#888', fontFamily: 'Georgia, serif' }}>
                          {t.topic}
                        </div>
                      )}
                      <div className="mt-2 flex items-center gap-1 flex-wrap">
                        {t.participantIds.map(pid => {
                          const p = allPersonas.find(a => a.id === pid);
                          if (!p) return null;
                          return (
                            <div key={pid} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono"
                              style={{ background: '#080808', border: `1px solid ${p.color}44`, color: p.color }}>
                              {p.initial} {p.name.split(' ')[0]}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Structural events timeline */}
            <div>
              <div className="text-[10px] font-mono tracking-widest mb-2" style={{ color: '#555' }}>STRUCTURAL TIMELINE</div>
              {orchestratorEvents.length === 0 ? (
                <p className="text-xs italic" style={{ color: '#444' }}>
                  No breakouts, summons, or facilitator injections occurred. Conversation ran in the main room only.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {orchestratorEvents.map(e => {
                    const isFacilitator = e.type.startsWith('facilitator_');
                    const color = isFacilitator ? '#E8A040' : '#6EC8E8';
                    return (
                      <div key={e.id} className="flex items-start gap-3 text-xs">
                        <div className="font-mono flex-shrink-0" style={{ width: 70, color: '#555', fontSize: '10px' }}>
                          T+{e.atSimMin}m
                        </div>
                        <div className="font-mono flex-shrink-0" style={{ width: 90, color, fontSize: '10px' }}>
                          {isFacilitator ? '[FACILITATOR]' : '[ORCH]'}
                        </div>
                        <div className="flex-1" style={{ color: '#AAA' }}>{e.description}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

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
