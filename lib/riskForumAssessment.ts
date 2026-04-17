// Risk Forum — Personality Assessment pipeline
//
// Produces a behavioural profile of a real person that can be instantiated as
// a virtual agent in a Risk Forum simulation. The assessment is a hybrid:
//   1. A structured self-survey (~25 Likert/forced-choice questions across
//      seven crisis-behaviour dimensions — communication style under
//      pressure, decision-making, information handling, interpersonal
//      dynamics, emotional regulation, authority/escalation, rule adherence).
//   2. An AI-led behavioural interview that probes past high-stress events
//      using STAR-format questioning with adaptive follow-up.
//
// A synthesis step then takes both inputs and produces a structured profile
// with per-attribute source citations, suitable for regulator review.
//
// Storage:
//   - MVP: localStorage keyed by user email. Simple, session-persistent,
//     zero server footprint.
//   - Production: will move to Postgres (Prisma) with audit log, subject
//     right-of-reply, profile expiry, and confidence scoring UI.

// ── Survey questions ──────────────────────────────────────────────────────────

export type QuestionKind = 'likert' | 'forced_choice';

export interface LikertQuestion {
  id: string;
  kind: 'likert';
  dimension: AssessmentDimension;
  text: string;
  scale: 5 | 7;
  // Whether agreement indicates the high-pole behaviour (true) or low-pole (false)
  agreementIsHighPole: boolean;
}

export interface ForcedChoiceQuestion {
  id: string;
  kind: 'forced_choice';
  dimension: AssessmentDimension;
  text: string;
  options: { value: string; label: string; mapsTo: string }[];
}

export type SurveyQuestion = LikertQuestion | ForcedChoiceQuestion;

export type AssessmentDimension =
  | 'information_processing'
  | 'decision_style'
  | 'communication_under_stress'
  | 'interpersonal_dynamics'
  | 'emotional_regulation'
  | 'authority_escalation'
  | 'rule_adherence';

export const DIMENSION_LABELS: Record<AssessmentDimension, string> = {
  information_processing: 'Information processing',
  decision_style: 'Decision-making style',
  communication_under_stress: 'Communication under stress',
  interpersonal_dynamics: 'Interpersonal dynamics',
  emotional_regulation: 'Emotional regulation',
  authority_escalation: 'Authority and escalation',
  rule_adherence: 'Rule adherence and adaptation',
};

// 25 questions selected to surface crisis-relevant behaviour patterns.
// Mixed Likert (agreement scales) and forced-choice (scenario responses).
// Designed to avoid the standard "everyone describes themselves as decisive"
// trap by pairing positively-framed items with scenario-specific trade-offs.
export const SURVEY_QUESTIONS: SurveyQuestion[] = [
  // Information processing
  {
    id: 'ip1', kind: 'likert', dimension: 'information_processing', scale: 5, agreementIsHighPole: true,
    text: 'When facing a high-stakes decision with incomplete information, I prefer to gather more data before committing.',
  },
  {
    id: 'ip2', kind: 'likert', dimension: 'information_processing', scale: 5, agreementIsHighPole: true,
    text: 'I am comfortable acting on instinct when circumstances demand immediate action.',
  },
  {
    id: 'ip3', kind: 'forced_choice', dimension: 'information_processing',
    text: 'You receive a high-priority alert with ambiguous details. Your first move:',
    options: [
      { value: 'a', label: 'Pull up everything I can find myself before contacting anyone', mapsTo: 'analytical_solo' },
      { value: 'b', label: 'Call the person most likely to know the full picture', mapsTo: 'consultative' },
      { value: 'c', label: 'Make a provisional judgement and start moving; refine as I learn more', mapsTo: 'decisive_iterative' },
      { value: 'd', label: 'Convene a quick group to agree on a plan', mapsTo: 'consensus_first' },
    ],
  },
  {
    id: 'ip4', kind: 'likert', dimension: 'information_processing', scale: 5, agreementIsHighPole: false,
    text: 'I will change my mind readily when new information contradicts my earlier position.',
  },

  // Decision style
  {
    id: 'ds1', kind: 'likert', dimension: 'decision_style', scale: 5, agreementIsHighPole: true,
    text: 'I find it easier to make reversible decisions than irreversible ones.',
  },
  {
    id: 'ds2', kind: 'forced_choice', dimension: 'decision_style',
    text: 'A decision must be made now that has significant consequences either way. You:',
    options: [
      { value: 'a', label: 'Take the decision myself and own it', mapsTo: 'take_ownership' },
      { value: 'b', label: 'Make a recommendation and seek rapid sign-off from someone more senior', mapsTo: 'escalate_recommend' },
      { value: 'c', label: 'Split the decision into smaller steps and commit to the reversible ones first', mapsTo: 'incremental' },
      { value: 'd', label: 'Buy time to consult even at cost of delay', mapsTo: 'delay_consult' },
    ],
  },
  {
    id: 'ds3', kind: 'likert', dimension: 'decision_style', scale: 5, agreementIsHighPole: true,
    text: 'I am suspicious of decisions made without written documentation.',
  },

  // Communication under stress
  {
    id: 'cs1', kind: 'likert', dimension: 'communication_under_stress', scale: 5, agreementIsHighPole: false,
    text: 'My messages get longer and more detailed when I am under pressure.',
  },
  {
    id: 'cs2', kind: 'likert', dimension: 'communication_under_stress', scale: 5, agreementIsHighPole: true,
    text: 'I tend to go quieter rather than louder when a situation gets serious.',
  },
  {
    id: 'cs3', kind: 'forced_choice', dimension: 'communication_under_stress',
    text: 'In a fast-moving crisis, your preferred channel for coordinating with the leadership team:',
    options: [
      { value: 'a', label: 'Face-to-face or phone call only — too much in writing creates risk', mapsTo: 'ephemeral' },
      { value: 'b', label: 'Written channels so there is a record', mapsTo: 'documented' },
      { value: 'c', label: 'A mix — quick text updates, formal decisions in writing', mapsTo: 'hybrid' },
      { value: 'd', label: 'Whatever is fastest, I will normalise it afterwards', mapsTo: 'speed_first' },
    ],
  },
  {
    id: 'cs4', kind: 'likert', dimension: 'communication_under_stress', scale: 5, agreementIsHighPole: true,
    text: 'I am comfortable interrupting someone more senior if they are missing something important.',
  },

  // Interpersonal dynamics
  {
    id: 'id1', kind: 'likert', dimension: 'interpersonal_dynamics', scale: 5, agreementIsHighPole: true,
    text: 'I will directly challenge a colleague by name if I disagree with a decision in progress.',
  },
  {
    id: 'id2', kind: 'likert', dimension: 'interpersonal_dynamics', scale: 5, agreementIsHighPole: false,
    text: 'I prefer to raise disagreements privately rather than in front of the group.',
  },
  {
    id: 'id3', kind: 'forced_choice', dimension: 'interpersonal_dynamics',
    text: 'A colleague in the room is clearly overwhelmed and making errors. You:',
    options: [
      { value: 'a', label: 'Step in and take over their task without asking', mapsTo: 'take_over' },
      { value: 'b', label: 'Quietly offer help privately', mapsTo: 'private_support' },
      { value: 'c', label: 'Raise it in the room so the group can redistribute work', mapsTo: 'group_surface' },
      { value: 'd', label: 'Leave them to it — they will ask if they need help', mapsTo: 'respect_space' },
    ],
  },

  // Emotional regulation
  {
    id: 'er1', kind: 'likert', dimension: 'emotional_regulation', scale: 5, agreementIsHighPole: true,
    text: 'People who know me well can tell when I am stressed even if I am trying to hide it.',
  },
  {
    id: 'er2', kind: 'likert', dimension: 'emotional_regulation', scale: 5, agreementIsHighPole: false,
    text: 'My tone and energy stay consistent regardless of how serious the situation gets.',
  },
  {
    id: 'er3', kind: 'forced_choice', dimension: 'emotional_regulation',
    text: 'After a very high-stakes decision point, what do you typically need in the following hour:',
    options: [
      { value: 'a', label: 'Space on my own to process', mapsTo: 'solitude' },
      { value: 'b', label: 'A quick debrief with one trusted colleague', mapsTo: 'one_confidant' },
      { value: 'c', label: 'To keep working on the next thing without a pause', mapsTo: 'momentum' },
      { value: 'd', label: 'A proper group post-mortem, even briefly', mapsTo: 'group_debrief' },
    ],
  },

  // Authority and escalation
  {
    id: 'ae1', kind: 'likert', dimension: 'authority_escalation', scale: 5, agreementIsHighPole: true,
    text: 'I escalate early rather than late, even if it makes me look cautious.',
  },
  {
    id: 'ae2', kind: 'likert', dimension: 'authority_escalation', scale: 5, agreementIsHighPole: true,
    text: 'I am willing to take operational command in a crisis if no one else is doing so.',
  },
  {
    id: 'ae3', kind: 'forced_choice', dimension: 'authority_escalation',
    text: 'The CEO is out of contact for two hours during a live crisis. You:',
    options: [
      { value: 'a', label: 'Hold major decisions until they can be reached', mapsTo: 'hold_for_authority' },
      { value: 'b', label: 'Take decisions within my authority and brief them later', mapsTo: 'act_within_scope' },
      { value: 'c', label: 'Convene the remaining leadership team as an interim decision body', mapsTo: 'convene_interim' },
      { value: 'd', label: 'Depends entirely on the nature of the decisions required', mapsTo: 'situational' },
    ],
  },

  // Rule adherence
  {
    id: 'ra1', kind: 'likert', dimension: 'rule_adherence', scale: 5, agreementIsHighPole: true,
    text: 'I will follow a protocol even when I think a specific step is unnecessary in the moment.',
  },
  {
    id: 'ra2', kind: 'likert', dimension: 'rule_adherence', scale: 5, agreementIsHighPole: false,
    text: 'If a protocol is clearly not working, I will adapt it without waiting for sign-off.',
  },
  {
    id: 'ra3', kind: 'forced_choice', dimension: 'rule_adherence',
    text: 'You realise a standard notification requirement will cause significant operational harm if followed literally. You:',
    options: [
      { value: 'a', label: 'Follow it exactly and document the operational impact', mapsTo: 'strict' },
      { value: 'b', label: 'Seek an immediate variation from the person who owns the protocol', mapsTo: 'seek_variation' },
      { value: 'c', label: 'Interpret it narrowly and act on the interpretation', mapsTo: 'narrow_interpret' },
      { value: 'd', label: 'Defer the notification briefly to manage the impact, then comply', mapsTo: 'defer_comply' },
    ],
  },
];

// ── Profile schema ────────────────────────────────────────────────────────────

export interface ProfileAttribute {
  // A distilled behavioural trait (e.g. "hesitates on irreversible decisions").
  statement: string;
  // Rough confidence — 'high' means multiple independent signals, 'low' means single source only.
  confidence: 'high' | 'medium' | 'low';
  // Source citations that produced this attribute (survey question ids, interview quote, etc.)
  citations: ProfileCitation[];
}

export interface ProfileCitation {
  source: 'survey' | 'interview';
  // For survey: the question id. For interview: the paraphrase/quote.
  reference: string;
  evidence: string;
}

export interface AssessmentSurveyAnswers {
  likert: Record<string, number>;        // question id -> 1..5 or 1..7
  forcedChoice: Record<string, string>;  // question id -> option value
}

export interface AssessmentInterviewTurn {
  role: 'interviewer' | 'subject';
  text: string;
}

export interface AssessmentProfile {
  id: string;
  version: 1;
  createdAtIso: string;
  updatedAtIso: string;

  // Subject details
  subjectName: string;
  subjectRole: string;
  subjectFirm?: string;

  // The raw inputs — kept so the profile can be re-synthesised and audited.
  surveyAnswers: AssessmentSurveyAnswers;
  interviewTranscript: AssessmentInterviewTurn[];

  // The behavioural summary, suitable for the existing simulation persona format.
  behaviouralSummary: string;

  // Decomposed attributes with citations.
  attributes: ProfileAttribute[];

  // Per-dimension narrative paragraph for the detail view.
  dimensionNotes: Partial<Record<AssessmentDimension, string>>;

  // Internal housekeeping.
  schemaVersion: 1;
  displayColor?: string;
  displayInitials?: string;
}

// ── localStorage helpers ──────────────────────────────────────────────────────

const STORAGE_KEY = 'risk-forum-profiles-v1';

export function loadProfiles(): AssessmentProfile[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as AssessmentProfile[];
  } catch {
    return [];
  }
}

export function saveProfile(profile: AssessmentProfile) {
  if (typeof window === 'undefined') return;
  const all = loadProfiles().filter(p => p.id !== profile.id);
  all.push(profile);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function deleteProfile(id: string) {
  if (typeof window === 'undefined') return;
  const all = loadProfiles().filter(p => p.id !== id);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function getProfile(id: string): AssessmentProfile | null {
  return loadProfiles().find(p => p.id === id) ?? null;
}

// Generates a small display color + initials for the persona avatar.
export function avatarDetailsForName(name: string): { color: string; initials: string } {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() ?? '').join('') || '??';
  // Deterministic colour from name hash so re-renders are stable.
  const palette = ['#E8C547', '#6EC8E8', '#9EE87A', '#E87A9E', '#B87AE8', '#E8A06E', '#6EC860', '#C8A96E'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash) + name.charCodeAt(i);
  const color = palette[Math.abs(hash) % palette.length];
  return { color, initials };
}
