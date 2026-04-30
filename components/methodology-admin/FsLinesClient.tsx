'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { Download, Upload, Settings } from 'lucide-react';

interface FsLine {
  id: string;
  name: string;
  lineType: string;
  fsCategory: string;
  fsLevelName: string | null;
  fsStatementName: string | null;
  sortOrder: number;
  isActive: boolean;
  isMandatory: boolean;
  parentFsLineId: string | null;
  parent?: { id: string; name: string } | null;
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
  const [newParentId, setNewParentId] = useState('');
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'list' | 'matrix'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editLineType, setEditLineType] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [taxonomyFramework, setTaxonomyFramework] = useState('FRS102');
  const [populating, setPopulating] = useState(false);
  const [taxonomyItems, setTaxonomyItems] = useState<{ name: string; label: string; fsCategory: string; depth: number }[]>([]);
  const [taxonomySearch, setTaxonomySearch] = useState('');
  const [loadingTaxonomy, setLoadingTaxonomy] = useState(false);
  const fsLineFileRef = useRef<HTMLInputElement>(null);
  const mappingFileRef = useRef<HTMLInputElement>(null);

  // Firm-wide option lists that drive the FS Level + FS Statement
  // dropdowns. Loaded from /api/methodology-admin/fs-options; admins
  // manage the lists via the "Manage options" modal.
  const [statementOptions, setStatementOptions] = useState<string[]>([]);
  const [levelOptions, setLevelOptions] = useState<{ name: string; statementName: string }[]>([]);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [savingOptions, setSavingOptions] = useState(false);
  useEffect(() => {
    fetch('/api/methodology-admin/fs-options').then(r => r.ok ? r.json() : null).then(d => {
      if (d) {
        setStatementOptions(Array.isArray(d.statementOptions) ? d.statementOptions : []);
        setLevelOptions(Array.isArray(d.levelOptions) ? d.levelOptions : []);
      }
    }).catch(() => {});
  }, []);
  async function saveOptions(next: { statementOptions?: string[]; levelOptions?: { name: string; statementName: string }[] }) {
    setSavingOptions(true);
    try {
      await fetch('/api/methodology-admin/fs-options', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
      });
    } finally { setSavingOptions(false); }
  }

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
        body: JSON.stringify({ name: newName.trim(), lineType: newLineType, fsCategory: newCategory, parentFsLineId: newParentId || null }),
      });
      if (res.ok) {
        const { fsLine } = await res.json();
        setFsLines(prev => [...prev, fsLine]);
        setNewName(''); setShowAdd(false);
      }
    } finally { setSaving(false); }
  }

  async function populateFromTaxonomy() {
    if (!confirm(`This will replace existing non-mandatory FS lines with items from the ${taxonomyFramework} taxonomy. Test allocations may be affected. Continue?`)) return;
    setPopulating(true);
    setUploadResult(null);
    try {
      const res = await fetch('/api/methodology-admin/fs-lines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'populate_from_taxonomy', framework: taxonomyFramework }),
      });
      const data = await res.json();
      if (res.ok) {
        setUploadResult(`Taxonomy populated: ${data.created} created, ${data.deleted} replaced from ${data.framework}`);
        // Reload FS lines
        const reload = await fetch('/api/methodology-admin/fs-lines');
        if (reload.ok) {
          const { fsLines: newLines } = await reload.json();
          setFsLines(newLines);
        }
      } else {
        setUploadResult(`Taxonomy populate failed: ${data.error}`);
      }
    } catch (err: any) {
      setUploadResult(`Taxonomy populate failed: ${err.message}`);
    } finally { setPopulating(false); }
  }

  async function loadTaxonomyItems() {
    setLoadingTaxonomy(true);
    try {
      const res = await fetch(`/api/methodology-admin/fs-lines?action=taxonomy_items&framework=${taxonomyFramework}`);
      if (res.ok) {
        const data = await res.json();
        setTaxonomyItems(data.items || []);
      }
    } finally { setLoadingTaxonomy(false); }
  }

  async function addFromTaxonomy(item: { name: string; fsCategory: string; depth: number }) {
    setSaving(true);
    try {
      const lineType = item.depth <= 1 ? 'fs_line_item' : 'note_item';
      const res = await fetch('/api/methodology-admin/fs-lines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: item.name, lineType, fsCategory: item.fsCategory }),
      });
      if (res.ok) {
        const { fsLine } = await res.json();
        setFsLines(prev => [...prev, fsLine]);
        setTaxonomyItems(prev => prev.filter(t => t.name !== item.name)); // Remove from picker
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

  async function handleFsLineUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/methodology-admin/fs-lines/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'validation') {
          setUploadResult(`Upload rejected — ${data.count} error(s):\n${data.errors.join('\n')}${data.hasMore ? '\n...and more' : ''}`);
        } else { setUploadResult(`Upload failed: ${data.error}`); }
      } else {
        setUploadResult(`Imported ${data.total} FS lines (${data.created} new, ${data.updated} updated)`);
        // Reload FS lines
        const reload = await fetch('/api/methodology-admin/fs-lines');
        if (reload.ok) { const d = await reload.json(); setFsLines(d.fsLines || []); }
      }
    } catch (err: any) { setUploadResult(`Upload failed: ${err?.message || 'Network error'}`); }
    finally { setUploading(false); if (fsLineFileRef.current) fsLineFileRef.current.value = ''; }
  }

  async function handleMappingUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/methodology-admin/fs-lines/industry-mapping/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'validation') {
          setUploadResult(`Upload rejected — ${data.count} error(s):\n${data.errors.join('\n')}${data.hasMore ? '\n...and more' : ''}`);
        } else { setUploadResult(`Upload failed: ${data.error}`); }
      } else {
        setUploadResult(`Industry mapping updated: ${data.added} added, ${data.removed} removed`);
        // Reload FS lines with mappings
        const reload = await fetch('/api/methodology-admin/fs-lines');
        if (reload.ok) { const d = await reload.json(); setFsLines(d.fsLines || []); }
      }
    } catch (err: any) { setUploadResult(`Upload failed: ${err?.message || 'Network error'}`); }
    finally { setUploading(false); if (mappingFileRef.current) mappingFileRef.current.value = ''; }
  }

  const activeFsLines = fsLines.filter(f => f.isActive);

  return (
    <div className="space-y-6">
      {/* View toggle */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button onClick={() => setView('list')}
            data-howto-id="amt.fs-lines.tab-list"
            className={`px-3 py-1.5 text-sm rounded-lg border ${view === 'list' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            FS Lines
          </button>
          <button onClick={() => setView('matrix')}
            data-howto-id="amt.fs-lines.tab-matrix"
            className={`px-3 py-1.5 text-sm rounded-lg border ${view === 'matrix' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            Industry Mapping
          </button>
        </div>
        <div className="flex items-center gap-2">
          {view === 'list' && (
            <>
              <button onClick={() => window.open('/api/methodology-admin/fs-lines/template', '_blank')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
                <Download className="h-3.5 w-3.5" /> Template
              </button>
              <button onClick={() => fsLineFileRef.current?.click()} disabled={uploading}
                data-howto-id="amt.fs-lines.upload"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                <Upload className="h-3.5 w-3.5" /> {uploading ? 'Uploading...' : 'Upload'}
              </button>
              <input ref={fsLineFileRef} type="file" accept=".xlsx,.xls" onChange={handleFsLineUpload} className="hidden" />
              <select value={taxonomyFramework} onChange={e => setTaxonomyFramework(e.target.value)}
                className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-600">
                <option value="FRS102">FRS 102</option>
                <option value="IFRS">IFRS</option>
                <option value="FRS101">FRS 101</option>
                <option value="Charities">Charities</option>
              </select>
              <button onClick={populateFromTaxonomy} disabled={populating}
                data-howto-id="amt.fs-lines.populate-taxonomy"
                className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
                {populating ? 'Populating...' : 'Populate from Taxonomy'}
              </button>
              <button onClick={() => setShowOptionsModal(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50"
                title="Manage the firm-wide FS Level + FS Statement option lists">
                <Settings className="h-3.5 w-3.5" /> Manage options
              </button>
              <button onClick={() => { setShowAdd(true); loadTaxonomyItems(); }} data-howto-id="amt.fs-lines.add" className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                + Add from Taxonomy
              </button>
            </>
          )}
          {view === 'matrix' && (
            <>
              <button onClick={() => window.open('/api/methodology-admin/fs-lines/industry-mapping/template', '_blank')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
                <Download className="h-3.5 w-3.5" /> Template
              </button>
              <button onClick={() => mappingFileRef.current?.click()} disabled={uploading}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                <Upload className="h-3.5 w-3.5" /> {uploading ? 'Uploading...' : 'Upload'}
              </button>
              <input ref={mappingFileRef} type="file" accept=".xlsx,.xls" onChange={handleMappingUpload} className="hidden" />
            </>
          )}
        </div>
      </div>

      {/* Upload result */}
      {uploadResult && (
        <div className={`text-sm px-4 py-2 rounded-lg whitespace-pre-wrap ${uploadResult.includes('failed') || uploadResult.includes('rejected') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {uploadResult}
          <button onClick={() => setUploadResult(null)} className="ml-2 text-xs underline">dismiss</button>
        </div>
      )}

      {/* Add from Taxonomy picker */}
      {showAdd && view === 'list' && (
        <div className="border border-blue-200 bg-blue-50/50 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Add FS Line from {taxonomyFramework} Taxonomy</h3>
            <button onClick={() => { setShowAdd(false); setTaxonomySearch(''); }} className="text-sm text-slate-500 hover:text-slate-700">Cancel</button>
          </div>
          {loadingTaxonomy && <p className="text-xs text-slate-400 animate-pulse">Loading taxonomy items...</p>}
          {!loadingTaxonomy && taxonomyItems.length === 0 && (
            <p className="text-xs text-slate-400">No taxonomy items loaded. Click "Add from Taxonomy" again to fetch.</p>
          )}
          {taxonomyItems.length > 0 && (
            <>
              <input
                value={taxonomySearch}
                onChange={e => setTaxonomySearch(e.target.value)}
                placeholder="Search taxonomy items..."
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
                autoFocus
              />
              <div className="max-h-[300px] overflow-auto border rounded divide-y divide-slate-100">
                {taxonomyItems
                  .filter(item => !taxonomySearch || item.name.toLowerCase().includes(taxonomySearch.toLowerCase()))
                  .filter(item => !fsLines.some(f => f.name.toLowerCase() === item.name.toLowerCase()))
                  .slice(0, 50)
                  .map((item, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-1.5 hover:bg-blue-50 cursor-pointer"
                      onClick={() => addFromTaxonomy(item)}>
                      <span className={`text-[8px] px-1 py-0 rounded ${
                        item.fsCategory === 'pnl' ? 'bg-green-100 text-green-700' :
                        item.fsCategory === 'balance_sheet' ? 'bg-blue-100 text-blue-700' :
                        item.fsCategory === 'cashflow' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'
                      }`}>{item.fsCategory === 'pnl' ? 'P&L' : item.fsCategory === 'balance_sheet' ? 'BS' : item.fsCategory === 'cashflow' ? 'CF' : 'Notes'}</span>
                      <span className="text-sm text-slate-700 flex-1">{item.name}</span>
                      <span className="text-[9px] text-slate-400">{item.depth <= 1 ? 'Line Item' : 'Note Item'}</span>
                      <span className="text-xs text-blue-600">+ Add</span>
                    </div>
                  ))}
              </div>
            </>
          )}
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
                <th className="text-left px-4 py-2.5 text-slate-600 font-semibold">FS Note Level Name</th>
                <th className="text-left px-4 py-2.5 text-slate-600 font-semibold w-48">FS Level</th>
                <th className="text-left px-4 py-2.5 text-slate-600 font-semibold w-44">
                  <button onClick={sortByCategory}
                    className="flex items-center gap-1 hover:text-blue-600 transition-colors"
                    title="Sort by FS Statement and renumber">
                    FS Statement
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
                          className="w-full border border-blue-300 rounded px-2 py-1 text-sm" autoFocus placeholder="FS Note Level name (e.g. Trade Debtors)" />
                      </td>
                      <td className="px-4 py-2">
                        <select
                          value={line.fsLevelName || ''}
                          onChange={async e => {
                            const nextLevel = e.target.value || null;
                            const mapped = levelOptions.find(l => l.name === nextLevel)?.statementName || null;
                            await updateFsLine(line.id, { fsLevelName: nextLevel, ...(mapped ? { fsStatementName: mapped } : {}) } as any);
                          }}
                          className="border border-blue-300 rounded px-2 py-1 text-xs w-full">
                          <option value="">— FS Level —</option>
                          {levelOptions.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
                          {line.fsLevelName && !levelOptions.some(l => l.name === line.fsLevelName) && (
                            <option value={line.fsLevelName}>{line.fsLevelName} (legacy)</option>
                          )}
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <select
                          value={line.fsStatementName || ''}
                          onChange={async e => { await updateFsLine(line.id, { fsStatementName: e.target.value || null } as any); }}
                          className="border border-blue-300 rounded px-2 py-1 text-xs w-full">
                          <option value="">— FS Statement —</option>
                          {statementOptions.map(s => <option key={s} value={s}>{s}</option>)}
                          {line.fsStatementName && !statementOptions.includes(line.fsStatementName) && (
                            <option value={line.fsStatementName}>{line.fsStatementName} (legacy)</option>
                          )}
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
                      <td className="px-4 py-2.5">
                        <select
                          value={line.fsLevelName || ''}
                          onChange={async e => {
                            const nextLevel = e.target.value || null;
                            const mapped = levelOptions.find(l => l.name === nextLevel)?.statementName || null;
                            await updateFsLine(line.id, { fsLevelName: nextLevel, ...(mapped ? { fsStatementName: mapped } : {}) } as any);
                          }}
                          className="w-full border border-slate-200 rounded px-2 py-1 text-xs bg-white focus:border-blue-400 focus:outline-none">
                          <option value="">—</option>
                          {levelOptions.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
                          {line.fsLevelName && !levelOptions.some(l => l.name === line.fsLevelName) && (
                            <option value={line.fsLevelName}>{line.fsLevelName} (legacy)</option>
                          )}
                        </select>
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          value={line.fsStatementName || ''}
                          onChange={async e => { await updateFsLine(line.id, { fsStatementName: e.target.value || null } as any); }}
                          className="w-full border border-slate-200 rounded px-2 py-1 text-xs bg-white focus:border-blue-400 focus:outline-none">
                          <option value="">—</option>
                          {statementOptions.map(s => <option key={s} value={s}>{s}</option>)}
                          {line.fsStatementName && !statementOptions.includes(line.fsStatementName) && (
                            <option value={line.fsStatementName}>{line.fsStatementName} (legacy)</option>
                          )}
                        </select>
                      </td>
                      <td className="text-center px-4 py-2.5 text-slate-500 text-xs">{line.industryMappings.length}</td>
                      <td className="text-center px-4 py-2.5">
                        <button onClick={() => startEdit(line)} className="text-xs text-blue-500 hover:text-blue-700 mr-2" title="Edit name">✏️</button>
                        {!line.isMandatory && (
                          <button onClick={() => deleteFsLine(line.id)} className="text-xs text-red-400 hover:text-red-600" title="Delete">×</button>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {fsLines.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-slate-400 italic">No FS Note Levels defined. Click &quot;+ Add from Taxonomy&quot; or upload a template to start.</td></tr>
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

      {/* Manage-options modal — edits the firm-wide FS Level + FS Statement
          pick-lists that drive the dropdowns above. Stored in
          MethodologyRiskTable (tableType: fs_statement_options / fs_level_options). */}
      {showOptionsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4" onClick={() => !savingOptions && setShowOptionsModal(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <Settings className="h-4 w-4 text-blue-600" /> FS Level &amp; FS Statement options
              </h3>
              <button onClick={() => setShowOptionsModal(false)} disabled={savingOptions} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="p-5 grid grid-cols-2 gap-4">
              {/* FS Statement options */}
              <div>
                <p className="text-xs font-semibold text-slate-700 mb-2">FS Statements</p>
                <div className="space-y-1">
                  {statementOptions.map((s, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <input value={s} onChange={e => {
                        const next = [...statementOptions]; next[i] = e.target.value; setStatementOptions(next);
                      }} className="flex-1 border border-slate-200 rounded px-2 py-1 text-xs" />
                      <button onClick={() => setStatementOptions(statementOptions.filter((_, j) => j !== i))}
                        className="text-red-400 hover:text-red-600 text-xs px-1" title="Remove">×</button>
                    </div>
                  ))}
                  <button onClick={() => setStatementOptions([...statementOptions, ''])}
                    className="text-[11px] text-blue-600 hover:text-blue-800 mt-1">+ Add statement</button>
                </div>
              </div>
              {/* FS Level options (each with linked FS Statement) */}
              <div>
                <p className="text-xs font-semibold text-slate-700 mb-2">FS Levels</p>
                <div className="space-y-1">
                  {levelOptions.map((l, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <input value={l.name} onChange={e => {
                        const next = [...levelOptions]; next[i] = { ...next[i], name: e.target.value }; setLevelOptions(next);
                      }} placeholder="Level name" className="flex-1 border border-slate-200 rounded px-2 py-1 text-xs" />
                      <select value={l.statementName || ''} onChange={e => {
                        const next = [...levelOptions]; next[i] = { ...next[i], statementName: e.target.value }; setLevelOptions(next);
                      }} className="border border-slate-200 rounded px-1 py-1 text-xs bg-white">
                        <option value="">— Statement —</option>
                        {statementOptions.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <button onClick={() => setLevelOptions(levelOptions.filter((_, j) => j !== i))}
                        className="text-red-400 hover:text-red-600 text-xs px-1" title="Remove">×</button>
                    </div>
                  ))}
                  <button onClick={() => setLevelOptions([...levelOptions, { name: '', statementName: '' }])}
                    className="text-[11px] text-blue-600 hover:text-blue-800 mt-1">+ Add level</button>
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2">
              <button onClick={() => setShowOptionsModal(false)} disabled={savingOptions} className="text-sm px-3 py-1.5 text-slate-600 hover:text-slate-800">Cancel</button>
              <button onClick={async () => {
                await saveOptions({
                  statementOptions: statementOptions.map(s => s.trim()).filter(Boolean),
                  levelOptions: levelOptions.map(l => ({ name: l.name.trim(), statementName: l.statementName.trim() })).filter(l => l.name),
                });
                setShowOptionsModal(false);
              }} disabled={savingOptions} className="text-sm px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                {savingOptions ? 'Saving…' : 'Save options'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
