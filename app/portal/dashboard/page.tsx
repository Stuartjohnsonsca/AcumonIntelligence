'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ClipboardCheck, Calculator, Briefcase, Receipt, Monitor,
  Users, Plus, Trash2, Loader2, Calendar, Check, ChevronDown, ChevronRight,
  ShieldCheck, AlertTriangle, ArrowRight,
} from 'lucide-react';

interface PrincipalEngagementSummary {
  id: string;
  clientName: string;
  auditType: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  setupCompletedAt?: string | null;
}

interface PortalUser {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  isClientAdmin: boolean;
  role: string | null;
  allocatedPeriodIds: string[] | null;
  allocatedServices: string[] | null;
}

interface ClientInfo { id: string; clientName: string; isClientAdmin: boolean; }
interface PeriodInfo { id: string; startDate: string; endDate: string; engagementId: string; }

const SERVICE_TILES = [
  { key: 'audit', title: 'Audit Client Support', description: 'View and respond to audit evidence requests, upload documents, and track progress.', href: '/portal/audit', icon: ClipboardCheck, color: 'bg-blue-50 border-blue-200 hover:bg-blue-100 hover:border-blue-400', iconColor: 'text-blue-600', iconBg: 'bg-blue-100' },
  { key: 'accounting', title: 'Accounting Support', description: 'Get help with bookkeeping, financial reporting, and accounting queries.', href: '/portal/accounting', icon: Calculator, color: 'bg-teal-50 border-teal-200 hover:bg-teal-100 hover:border-teal-400', iconColor: 'text-teal-600', iconBg: 'bg-teal-100' },
  { key: 'consulting', title: 'Consulting Support', description: 'Business advisory, strategy, and operational improvement assistance.', href: '/portal/consulting', icon: Briefcase, color: 'bg-purple-50 border-purple-200 hover:bg-purple-100 hover:border-purple-400', iconColor: 'text-purple-600', iconBg: 'bg-purple-100' },
  { key: 'tax', title: 'Tax Support', description: 'Tax planning, compliance, VAT queries, and tax return assistance.', href: '/portal/tax', icon: Receipt, color: 'bg-amber-50 border-amber-200 hover:bg-amber-100 hover:border-amber-400', iconColor: 'text-amber-600', iconBg: 'bg-amber-100' },
  { key: 'technology', title: 'Technology Support', description: 'IT systems, software, digital transformation, and tech infrastructure help.', href: '/portal/technology', icon: Monitor, color: 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100 hover:border-indigo-400', iconColor: 'text-indigo-600', iconBg: 'bg-indigo-100' },
];

function formatPeriod(p: PeriodInfo) {
  const f = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return `${f(p.startDate)} \u2013 ${f(p.endDate)}`;
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const [activeTab, setActiveTab] = useState<'services' | 'team'>('services');
  const [isAdmin, setIsAdmin] = useState(false);

  // Portal Principal state — drives the "Finish setup" banner and
  // per-engagement setup links at the top of the dashboard.
  const [principalFor, setPrincipalFor] = useState<PrincipalEngagementSummary[]>([]);

  // Team management state
  const [clients, setClients] = useState<ClientInfo[]>([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [teamMembers, setTeamMembers] = useState<PortalUser[]>([]);
  const [periods, setPeriods] = useState<PeriodInfo[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState('');
  const [adding, setAdding] = useState(false);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  // Load Portal Principal state — surfaces the "Finish setup" banner
  // when this user is the Portal Principal for one or more engagements.
  useEffect(() => {
    if (!token) return;
    fetch(`/api/portal/my-engagements?token=${token}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.principalFor) setPrincipalFor(data.principalFor); })
      .catch(() => {});
  }, [token]);

  // Load user info to check admin status
  useEffect(() => {
    if (!token) return;
    fetch(`/api/portal/my-details?token=${token}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.clients) {
          setClients(data.clients);
          const adminClient = data.clients.find((c: ClientInfo) => c.isClientAdmin);
          if (adminClient) {
            setIsAdmin(true);
            setSelectedClientId(adminClient.id);
          } else if (data.clients.length > 0) {
            setSelectedClientId(data.clients[0].id);
          }
        }
      })
      .catch(() => {});
  }, [token]);

  // Load team when client selected
  useEffect(() => {
    if (!selectedClientId || activeTab !== 'team') return;
    setTeamLoading(true);
    Promise.all([
      fetch(`/api/portal/users?clientId=${selectedClientId}`).then(r => r.ok ? r.json() : []),
      fetch(`/api/portal/periods?token=${token}&clientId=${selectedClientId}`).then(r => r.ok ? r.json() : { periods: [] }),
    ]).then(([users, pData]) => {
      setTeamMembers(Array.isArray(users) ? users : []);
      setPeriods(pData.periods || []);
    }).catch(() => {}).finally(() => setTeamLoading(false));
  }, [selectedClientId, activeTab, token]);

  async function handleAdd() {
    if (!addName || !addEmail) return;
    setAdding(true); setMsg('');
    try {
      const res = await fetch('/api/portal/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: selectedClientId, name: addName, email: addEmail, role: addRole || null }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed'); }
      setMsg(`Access created for ${addEmail}`);
      setAddName(''); setAddEmail(''); setAddRole('');
      const usersRes = await fetch(`/api/portal/users?clientId=${selectedClientId}`);
      if (usersRes.ok) setTeamMembers(await usersRes.json());
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Failed'); }
    setAdding(false);
  }

  async function handleRemove(email: string) {
    if (!confirm(`Remove ${email}?`)) return;
    await fetch('/api/portal/users', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: selectedClientId, email }) });
    setTeamMembers(prev => prev.filter(u => u.email !== email));
  }

  async function toggleService(userId: string, serviceKey: string, add: boolean) {
    const user = teamMembers.find(u => u.id === userId);
    if (!user) return;
    const current = user.allocatedServices || [];
    const updated = add ? [...current, serviceKey] : current.filter(k => k !== serviceKey);
    await fetch('/api/portal/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, allocatedServices: updated }) });
    setTeamMembers(prev => prev.map(u => u.id === userId ? { ...u, allocatedServices: updated } : u));
  }

  async function togglePeriod(userId: string, periodId: string, add: boolean) {
    const user = teamMembers.find(u => u.id === userId);
    if (!user) return;
    const current = user.allocatedPeriodIds || [];
    const updated = add ? [...current, periodId] : current.filter(id => id !== periodId);
    await fetch('/api/portal/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, allocatedPeriodIds: updated }) });
    setTeamMembers(prev => prev.map(u => u.id === userId ? { ...u, allocatedPeriodIds: updated } : u));
  }

  async function updateRole(userId: string, role: string) {
    await fetch('/api/portal/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, role: role || null }) });
    setTeamMembers(prev => prev.map(u => u.id === userId ? { ...u, role } : u));
  }

  const principalOutstanding = principalFor.filter(p => !p.setupCompletedAt);

  return (
    <div>
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Welcome to your Client Portal</h1>
        <p className="text-sm text-slate-500 mt-1">Manage your services and team</p>
      </div>

      {/* Portal Principal banner — surfaces engagements where this user */}
      {/* is the Portal Principal, with outstanding-setup ones highlighted. */}
      {principalFor.length > 0 && (
        <div className="max-w-4xl mx-auto mb-6 space-y-2">
          {principalOutstanding.length > 0 && (
            <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-800">
                    Portal Principal setup outstanding
                  </p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    You are the Portal Principal for {principalOutstanding.length} engagement{principalOutstanding.length === 1 ? '' : 's'}. Staff members cannot log in until you complete setup (staff list + work allocation + access confirmations).
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {principalOutstanding.map(e => (
                      <Link key={e.id} href={`/portal/setup/${e.id}?token=${token}`} className="inline-flex items-center gap-1 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 px-3 py-1.5 rounded-md">
                        Finish setup — {e.clientName}
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
          {principalFor.filter(p => p.setupCompletedAt).length > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              <div className="flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1 text-xs text-emerald-800">
                  You are the Portal Principal for {principalFor.filter(p => p.setupCompletedAt).length} active engagement{principalFor.filter(p => p.setupCompletedAt).length === 1 ? '' : 's'}.
                  <span className="ml-2">
                    {principalFor.filter(p => p.setupCompletedAt).map(e => (
                      <Link key={e.id} href={`/portal/setup/${e.id}?token=${token}`} className="text-emerald-700 hover:underline mr-3">Manage — {e.clientName}</Link>
                    ))}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex justify-center mb-8">
        <div className="flex bg-slate-100 rounded-lg p-0.5">
          <button onClick={() => setActiveTab('services')} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === 'services' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
            Services
          </button>
          {(
            <button onClick={() => setActiveTab('team')} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 ${activeTab === 'team' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
              <Users className="h-3.5 w-3.5" /> Team Management
            </button>
          )}
        </div>
      </div>

      {/* Services tab */}
      {activeTab === 'services' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {SERVICE_TILES.map((tile) => (
            <Link key={tile.href} href={`${tile.href}?token=${token}`} className={`group block p-8 rounded-xl border-2 transition-all shadow-sm hover:shadow-lg ${tile.color}`}>
              <div className={`inline-flex items-center justify-center w-14 h-14 rounded-xl ${tile.iconBg} mb-4 group-hover:scale-110 transition-transform`}>
                <tile.icon className={`h-7 w-7 ${tile.iconColor}`} />
              </div>
              <h2 className="text-lg font-semibold text-slate-900 mb-1">{tile.title}</h2>
              <p className="text-sm text-slate-600">{tile.description}</p>
            </Link>
          ))}
        </div>
      )}

      {/* Team Management tab */}
      {activeTab === 'team' && (
        <div className="max-w-4xl mx-auto">
          {/* Client selector if multiple */}
          {clients.filter(c => c.isClientAdmin).length > 1 && (
            <div className="flex items-center gap-2 mb-4">
              <label className="text-sm font-medium text-slate-600">Client:</label>
              <select value={selectedClientId} onChange={e => setSelectedClientId(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
                {clients.filter(c => c.isClientAdmin).map(c => <option key={c.id} value={c.id}>{c.clientName}</option>)}
              </select>
            </div>
          )}

          {teamLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
          ) : (
            <div className="space-y-3">
              {/* Team members */}
              {teamMembers.map(user => {
                const isExpanded = expandedUser === user.id;
                return (
                  <div key={user.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <button
                      onClick={() => setExpandedUser(isExpanded ? null : user.id)}
                      className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                          <span className="text-sm font-bold text-blue-600">{user.name?.[0]?.toUpperCase()}</span>
                        </div>
                        <div className="text-left">
                          <span className="text-sm font-medium text-slate-800">{user.name}</span>
                          <span className="text-xs text-slate-400 ml-2">{user.email}</span>
                        </div>
                        {user.role && <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">{user.role}</span>}
                        {user.isClientAdmin && <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded font-medium">Admin</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-400">
                          {(user.allocatedServices || []).length} services &middot; {(user.allocatedPeriodIds || []).length} periods
                        </span>
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-5 pb-4 border-t border-slate-100 pt-3 space-y-3">
                        {/* Role */}
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500 w-16">Role:</span>
                          <input type="text" value={user.role || ''} onBlur={e => updateRole(user.id, e.target.value)} onChange={e => setTeamMembers(prev => prev.map(u => u.id === user.id ? { ...u, role: e.target.value } : u))} placeholder="e.g. Finance Director" className="flex-1 text-xs border rounded px-2 py-1" />
                        </div>

                        {/* Service allocation */}
                        <div>
                          <span className="text-xs text-slate-500 font-medium block mb-1">Allocated Services</span>
                          <div className="flex flex-wrap gap-1.5">
                            {SERVICE_TILES.map(s => {
                              const allocated = (user.allocatedServices || []).includes(s.key);
                              return (
                                <button key={s.key} onClick={() => toggleService(user.id, s.key, !allocated)}
                                  className={`text-[10px] px-2.5 py-1 rounded-md border transition-colors ${allocated ? 'bg-blue-100 text-blue-700 border-blue-300' : 'bg-slate-50 text-slate-400 border-slate-200 hover:border-blue-300'}`}>
                                  {s.title}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Period allocation — only for Audit service */}
                        {periods.length > 0 && (user.allocatedServices || []).includes('audit') && (
                          <div>
                            <span className="text-xs text-slate-500 font-medium block mb-1">Audit Periods / Jobs</span>
                            <div className="flex flex-wrap gap-1.5">
                              {periods.map(p => {
                                const allocated = (user.allocatedPeriodIds || []).includes(p.id);
                                return (
                                  <button key={p.id} onClick={() => togglePeriod(user.id, p.id, !allocated)}
                                    className={`text-[10px] px-2.5 py-1 rounded-md border transition-colors flex items-center gap-1 ${allocated ? 'bg-green-100 text-green-700 border-green-300' : 'bg-slate-50 text-slate-400 border-slate-200 hover:border-green-300'}`}>
                                    <Calendar className="h-2.5 w-2.5" /> {formatPeriod(p)}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Remove */}
                        {isAdmin && (
                        <div className="flex justify-end pt-2 border-t">
                          <button onClick={() => handleRemove(user.email)} className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
                            <Trash2 className="h-3 w-3" /> Remove team member
                          </button>
                        </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {teamMembers.length === 0 && (
                <div className="text-center py-8 border rounded-xl">
                  <Users className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                  <p className="text-sm text-slate-500">No team members yet</p>
                </div>
              )}

              {/* Add team member — admin only */}
              {isAdmin && (
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <p className="text-xs font-semibold text-slate-700 mb-3 flex items-center gap-1"><Plus className="h-3.5 w-3.5" /> Add Team Member</p>
                <div className="flex gap-2 flex-wrap">
                  <input type="text" value={addName} onChange={e => setAddName(e.target.value)} placeholder="Name" className="flex-1 min-w-[120px] px-3 py-2 text-sm border rounded-lg" />
                  <input type="email" value={addEmail} onChange={e => setAddEmail(e.target.value)} placeholder="Email" className="flex-1 min-w-[150px] px-3 py-2 text-sm border rounded-lg" />
                  <input type="text" value={addRole} onChange={e => setAddRole(e.target.value)} placeholder="Role (optional)" className="flex-1 min-w-[120px] px-3 py-2 text-sm border rounded-lg" />
                  <button onClick={handleAdd} disabled={adding || !addName || !addEmail} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1">
                    {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
                  </button>
                </div>
                {msg && <p className="text-xs mt-2 text-green-600 flex items-center gap-1"><Check className="h-3 w-3" /> {msg}</p>}
                <p className="text-[10px] text-slate-400 mt-2">New members will receive a welcome email with login credentials. You can then allocate them to services and periods.</p>
              </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PortalDashboardPage() {
  return <Suspense><DashboardContent /></Suspense>;
}
