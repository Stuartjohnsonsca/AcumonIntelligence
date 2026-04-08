'use client';

import { useState } from 'react';
import { FileText, CheckCircle2 } from 'lucide-react';

const WALKTHROUGH_TABS = [
  { key: 'sales', label: 'Sales Process' },
  { key: 'purchases', label: 'Purchase Process' },
] as const;

type WalkthroughKey = typeof WALKTHROUGH_TABS[number]['key'];

interface Props {
  engagementId: string;
}

export function WalkthroughsTab({ engagementId }: Props) {
  const [activeTab, setActiveTab] = useState<WalkthroughKey>('sales');

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-800">Walkthroughs</h2>
        <p className="text-xs text-slate-400">Document the understanding of key business processes and identify controls</p>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
        {WALKTHROUGH_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeTab === tab.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <WalkthroughContent engagementId={engagementId} processKey={activeTab} processLabel={WALKTHROUGH_TABS.find(t => t.key === activeTab)?.label || ''} />
    </div>
  );
}

// ─── Walkthrough Content ───
// Each process walkthrough has: narrative, controls identified, risks, and sign-off

function WalkthroughContent({ engagementId, processKey, processLabel }: { engagementId: string; processKey: string; processLabel: string }) {
  const [narrative, setNarrative] = useState('');
  const [controls, setControls] = useState<{ description: string; type: string; frequency: string; tested: boolean }[]>([]);
  const [saving, setSaving] = useState(false);

  // Load saved data
  useState(() => {
    fetch(`/api/engagements/${engagementId}/permanent-file?section=walkthrough_${processKey}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.answers) {
          setNarrative(data.answers.narrative || '');
          setControls(data.answers.controls || []);
        }
      }).catch(() => {});
  });

  async function save() {
    setSaving(true);
    try {
      await fetch(`/api/engagements/${engagementId}/permanent-file`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: `walkthrough_${processKey}`, answers: { narrative, controls } }),
      });
    } catch {} finally { setSaving(false); }
  }

  function addControl() {
    setControls(prev => [...prev, { description: '', type: 'Manual', frequency: 'Per transaction', tested: false }]);
  }

  return (
    <div className="space-y-4">
      {/* Process Narrative */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-500" />
            <h3 className="text-sm font-semibold text-slate-700">{processLabel} — Narrative</h3>
          </div>
          <button onClick={save} disabled={saving} className="text-[10px] px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
        <p className="text-[10px] text-slate-400 mb-2">
          Document your understanding of the {processLabel.toLowerCase()} from initiation to recording.
          Include key personnel, systems, documents, and the flow of transactions.
        </p>
        <textarea
          value={narrative}
          onChange={e => setNarrative(e.target.value)}
          placeholder={`Describe the ${processLabel.toLowerCase()} end-to-end...\n\n1. How are transactions initiated?\n2. What authorisation is required?\n3. How are transactions recorded?\n4. What reconciliations are performed?\n5. What systems are used?`}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs min-h-[200px] focus:outline-none focus:border-blue-400 resize-y"
        />
      </div>

      {/* Controls Identified */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-700">Controls Identified</h3>
          <button onClick={addControl} className="text-[10px] px-2.5 py-1 bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100">
            + Add Control
          </button>
        </div>
        {controls.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-4">No controls identified yet. Click "Add Control" to document controls in this process.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b text-[10px] text-slate-500 uppercase font-semibold">
                <th className="px-2 py-1.5 text-left">#</th>
                <th className="px-2 py-1.5 text-left">Control Description</th>
                <th className="px-2 py-1.5 text-left w-24">Type</th>
                <th className="px-2 py-1.5 text-left w-28">Frequency</th>
                <th className="px-2 py-1.5 text-center w-14">Tested</th>
                <th className="px-2 py-1.5 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {controls.map((ctrl, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                  <td className="px-2 py-1">
                    <input type="text" value={ctrl.description} onChange={e => { const c = [...controls]; c[i] = { ...c[i], description: e.target.value }; setControls(c); }}
                      className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400" placeholder="Describe the control..." />
                  </td>
                  <td className="px-2 py-1">
                    <select value={ctrl.type} onChange={e => { const c = [...controls]; c[i] = { ...c[i], type: e.target.value }; setControls(c); }}
                      className="w-full border rounded px-1 py-1 text-xs">
                      <option>Manual</option>
                      <option>Automated</option>
                      <option>IT Dependent</option>
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <select value={ctrl.frequency} onChange={e => { const c = [...controls]; c[i] = { ...c[i], frequency: e.target.value }; setControls(c); }}
                      className="w-full border rounded px-1 py-1 text-xs">
                      <option>Per transaction</option>
                      <option>Daily</option>
                      <option>Weekly</option>
                      <option>Monthly</option>
                      <option>Quarterly</option>
                      <option>Annually</option>
                    </select>
                  </td>
                  <td className="px-2 py-1 text-center">
                    <button onClick={() => { const c = [...controls]; c[i] = { ...c[i], tested: !c[i].tested }; setControls(c); }}
                      className={`w-5 h-5 rounded-full border-2 mx-auto flex items-center justify-center ${ctrl.tested ? 'bg-green-500 border-green-500' : 'border-slate-300 hover:border-green-400'}`}>
                      {ctrl.tested && <CheckCircle2 className="h-3 w-3 text-white" />}
                    </button>
                  </td>
                  <td className="px-2 py-1">
                    <button onClick={() => setControls(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 text-xs">x</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
