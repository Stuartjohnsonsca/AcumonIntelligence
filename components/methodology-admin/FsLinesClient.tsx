'use client';

import { useState, useMemo } from 'react';

interface FsLine {
  id: string;
  name: string;
  lineType: string;
  fsCategory: string;
  sortOrder: number;
  isActive: boolean;
  isMandatory: boolean;
  industryMappings: { industryId: string }[];
}

interface Industry {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;
}

interface Props {
  firmId: string;
  initialFsLines: FsLine[];
  initialIndustries: Industry[];
}

const LINE_TYPES = [
  { value: 'fs_line_item', label: 'FS Line Item' },
  { value: 'note_item', label: 'Note Item' },
];

const FS_CATEGORIES = [
  { value: 'pnl', label: 'P&L' },
  { value: 'balance_sheet', label: 'Balance Sheet' },
  { value: 'cashflow', label: 'Cashflow' },
  { value: 'notes', label: 'Notes' },
];

export function FsLinesClient({ firmId, initialFsLines, initialIndustries }: Props) {
  const [fsLines, setFsLines] = useState<FsLine[]>(initialFsLines);
  const [industries] = useState<Industry[]>(initialIndustries);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLineType, setNewLineType] = useState('fs_line_item');
  const [newCategory, setNewCategory] = useState('pnl');
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'list' | 'matrix'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editLineType, setEditLineType] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const sortedNonMandatory = useMemo(() => {
    return fsLines.filter(f => !f.isMandatory);
  }, [fsLines]);

  function sortByCategory() {
    const nonMandatory = fsLines.filter(f => !f.isMandatory);
    const catOrder: Record<string, number> = { pnl: 0, balance_sheet: 1, cashflow: 2, notes: 3 };
    const sorted = [...nonMandatory].sort((a, b) => {
      const ca = catOrder[a.fsCategory] ?? 99;
      const cb = catOrder[b.fsCategory] ?? 99;
      if (ca !== cb) return ca - cb;
      return a.sortOrder - b.sortOrder;
    });
    // Renumber and save
    const withOrder = sorted.map((line, i) => ({ ...line, sortOrder: i }));
    const mandatory = fsLines.filter(f => f.isMandatory);
    setFsLines([...mandatory, ...withOrder]);
    // Fire-and-forget save all new sort orders
    withOrder.forEach(line => {
      fetch('/api/methodology-admin/fs-lines', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: line.id, sortOrder: line.sortOrder }),
      }).catch(() => {});
    });
  }

  async function addFsLine() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/methodology-admin/fs-lines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), lineType: newLineType, fsCategory: newCategory }),
      });
      if (res.ok) {
        const { fsLine } = await res.json();
        setFsLines(prev => [...prev, fsLine]);
        setNewName(''); setShowAdd(false);
      }
    } finally { setSaving(false); }
  }

  async function updateFsLine(id: string, data: Partial<FsLine>) {
    const res = await fetch('/api/methodology-admin/fs-lines', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...data }),
    });
    if (res.ok) {
      const { fsLine } = await res.json();
      setFsLines(prev => prev.map(f => f.id === id ? fsLine : f));
    }
  }

  async function deleteFsLine(id: string) {
    const line = fsLines.find(f => f.id === id);
    if (line?.isMandatory) return;
    const res = await fetch('/api/methodology-admin/fs-lines', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.ok) setFsLines(prev => prev.filter(f => f.id !== id));
  }

  async function toggleIndustryMapping(fsLineId: string, industryId: string) {
    const line = fsLines.find(f => f.id === fsLineId);
    if (!line) return;
    const isEnabled = line.industryMappings.some(m => m.industryId === industryId);
    const res = await fetch('/api/methodology-admin/fs-lines/industry-mapping', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fsLineId, industryId, enabled: !isEnabled }),
    });
    if (res.ok) {
      setFsLines(prev => prev.map(f => {
        if (f.id !== fsLineId) return f;
        const mappings = isEnabled
          ? f.industryMappings.filter(m => m.industryId !== industryId)
          : [...f.industryMappings, { industryId }];
        return { ...f, industryMappings: mappings };
      }));
    }
  }

  function moveRow(index: number, direction: 'up' | 'down') {
    const nonMandatory = fsLines.filter(f => !f.isMandatory);
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= nonMandatory.length) return;

    const reordered = [...nonMandatory];
    [reordered[index], reordered[newIndex]] = [reordered[newIndex], reordered[index]];
    const withOrder = reordered.map((line, i) => ({ ...line, sortOrder: i }));
    const mandatory = fsLines.filter(f => f.isMandatory);
    setFsLines([...mandatory, ...withOrder]);

    // Fire-and-forget API saves (don't await, don't update state from response)
    const id1 = withOrder[index].id;
    const id2 = withOrder[newIndex].id;
    fetch('/api/methodology-admin/fs-lines', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id1, sortOrder: index }),
    }).catch(() => {});
    fetch('/api/methodology-admin/fs-lines', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id2, sortOrder: newIndex }),
    }).catch(() => {});
  }

  function startEdit(line: FsLine) {
    setEditingId(line.id);
    setEditName(line.name);
    setEditLineType(line.lineType);
    setEditCategory(line.fsCategory);
  }

  async function saveEdit() {
    if (!editingId || !editName.trim()) return;
    await updateFsLine(editingId, { name: editName.trim(), lineType: editLineType, fsCategory: editCategory } as any);
    setEditingId(null);
  }

  const activeFsLines = fsLines.filter(f => f.isActive);

  return (
    <div className="space-y-6">
      {/* View toggle */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button onClick={() => setView('list')}
            className={`px-3 py-1.5 text-sm rounded-lg border ${view === 'list' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            FS Lines
          </button>
          <button onClick={() => setView('matrix')}
            className={`px-3 py-1.5 text-sm rounded-lg border ${view === 'matrix' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            Industry Mapping
          </button>
        </div>
        {view === 'list' && (
          <button onClick={() => setShowAdd(true)} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            + Add FS Line
          </button>
        )}
      </div>

      {/* Add form */}
      {showAdd && view === 'list' && (
        <div className="border border-blue-200 bg-blue-50/50 rounded-lg p-4 flex items-end gap-3">
          <div className="flex-1">
            <label className="text-xs text-slate-500 block mb-1">Name</label>
            <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addFsLine()}
              placeholder="e.g. Revenue, Trade Debtors..."
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm" autoFocus />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Type</label>
            <select value={newLineType} onChange={e => setNewLineType(e.target.value)}
              className="border border-slate-300 rounded px-3 py-2 text-sm">
              {LINE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">FS Category</label>
            <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
              className="border border-slate-300 rounded px-3 py-2 text-sm">
              {FS_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <button onClick={addFsLine} disabled={saving || !newName.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Adding...' : 'Add'}
          </button>
          <button onClick={() => setShowAdd(false)} className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700">Cancel</button>
        </div>
      )}

      {/* List view */}
      {view === 'list' && (<>
        {/* Mandatory items - permanent audit focus areas */}
        {fsLines.filter(f => f.isMandatory).length > 0 && (
          <div className="border border-amber-200 bg-amber-50/30 rounded-lg overflow-hidden mb-4">
            <div className="px-4 py-2 bg-amber-100/50 border-b border-amber-200">
              <h3 className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Permanent Audit Significant/Focus Areas</h3>
              <p className="text-[10px] text-amber-600 mt-0.5">These are always included regardless of industry. They appear in RMM but are not financial statement lines.</p>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {fsLines.filter(f => f.isMandatory).map((line) => (
                  <tr key={line.id} className="border-b border-amber-100 last:border-0">
                    <td className="px-4 py-2.5 text-slate-800 font-medium">
                      {line.name}
                      <span className="ml-2 text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">Mandatory</span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs w-48">Always included in RMM</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* FS Lines table */}
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200">
                <th className="text-center px-2 py-2.5 text-slate-600 font-semibold w-12">Order</th>
                <th className="text-left px-4 py-2.5 text-slate-600 font-semibold">Name</th>
                <th className="text-left px-4 py-2.5 text-slate-600 font-semibold w-36">Type</th>
                <th className="text-left px-4 py-2.5 text-slate-600 font-semibold w-36">
                  <button onClick={sortByCategory}
                    className="flex items-center gap-1 hover:text-blue-600 transition-colors"
                    title="Sort by FS Category (P&L → Balance Sheet → Cashflow → Notes) and renumber">
                    FS Category
                    <span className="text-[10px] text-slate-400">⇅</span>
                  </button>
                </th>
                <th className="text-center px-4 py-2.5 text-slate-600 font-semibold w-24">Industries</th>
                <th className="text-center px-4 py-2.5 text-slate-600 font-semibold w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedNonMandatory.map((line, idx) => (
                <tr key={line.id} className={`border-b border-slate-100 ${!line.isActive ? 'opacity-40' : ''} ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                  {editingId === line.id ? (
                    <>
                      <td className="text-center px-2 py-2 text-slate-400 text-xs">{idx + 1}</td>
                      <td className="px-4 py-2">
                        <input value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveEdit()}
                          className="w-full border border-blue-300 rounded px-2 py-1 text-sm" autoFocus />
                      </td>
                      <td className="px-4 py-2">
                        <select value={editLineType} onChange={e => setEditLineType(e.target.value)}
                          className="border border-blue-300 rounded px-2 py-1 text-sm">
                          {LINE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <select value={editCategory} onChange={e => setEditCategory(e.target.value)}
                          className="border border-blue-300 rounded px-2 py-1 text-sm">
                          {FS_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                      </td>
                      <td className="text-center px-4 py-2">
                        <span className="text-xs text-slate-400">{line.industryMappings.length}</span>
                      </td>
                      <td className="text-center px-4 py-2">
                        <button onClick={saveEdit} className="text-xs text-blue-600 hover:text-blue-800 mr-2">Save</button>
                        <button onClick={() => setEditingId(null)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="text-center px-2 py-2.5">
                        <div className="flex flex-col items-center gap-0.5">
                          <button onClick={() => moveRow(idx, 'up')} disabled={idx === 0}
                            className="text-slate-400 hover:text-blue-600 disabled:opacity-20 text-[10px] leading-none">▲</button>
                          <span className="text-[10px] text-slate-400">{idx + 1}</span>
                          <button onClick={() => moveRow(idx, 'down')} disabled={idx === fsLines.length - 1}
                            className="text-slate-400 hover:text-blue-600 disabled:opacity-20 text-[10px] leading-none">▼</button>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-800 font-medium">
                        {line.name}
                        {line.isMandatory && <span className="ml-2 text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">Mandatory</span>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {LINE_TYPES.find(t => t.value === line.lineType)?.label || line.lineType}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          line.fsCategory === 'pnl' ? 'bg-green-50 text-green-700' :
                          line.fsCategory === 'balance_sheet' ? 'bg-blue-50 text-blue-700' :
                          line.fsCategory === 'cashflow' ? 'bg-purple-50 text-purple-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {FS_CATEGORIES.find(c => c.value === line.fsCategory)?.label || line.fsCategory}
                        </span>
                      </td>
                      <td className="text-center px-4 py-2.5 text-slate-500 text-xs">{line.industryMappings.length}</td>
                      <td className="text-center px-4 py-2.5">
                        <button onClick={() => startEdit(line)} className="text-xs text-blue-500 hover:text-blue-700 mr-2" title="Edit">✏️</button>
                        {!line.isMandatory && (
                          <button onClick={() => deleteFsLine(line.id)} className="text-xs text-red-400 hover:text-red-600" title="Delete">×</button>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {fsLines.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-slate-400 italic">No FS lines defined. Click &quot;+ Add FS Line&quot; to start.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </>)}

      {/* Matrix view - FS Lines × Industries */}
      {view === 'matrix' && (
        <div className="border border-slate-200 rounded-lg overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-100 border-b border-slate-200">
                <th className="text-left px-4 py-3 text-slate-600 font-semibold w-56 bg-slate-100">FS Line</th>
                <th className="text-left px-3 py-3 text-slate-600 font-semibold w-28 bg-slate-100">Category</th>
                {industries.map(ind => (
                  <th key={ind.id} className="text-center px-2 py-3 text-slate-600 font-semibold bg-slate-100">
                    <span className="text-xs">{ind.name}</span>
                    {ind.isDefault && <span className="block text-[8px] text-slate-400">(Default)</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeFsLines.map((line, idx) => (
                <tr key={line.id} className={`border-b border-slate-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}>
                  <td className="px-4 py-2 text-slate-800 font-medium">
                    {line.name}
                    {line.isMandatory && <span className="ml-1 text-[8px] text-amber-600">★</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      line.fsCategory === 'pnl' ? 'bg-green-50 text-green-700' :
                      line.fsCategory === 'balance_sheet' ? 'bg-blue-50 text-blue-700' :
                      line.fsCategory === 'cashflow' ? 'bg-purple-50 text-purple-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>
                      {FS_CATEGORIES.find(c => c.value === line.fsCategory)?.label || line.fsCategory}
                    </span>
                  </td>
                  {industries.map(ind => {
                    const isEnabled = line.industryMappings.some(m => m.industryId === ind.id);
                    return (
                      <td key={ind.id} className="text-center px-2 py-2">
                        <button
                          onClick={() => toggleIndustryMapping(line.id, ind.id)}
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all mx-auto ${
                            isEnabled
                              ? 'bg-green-500 border-green-500 text-white'
                              : 'bg-white border-slate-300 hover:border-green-400'
                          }`}
                          title={isEnabled ? 'Click to remove' : 'Click to assign'}
                        >
                          {isEnabled && <span className="text-[10px]">✓</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {activeFsLines.length === 0 && (
                <tr><td colSpan={2 + industries.length} className="text-center py-8 text-slate-400 italic">
                  No active FS lines. Switch to &quot;FS Lines&quot; view to add some.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400">
        ★ Mandatory lines (Going Concern, Management Override, Notes &amp; Disclosures) cannot be deleted.
        Green checkmarks in the Industry Mapping indicate the FS line is available for that industry.
      </p>
    </div>
  );
}
