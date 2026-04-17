'use client';

import { useState, useMemo } from 'react';
import { Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TestType {
  id: string;
  name: string;
  code: string;
  actionType: string;
}

interface TestBankEntry {
  id: string;
  firmId: string;
  industryId: string;
  fsLine: string;
  tests: { description: string; testTypeCode: string; assertion?: string; framework?: string; categories?: string[] }[];
}

interface Props {
  firmId: string;
  testBanks: TestBankEntry[];
  testTypes: TestType[];
  fsLines: string[];
  onSave: (updatedBanks: TestBankEntry[]) => void;
}

const TYPE_COLORS: Record<string, string> = {
  client_action: 'bg-blue-100 text-blue-700',
  ai_action: 'bg-purple-100 text-purple-700',
  team_action: 'bg-green-100 text-green-700',
};

export function TestBankGridView({ firmId, testBanks, testTypes, fsLines, onSave }: Props) {
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Collect ALL unique tests across all entries with their metadata
  const [testCategories, setTestCategories] = useState<Record<string, Set<string>>>(() => {
    const cats: Record<string, Set<string>> = {};
    for (const entry of testBanks) {
      for (const test of entry.tests || []) {
        const key = test.description;
        if (!cats[key]) cats[key] = new Set(test.categories || [entry.fsLine]);
        else {
          // Merge categories
          for (const c of (test.categories || [entry.fsLine])) cats[key].add(c);
        }
      }
    }
    return cats;
  });

  // Unique tests with metadata
  const allTests = useMemo(() => {
    const seen = new Map<string, { description: string; testTypeCode: string; assertion?: string; framework?: string; typeName: string; typeColor: string }>();
    for (const entry of testBanks) {
      for (const test of entry.tests || []) {
        if (!seen.has(test.description)) {
          const tt = testTypes.find(t => t.code === test.testTypeCode);
          seen.set(test.description, {
            ...test,
            typeName: tt?.name || test.testTypeCode,
            typeColor: TYPE_COLORS[tt?.actionType || ''] || 'bg-slate-100 text-slate-600',
          });
        }
      }
    }
    return Array.from(seen.values());
  }, [testBanks, testTypes]);

  function toggleCategory(testDesc: string, fsLine: string) {
    setTestCategories(prev => {
      const next = { ...prev };
      if (!next[testDesc]) next[testDesc] = new Set();
      const set = new Set(next[testDesc]);
      if (set.has(fsLine)) set.delete(fsLine);
      else set.add(fsLine);
      next[testDesc] = set;
      return next;
    });
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      // Rebuild test bank entries with updated categories
      const updated = testBanks.map(entry => ({
        ...entry,
        tests: (entry.tests || []).map(test => ({
          ...test,
          categories: Array.from(testCategories[test.description] || new Set()),
        })),
      }));

      // Save each entry
      for (const entry of updated) {
        await fetch('/api/methodology-admin/test-bank', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ firmId, industryId: entry.industryId, fsLine: entry.fsLine, tests: entry.tests }),
        });
      }
      onSave(updated);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  if (allTests.length === 0) {
    return <div className="text-center py-8 text-sm text-slate-400">No tests in the Test Bank yet.</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-slate-500">{allTests.length} tests × {fsLines.length} categories</p>
        {dirty && (
          <Button onClick={handleSave} size="sm" disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            Save Grid
          </Button>
        )}
      </div>

      <div className="border rounded-lg overflow-auto max-h-[calc(100vh-300px)]">
        <table className="text-[10px] border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <th className="text-left px-2 py-1.5 font-semibold text-slate-600 min-w-[250px] border-b border-r border-slate-200 sticky left-0 bg-slate-100 z-20">Test</th>
              <th className="text-left px-1 py-1.5 font-semibold text-slate-600 w-16 border-b border-r border-slate-200">Assertion</th>
              <th className="text-left px-1 py-1.5 font-semibold text-slate-600 w-16 border-b border-r border-slate-200">Type</th>
              {fsLines.map(fs => (
                <th key={fs} className="text-center px-1 py-1.5 font-semibold text-slate-600 border-b border-r border-slate-200 min-w-[60px]">
                  <span className="writing-mode-vertical" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap', display: 'inline-block', maxHeight: '80px', overflow: 'hidden', fontSize: '9px' }}>
                    {fs}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allTests.map((test, ti) => {
              const cats = testCategories[test.description] || new Set();
              return (
                <tr key={ti} className={`border-b border-slate-100 ${ti % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}>
                  <td className="px-2 py-1 text-slate-700 border-r border-slate-100 sticky left-0 bg-inherit z-10">
                    {test.description}
                  </td>
                  <td className="px-1 py-1 border-r border-slate-100">
                    {test.assertion && <span className="text-[8px] px-1 py-0 bg-blue-100 text-blue-600 rounded">{test.assertion}</span>}
                  </td>
                  <td className="px-1 py-1 border-r border-slate-100">
                    <span className={`text-[8px] px-1 py-0.5 rounded font-medium ${test.typeColor}`}>{test.typeName}</span>
                  </td>
                  {fsLines.map(fs => (
                    <td key={fs} className="text-center px-1 py-1 border-r border-slate-100">
                      <input
                        type="checkbox"
                        checked={cats.has(fs)}
                        onChange={() => toggleCategory(test.description, fs)}
                        className="w-3 h-3 rounded border-slate-300 cursor-pointer"
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
