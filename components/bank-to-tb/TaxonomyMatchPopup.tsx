'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Check, X, AlertTriangle, Sparkles } from 'lucide-react';
import { useBankToTB } from './BankToTBContext';

interface MatchProposal {
  rowIndex: number;
  currentCode: string;
  currentName: string;
  proposedCode: string;
  proposedName: string;
  confidence: number;
  accepted: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
}

export function TaxonomyMatchPopup({ isOpen, onClose, sessionId }: Props) {
  const { state, dispatch } = useBankToTB();
  const [matching, setMatching] = useState(false);
  const [proposals, setProposals] = useState<MatchProposal[]>([]);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const framework = state.accountingFramework;

  useEffect(() => {
    if (isOpen && framework) {
      runMatch();
    }
  }, [isOpen]);

  async function runMatch() {
    if (!framework) return;
    setMatching(true);
    setError(null);
    setProposals([]);

    try {
      // Send current TB account codes + names to AI for matching
      const tbRows = state.trialBalance.map((tb, i) => ({
        index: i,
        accountCode: tb.accountCode,
        accountName: tb.accountName,
        categoryType: tb.categoryType,
      }));

      const res = await fetch('/api/bank-to-tb/taxonomy-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          framework,
          accounts: tbRows,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const matches: MatchProposal[] = (data.matches || []).map((m: any) => ({
        rowIndex: m.index,
        currentCode: m.currentCode,
        currentName: m.currentName,
        proposedCode: m.proposedCode,
        proposedName: m.proposedName,
        confidence: m.confidence || 0,
        accepted: m.proposedCode !== m.currentCode, // Pre-accept if there's a change
      }));

      // Only show rows where there's a proposed change
      setProposals(matches.filter(m => m.proposedCode !== m.currentCode));
    } catch (err: any) {
      setError(err.message || 'Failed to match accounts');
    } finally {
      setMatching(false);
    }
  }

  function toggleAccept(index: number) {
    setProposals(prev => prev.map((p, i) => i === index ? { ...p, accepted: !p.accepted } : p));
  }

  function acceptAll() {
    setProposals(prev => prev.map(p => ({ ...p, accepted: true })));
  }

  function rejectAll() {
    setProposals(prev => prev.map(p => ({ ...p, accepted: false })));
  }

  async function applyChanges() {
    setApplying(true);
    try {
      const accepted = proposals.filter(p => p.accepted);
      if (accepted.length === 0) {
        onClose();
        return;
      }

      // Update the trial balance entries via API
      const updates = accepted.map(p => ({
        id: state.trialBalance[p.rowIndex]?.id,
        accountCode: p.proposedCode,
      }));

      const res = await fetch('/api/bank-to-tb/taxonomy-match', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, updates }),
      });

      if (res.ok) {
        // Update local state
        const updatedTB = state.trialBalance.map((tb, i) => {
          const match = accepted.find(a => a.rowIndex === i);
          if (match) {
            return { ...tb, accountCode: match.proposedCode };
          }
          return tb;
        });
        dispatch({ type: 'SET_TRIAL_BALANCE', payload: updatedTB });
      }

      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to apply changes');
    } finally {
      setApplying(false);
    }
  }

  if (!isOpen) return null;

  const acceptedCount = proposals.filter(p => p.accepted).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-3xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
            <h3 className="text-base font-semibold text-slate-900">AI Taxonomy Matching</h3>
            {framework && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{framework}</span>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {!framework && (
            <div className="text-center py-8">
              <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-2" />
              <p className="text-sm text-slate-700 font-medium">No Accounting Framework selected</p>
              <p className="text-xs text-slate-500 mt-1">Select a framework from the top bar before matching.</p>
            </div>
          )}

          {matching && (
            <div className="text-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500 mx-auto mb-3" />
              <p className="text-sm text-slate-600">Analysing {state.trialBalance.length} account codes...</p>
              <p className="text-xs text-slate-400 mt-1">AI is matching your accounts to the {framework} taxonomy</p>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-4">
              {error}
            </div>
          )}

          {!matching && proposals.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-slate-500">
                  {proposals.length} proposed change{proposals.length !== 1 ? 's' : ''} • {acceptedCount} accepted
                </p>
                <div className="flex gap-2">
                  <button onClick={acceptAll} className="text-xs text-green-600 hover:text-green-800 font-medium">Accept All</button>
                  <button onClick={rejectAll} className="text-xs text-red-600 hover:text-red-800 font-medium">Reject All</button>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="w-8 px-2 py-2"></th>
                      <th className="text-left px-3 py-2 text-slate-600 font-semibold">Account Name</th>
                      <th className="text-left px-3 py-2 text-slate-600 font-semibold">Current Code</th>
                      <th className="text-center px-2 py-2 text-slate-400">→</th>
                      <th className="text-left px-3 py-2 text-slate-600 font-semibold">Proposed Code</th>
                      <th className="text-right px-3 py-2 text-slate-600 font-semibold w-20">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposals.map((p, i) => (
                      <tr key={i} className={`border-b border-slate-50 ${p.accepted ? 'bg-green-50/30' : 'bg-slate-50/30 opacity-60'}`}>
                        <td className="px-2 py-2 text-center">
                          <input type="checkbox" checked={p.accepted} onChange={() => toggleAccept(i)}
                            className="w-3.5 h-3.5 rounded border-slate-300 text-green-600 focus:ring-green-400" />
                        </td>
                        <td className="px-3 py-2 text-slate-700 font-medium">{p.currentName}</td>
                        <td className="px-3 py-2 font-mono text-slate-500">{p.currentCode}</td>
                        <td className="px-2 py-2 text-center text-slate-300">→</td>
                        <td className="px-3 py-2 font-mono text-blue-700 font-medium">{p.proposedCode}</td>
                        <td className="px-3 py-2 text-right">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            p.confidence >= 0.8 ? 'bg-green-100 text-green-700' :
                            p.confidence >= 0.5 ? 'bg-amber-100 text-amber-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {Math.round(p.confidence * 100)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {!matching && proposals.length === 0 && !error && framework && (
            <div className="text-center py-8 text-sm text-slate-400">
              No changes proposed — all account codes already match the taxonomy.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {proposals.length > 0 && (
            <Button onClick={applyChanges} disabled={applying || acceptedCount === 0}
              className="bg-green-600 hover:bg-green-700">
              {applying ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
              Apply {acceptedCount} Change{acceptedCount !== 1 ? 's' : ''}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
