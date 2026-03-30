'use client';

import { useState } from 'react';
import { X, Loader2, Search, MapPin, Home, AlertCircle } from 'lucide-react';

interface LandRegistryResult {
  transactionId: string;
  pricePaid: number | null;
  transactionDate: string;
  propertyType: string;
  estateType: string;
  newBuild: boolean;
  address: {
    paon: string;
    saon: string;
    street: string;
    locality: string;
    town: string;
    district: string;
    county: string;
    postcode: string;
  };
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  action: 'verify_ownership' | 'price_paid';
  clientId?: string;
  clientName?: string;
}

export function LandRegistryPopup({ isOpen, onClose, action, clientId, clientName }: Props) {
  const [paon, setPaon] = useState('');
  const [street, setStreet] = useState('');
  const [town, setTown] = useState('');
  const [postcode, setPostcode] = useState('');
  const [county, setCounty] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<LandRegistryResult[]>([]);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  if (!isOpen) return null;

  async function handleSearch() {
    if (!postcode && !street) {
      setError('Please enter at least a postcode or street name.');
      return;
    }
    setSearching(true);
    setError('');
    setResults([]);
    try {
      const res = await fetch('/api/land-registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          address: { paon, street, town, postcode, county },
          clientId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed');
      setResults(data.results || []);
      setSearched(true);
      if (data.results?.length === 0) {
        setError('No records found. Try broadening your search (e.g. just postcode and street).');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    }
    setSearching(false);
  }

  const title = action === 'verify_ownership' ? 'Verify Ownership at Land Registry' : 'Verify Purchase Price at Land Registry';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>

        {/* Address form */}
        <div className="px-5 py-4 space-y-3 border-b border-slate-100">
          {clientName && (
            <p className="text-xs text-slate-500">Client: <strong>{clientName}</strong></p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Building Name / Number</label>
              <input
                type="text" value={paon} onChange={e => setPaon(e.target.value)}
                placeholder="e.g. 42 or Maple House"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Street *</label>
              <input
                type="text" value={street} onChange={e => setStreet(e.target.value)}
                placeholder="e.g. High Street"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Town / City</label>
              <input
                type="text" value={town} onChange={e => setTown(e.target.value)}
                placeholder="e.g. London"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Postcode *</label>
              <input
                type="text" value={postcode} onChange={e => setPostcode(e.target.value)}
                placeholder="e.g. SW1A 1AA"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">County (optional)</label>
            <input
              type="text" value={county} onChange={e => setCounty(e.target.value)}
              placeholder="e.g. Greater London"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSearch}
              disabled={searching || (!postcode && !street)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search Land Registry
            </button>
            {error && (
              <span className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {error}
              </span>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!searched && !searching && (
            <div className="text-center py-8">
              <Home className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Enter property address details above and search.</p>
              <p className="text-[10px] text-slate-400 mt-1">Data from HM Land Registry Price Paid records (England &amp; Wales)</p>
            </div>
          )}

          {searched && results.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-3">{results.length} record{results.length !== 1 ? 's' : ''} found</p>
              <div className="space-y-2">
                {results.map((r, i) => (
                  <div key={r.transactionId || i} className="border border-slate-200 rounded-lg p-3 hover:bg-slate-50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-800">
                          {[r.address.paon, r.address.saon].filter(Boolean).join(', ')}
                          {r.address.street && ` ${r.address.street}`}
                        </p>
                        <p className="text-xs text-slate-500">
                          {[r.address.locality, r.address.town, r.address.district, r.address.county, r.address.postcode].filter(Boolean).join(', ')}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-slate-900">
                          {r.pricePaid != null ? `£${r.pricePaid.toLocaleString()}` : '—'}
                        </p>
                        <p className="text-[10px] text-slate-400">{r.transactionDate}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      {r.propertyType && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{r.propertyType}</span>
                      )}
                      {r.estateType && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-600">{r.estateType}</span>
                      )}
                      {r.newBuild && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">New Build</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex justify-between items-center">
          <p className="text-[10px] text-slate-400">Source: HM Land Registry Price Paid Data (OGL)</p>
          <button onClick={onClose} className="px-4 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-md hover:bg-slate-200">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
