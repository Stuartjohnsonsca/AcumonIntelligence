'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';

interface Props {
  engagementId: string;
  meetingType?: string;
  defaultMeetingType?: string;
  onEmailActions?: (meeting: Meeting) => void;
}

interface Attendee {
  name: string;
  role: string;
}

interface MeetingMinutes {
  summary: string;
  agenda: string[];
  decisions: { decision: string; madeBy: string }[];
  actionItems: { action: string; assignedTo: string; deadline: string | null }[];
  issues: { issue: string; raisedBy: string; status: string }[];
  keyDiscussions: { topic: string; points: string[] }[];
  nextSteps: string[];
}

interface Meeting {
  id: string;
  title: string;
  meetingDate: string;
  meetingType: string;
  attendees: Attendee[];
  source: string;
  hasTranscript: boolean;
  minutes: MeetingMinutes | null;
  minutesStatus: string;
  createdBy: string;
  createdAt: string;
  signOffs: Record<string, { userId: string; userName: string; timestamp: string }>;
}

interface TeamsMeeting {
  id: string;
  subject: string;
  startDateTime: string;
  endDateTime: string;
  participants: string[];
}

const MEETING_TYPES = ['planning', 'interim', 'final', 'other'] as const;
const TYPE_LABELS: Record<string, string> = { planning: 'Planning', interim: 'Interim', final: 'Final', other: 'Other' };
const TYPE_COLOURS: Record<string, string> = { planning: 'bg-blue-100 text-blue-700', interim: 'bg-amber-100 text-amber-700', final: 'bg-green-100 text-green-700', other: 'bg-slate-100 text-slate-600' };
const STATUS_LABELS: Record<string, string> = { draft: 'Draft', generated: 'AI Generated', reviewed: 'Reviewed', signed_off: 'Signed Off' };

function fmtDate(d: string) { try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return d; } }
function fmtDateTime(d: string) { try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return d; } }

const SIGN_OFF_ROLES = [
  { key: 'preparer', label: 'Preparer', teamRole: 'Junior' },
  { key: 'reviewer', label: 'Reviewer', teamRole: 'Manager' },
  { key: 'ri', label: 'RI', teamRole: 'RI' },
];

export function MeetingsPanel({ engagementId, meetingType: filterType, defaultMeetingType, onEmailActions }: Props) {
  const { data: session } = useSession();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [teamsEnabled, setTeamsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedMeeting, setSelectedMeeting] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showTeamsImport, setShowTeamsImport] = useState(false);
  const [teamsMeetings, setTeamsMeetings] = useState<TeamsMeeting[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);

  // Create form state
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));
  const [newType, setNewType] = useState<string>(defaultMeetingType || 'other');
  const [newAttendees, setNewAttendees] = useState('');
  const [newTranscript, setNewTranscript] = useState('');
  const [creating, setCreating] = useState(false);

  const loadMeetings = useCallback(async () => {
    try {
      const url = filterType
        ? `/api/engagements/${engagementId}/meetings?meetingType=${filterType}`
        : `/api/engagements/${engagementId}/meetings`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setMeetings(data.meetings || []);
        setTeamsEnabled(data.teamsEnabled || false);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [engagementId, filterType]);

  useEffect(() => { loadMeetings(); }, [loadMeetings]);

  const current = meetings.find(m => m.id === selectedMeeting);

  async function postAction(body: Record<string, unknown>) {
    return fetch(`/api/engagements/${engagementId}/meetings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  }

  async function handleCreate() {
    if (!newTitle.trim()) return;
    setCreating(true);
    const attendees = newAttendees.split(',').map(s => s.trim()).filter(Boolean).map(name => ({ name, role: '' }));
    const res = await postAction({ action: 'create', title: newTitle.trim(), meetingDate: newDate, meetingType: defaultMeetingType || newType, attendees, transcriptRaw: newTranscript || null });
    if (res.ok) {
      setNewTitle(''); setNewTranscript(''); setNewAttendees(''); setShowCreate(false);
      await loadMeetings();
    }
    setCreating(false);
  }

  async function handleGenerateMinutes(meetingId: string) {
    setGenerating(true);
    const res = await postAction({ action: 'generate_minutes', meetingId });
    if (res.ok) await loadMeetings();
    setGenerating(false);
  }

  async function handleFetchTeams() {
    setTeamsLoading(true);
    const res = await postAction({ action: 'fetch_teams' });
    if (res.ok) {
      const data = await res.json();
      setTeamsMeetings(data.teamsMeetings || []);
      setShowTeamsImport(true);
    }
    setTeamsLoading(false);
  }

  async function handleImportTeams(tm: TeamsMeeting) {
    const res = await postAction({ action: 'import_teams', eventId: tm.id, subject: tm.subject, startDateTime: tm.startDateTime, participants: tm.participants, meetingType: defaultMeetingType || undefined });
    if (res.ok) {
      setShowTeamsImport(false);
      await loadMeetings();
    }
  }

  function updateMinutesField(meetingId: string, path: string, value: unknown) {
    setMeetings(prev => prev.map(m => {
      if (m.id !== meetingId || !m.minutes) return m;
      const updated = { ...m.minutes, [path]: value };
      return { ...m, minutes: updated };
    }));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const meeting = meetings.find(m => m.id === meetingId);
      if (!meeting?.minutes) return;
      setSaving(true);
      await postAction({ action: 'save', meetingId, minutes: { ...meeting.minutes, [path]: value } });
      setSaving(false);
    }, 1500);
  }

  async function handleSignOff(meetingId: string, role: string) {
    const meeting = meetings.find(m => m.id === meetingId);
    if (!meeting) return;
    const existing = meeting.signOffs[role];
    const isUnsigning = existing?.userId === session?.user?.id;
    const res = await postAction({ action: isUnsigning ? 'unsignoff' : 'signoff', meetingId, role });
    if (res.ok) {
      const data = await res.json();
      setMeetings(prev => prev.map(m => m.id === meetingId ? { ...m, signOffs: data.signOffs } : m));
    }
  }

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading meetings...</div>;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700">
          Meetings <span className="text-xs font-normal text-slate-400 ml-1">{meetings.length}</span>
        </h3>
        <div className="flex gap-2">
          {teamsEnabled && (
            <button onClick={handleFetchTeams} disabled={teamsLoading}
              className="text-[10px] px-3 py-1.5 bg-violet-50 text-violet-600 border border-violet-200 rounded hover:bg-violet-100 disabled:opacity-50">
              {teamsLoading ? 'Loading...' : 'Import from Teams'}
            </button>
          )}
          <button onClick={() => setShowCreate(!showCreate)}
            className="text-[10px] px-3 py-1.5 bg-blue-50 text-blue-600 border border-blue-200 rounded hover:bg-blue-100">
            + New Meeting
          </button>
        </div>
      </div>

      {/* Teams import modal */}
      {showTeamsImport && (
        <div className="mb-4 border border-violet-200 rounded-lg p-3 bg-violet-50/30">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-violet-700">Recent Teams Meetings</p>
            <button onClick={() => setShowTeamsImport(false)} className="text-xs text-slate-400">Close</button>
          </div>
          {teamsMeetings.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No recent Teams meetings found</p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {teamsMeetings.map(tm => (
                <div key={tm.id} className="flex items-center justify-between px-2 py-1.5 bg-white rounded border border-slate-200">
                  <div>
                    <p className="text-xs font-medium text-slate-700">{tm.subject}</p>
                    <p className="text-[10px] text-slate-400">{fmtDateTime(tm.startDateTime)} | {tm.participants.length} participants</p>
                  </div>
                  <button onClick={() => handleImportTeams(tm)} className="text-[10px] px-2 py-1 bg-violet-600 text-white rounded hover:bg-violet-700">Import</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="mb-4 border border-blue-200 rounded-lg p-3 bg-blue-50/30">
          <div className="grid grid-cols-4 gap-3 mb-2">
            <div className="col-span-2">
              <label className="block text-[10px] text-slate-500 mb-0.5">Title *</label>
              <input value={newTitle} onChange={e => setNewTitle(e.target.value)} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5" placeholder="e.g. Planning Meeting with Client" />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-0.5">Date</label>
              <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5" />
            </div>
            {!defaultMeetingType && (
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Type</label>
                <select value={newType} onChange={e => setNewType(e.target.value)} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5">
                  {MEETING_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="mb-2">
            <label className="block text-[10px] text-slate-500 mb-0.5">Attendees (comma-separated)</label>
            <input value={newAttendees} onChange={e => setNewAttendees(e.target.value)} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5" placeholder="e.g. John Smith, Jane Doe" />
          </div>
          <div className="mb-2">
            <label className="block text-[10px] text-slate-500 mb-0.5">Transcript / Notes (paste here or leave blank)</label>
            <textarea value={newTranscript} onChange={e => setNewTranscript(e.target.value)} rows={4} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 resize-y" placeholder="Paste meeting transcript or type notes..." />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={!newTitle.trim() || creating} className="text-[10px] px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
              {creating ? 'Creating...' : 'Create Meeting'}
            </button>
            <button onClick={() => setShowCreate(false)} className="text-[10px] px-3 py-1.5 bg-slate-100 text-slate-600 rounded">Cancel</button>
          </div>
        </div>
      )}

      {/* Meeting list + detail */}
      <div className="space-y-2">
        {meetings.length === 0 ? (
          <div className="text-center py-12 border border-slate-200 rounded-lg">
            <p className="text-sm text-slate-400">No meetings recorded yet</p>
            <p className="text-xs text-slate-300 mt-1">Create a meeting or import from Teams</p>
          </div>
        ) : meetings.map(meeting => {
          const isExpanded = selectedMeeting === meeting.id;
          const mins = meeting.minutes;
          return (
            <div key={meeting.id} className="border border-slate-200 rounded-lg overflow-hidden">
              {/* Meeting row */}
              <div className="flex items-center px-3 py-2.5 hover:bg-slate-50/50 gap-3 cursor-pointer" onClick={() => setSelectedMeeting(isExpanded ? null : meeting.id)}>
                <span className={`text-[9px] px-2 py-0.5 rounded font-medium ${TYPE_COLOURS[meeting.meetingType] || TYPE_COLOURS.other}`}>
                  {TYPE_LABELS[meeting.meetingType] || meeting.meetingType}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-slate-700">{meeting.title}</span>
                  <span className="text-[10px] text-slate-400 ml-2">{fmtDate(meeting.meetingDate)}</span>
                </div>
                {meeting.source === 'teams' && <span className="text-[8px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded">Teams</span>}
                {meeting.hasTranscript && <span className="text-[8px] bg-teal-100 text-teal-600 px-1.5 py-0.5 rounded">Transcript</span>}
                <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                  meeting.minutesStatus === 'signed_off' ? 'bg-green-100 text-green-600' :
                  meeting.minutesStatus === 'generated' ? 'bg-blue-100 text-blue-600' :
                  'bg-slate-100 text-slate-500'
                }`}>{STATUS_LABELS[meeting.minutesStatus] || meeting.minutesStatus}</span>
                {/* Sign-off dots — cascade: a higher role's sign-off covers the lower roles visually. */}
                <div className="flex items-center gap-1">
                  {SIGN_OFF_ROLES.map(({ key }, idx) => {
                    // Effective signed: this role itself OR any role after it in the ordered list.
                    const effective = meeting.signOffs[key]
                      || SIGN_OFF_ROLES.slice(idx + 1).find(r => meeting.signOffs[r.key]);
                    return (
                      <span key={key} className={`w-2 h-2 rounded-full ${effective ? 'bg-green-500' : 'border border-slate-300'}`} />
                    );
                  })}
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-slate-200 px-4 py-3 bg-slate-50/30 space-y-4">
                  {/* Attendees */}
                  {meeting.attendees && (meeting.attendees as Attendee[]).length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {(meeting.attendees as Attendee[]).map((a, i) => (
                        <span key={i} className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded">{a.name}</span>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {meeting.hasTranscript && !mins && (
                      <button onClick={() => handleGenerateMinutes(meeting.id)} disabled={generating}
                        className="text-[10px] px-3 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50">
                        {generating ? 'Generating...' : 'Generate Minutes (AI)'}
                      </button>
                    )}
                    {mins && (
                      <button onClick={() => handleGenerateMinutes(meeting.id)} disabled={generating}
                        className="text-[10px] px-3 py-1.5 bg-slate-100 text-slate-600 rounded hover:bg-slate-200 disabled:opacity-50">
                        {generating ? 'Regenerating...' : 'Regenerate'}
                      </button>
                    )}
                    {saving && <span className="text-[10px] text-blue-500 animate-pulse">Saving...</span>}
                  </div>

                  {/* Minutes display */}
                  {mins && (
                    <div className="space-y-3">
                      {/* Summary */}
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Summary</label>
                        <textarea value={mins.summary || ''} onChange={e => updateMinutesField(meeting.id, 'summary', e.target.value)}
                          rows={2} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 resize-y" />
                      </div>

                      {/* Decisions */}
                      {mins.decisions?.length > 0 && (
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Decisions ({mins.decisions.length})</label>
                          <table className="w-full text-[10px] border border-slate-200 rounded overflow-hidden">
                            <thead><tr className="bg-slate-100"><th className="px-2 py-1 text-left text-slate-500">Decision</th><th className="px-2 py-1 text-left text-slate-500 w-32">Made By</th></tr></thead>
                            <tbody>
                              {mins.decisions.map((d, i) => (
                                <tr key={i} className="border-t border-slate-100">
                                  <td className="px-2 py-1 text-slate-700">{d.decision}</td>
                                  <td className="px-2 py-1 text-slate-500">{d.madeBy}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Action Items */}
                      {mins.actionItems?.length > 0 && (
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Action Items ({mins.actionItems.length})</label>
                          <table className="w-full text-[10px] border border-slate-200 rounded overflow-hidden">
                            <thead><tr className="bg-slate-100"><th className="px-2 py-1 text-left text-slate-500">Action</th><th className="px-2 py-1 text-left text-slate-500 w-28">Assigned To</th><th className="px-2 py-1 text-left text-slate-500 w-24">Deadline</th></tr></thead>
                            <tbody>
                              {mins.actionItems.map((a, i) => (
                                <tr key={i} className="border-t border-slate-100">
                                  <td className="px-2 py-1 text-slate-700">{a.action}</td>
                                  <td className="px-2 py-1 text-slate-500">{a.assignedTo}</td>
                                  <td className="px-2 py-1 text-slate-400">{a.deadline || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Issues */}
                      {mins.issues?.length > 0 && (
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Issues ({mins.issues.length})</label>
                          <table className="w-full text-[10px] border border-slate-200 rounded overflow-hidden">
                            <thead><tr className="bg-slate-100"><th className="px-2 py-1 text-left text-slate-500">Issue</th><th className="px-2 py-1 text-left text-slate-500 w-28">Raised By</th><th className="px-2 py-1 text-left text-slate-500 w-20">Status</th></tr></thead>
                            <tbody>
                              {mins.issues.map((iss, i) => (
                                <tr key={i} className="border-t border-slate-100">
                                  <td className="px-2 py-1 text-slate-700">{iss.issue}</td>
                                  <td className="px-2 py-1 text-slate-500">{iss.raisedBy}</td>
                                  <td className="px-2 py-1"><span className={`px-1.5 py-0.5 rounded text-[9px] ${iss.status === 'resolved' ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-600'}`}>{iss.status}</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Key Discussions */}
                      {mins.keyDiscussions?.length > 0 && (
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Key Discussions</label>
                          {mins.keyDiscussions.map((kd, i) => (
                            <div key={i} className="mb-2">
                              <p className="text-[10px] font-medium text-slate-600">{kd.topic}</p>
                              <ul className="ml-3 list-disc">
                                {kd.points.map((p, j) => <li key={j} className="text-[10px] text-slate-500">{p}</li>)}
                              </ul>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Next Steps */}
                      {mins.nextSteps?.length > 0 && (
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Next Steps</label>
                          <ul className="ml-3 list-disc">
                            {mins.nextSteps.map((s, i) => <li key={i} className="text-[10px] text-slate-600">{s}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {/* No minutes yet — show transcript if available */}
                  {!mins && meeting.hasTranscript && (
                    <div className="text-[10px] text-slate-400 italic">Transcript available. Click "Generate Minutes" to extract structured minutes.</div>
                  )}

                  {/* Email actions button */}
                  {onEmailActions && mins?.actionItems && mins.actionItems.length > 0 && (
                    <button onClick={() => onEmailActions(meeting)}
                      className="text-[10px] px-3 py-1.5 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded hover:bg-emerald-100">
                      Email Action Items ({mins.actionItems.length})
                    </button>
                  )}

                  {/* Sign-off bar */}
                  <div className="pt-3 border-t border-slate-200">
                    <div className="flex items-center gap-6">
                      {SIGN_OFF_ROLES.map(({ key, label }) => {
                        const so = meeting.signOffs[key];
                        const hasSigned = !!so?.timestamp;
                        return (
                          <div key={key} className="flex flex-col items-center gap-1">
                            <span className="text-[10px] text-slate-500 font-medium">{label}</span>
                            <button
                              onClick={() => handleSignOff(meeting.id, key)}
                              className={`w-5 h-5 rounded-full border-2 transition-all ${
                                hasSigned ? 'bg-green-500 border-green-500' : 'bg-white border-slate-300 hover:border-blue-400 cursor-pointer'
                              }`}
                              title={hasSigned ? `${so.userName} — ${new Date(so.timestamp).toLocaleString()}` : `Sign off as ${label}`}
                            />
                            {hasSigned && (
                              <div className="text-center">
                                <p className="text-[9px] text-slate-600">{so.userName}</p>
                                <p className="text-[8px] text-slate-400">{new Date(so.timestamp).toLocaleDateString('en-GB')}</p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
