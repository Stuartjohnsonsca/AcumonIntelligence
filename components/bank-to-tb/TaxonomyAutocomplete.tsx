'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';

interface Props {
  value: string;
  onSelect: (code: string, name: string) => void;
  framework: string | null;
  chartOfAccounts: { accountCode: string; accountName: string; categoryType: string }[];
  placeholder?: string;
  className?: string;
}

interface SearchResult {
  id: number;
  name: string;
  label: string;
  source: 'coa' | 'xbrl';
}

/**
 * Autocomplete input that searches both the firm's Chart of Accounts
 * and the XBRL taxonomy for the selected accounting framework.
 */
export function TaxonomyAutocomplete({ value, onSelect, framework, chartOfAccounts, placeholder, className }: Props) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Sync external value changes
  useEffect(() => { setQuery(value); }, [value]);

  const search = useCallback(async (q: string) => {
    if (!q || q.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const lowerQ = q.toLowerCase();
    const combined: SearchResult[] = [];

    // Search Chart of Accounts locally (instant)
    const coaMatches = chartOfAccounts.filter(a =>
      a.accountCode.toLowerCase().includes(lowerQ) || a.accountName.toLowerCase().includes(lowerQ)
    ).slice(0, 10);

    for (const a of coaMatches) {
      combined.push({ id: 0, name: a.accountCode, label: `${a.accountCode} - ${a.accountName}`, source: 'coa' });
    }

    // Search XBRL taxonomy (async)
    if (framework) {
      setSearching(true);
      try {
        const res = await fetch(`/api/firm/taxonomy/xbrl?action=search&framework=${framework}&q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          const xbrlMatches = (data.concepts || []).slice(0, 15);
          for (const c of xbrlMatches) {
            // Avoid duplicates
            if (!combined.some(r => r.name === c.name)) {
              combined.push({ id: c.id, name: c.name, label: c.label || c.name, source: 'xbrl' });
            }
          }
        }
      } catch { /* non-fatal */ }
      setSearching(false);
    }

    setResults(combined);
    setIsOpen(combined.length > 0);
    setHighlightIdx(0);
  }, [framework, chartOfAccounts]);

  function handleInputChange(q: string) {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q), 250);
  }

  function handleSelect(result: SearchResult) {
    setQuery(result.source === 'coa' ? result.name.split(' - ')[0] : result.name);
    onSelect(result.name, result.label);
    setIsOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[highlightIdx]) handleSelect(results[highlightIdx]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  }

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => handleInputChange(e.target.value)}
        onFocus={() => { if (results.length > 0) setIsOpen(true); }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || 'Type to search accounts...'}
        className={className || 'w-full border border-slate-200 rounded px-2 py-1 text-xs'}
      />
      {searching && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2">
          <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
        </div>
      )}

      {isOpen && results.length > 0 && (
        <div ref={dropdownRef}
          className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {results.map((r, i) => (
            <button
              key={`${r.source}-${r.name}-${i}`}
              className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${
                i === highlightIdx ? 'bg-blue-50 text-blue-800' : 'hover:bg-slate-50 text-slate-700'
              }`}
              onClick={() => handleSelect(r)}
              onMouseEnter={() => setHighlightIdx(i)}
            >
              <span className={`text-[9px] px-1 py-0.5 rounded flex-shrink-0 ${
                r.source === 'coa' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'
              }`}>
                {r.source === 'coa' ? 'CoA' : 'XBRL'}
              </span>
              <span className="truncate">{r.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
