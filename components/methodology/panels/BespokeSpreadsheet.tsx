'use client';

import { useState, useRef } from 'react';
import { Plus, Trash2, Download, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { expandZipFile } from '@/lib/client-unzip';

interface GridData {
  rows: string[][];
  columns: string[];
}

interface Props {
  title?: string;
  onClose?: () => void;
  onSave?: (data: GridData) => void;
  /** Controlled mode: when provided, the component renders from these values instead of internal state. */
  value?: GridData;
  /** Controlled mode: called on every mutation (cell edit, add row/col, delete row). */
  onChange?: (data: GridData) => void;
  /** Hide the blue "Save" button in the toolbar (useful when saving is handled externally, e.g. on-blur auto-save). */
  hideSaveButton?: boolean;
}

export function BespokeSpreadsheet({ title, onClose, onSave, value, onChange, hideSaveButton }: Props) {
  const controlled = value !== undefined;

  const [internalColumns, setInternalColumns] = useState(['A', 'B', 'C', 'D', 'E']);
  const [internalRows, setInternalRows] = useState<string[][]>(() => Array.from({ length: 10 }, () => Array(5).fill('')));
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const columns = controlled ? value!.columns : internalColumns;
  const rows = controlled ? value!.rows : internalRows;

  function commit(next: GridData) {
    if (controlled) {
      onChange?.(next);
    } else {
      setInternalColumns(next.columns);
      setInternalRows(next.rows);
    }
  }

  function updateCell(row: number, col: number, value: string) {
    const next = rows.map(r => [...r]);
    // Auto-calculate if formula
    if (value.startsWith('=')) {
      try {
        const formula = value.slice(1).toUpperCase();
        // SUM(A1:A5)
        const sumMatch = formula.match(/^SUM\(([A-Z])(\d+):([A-Z])(\d+)\)$/);
        if (sumMatch) {
          const colIdx = sumMatch[1].charCodeAt(0) - 65;
          const startRow = parseInt(sumMatch[2]) - 1;
          const endRow = parseInt(sumMatch[4]) - 1;
          let total = 0;
          for (let r = startRow; r <= endRow; r++) {
            total += parseFloat(next[r]?.[colIdx] || '0') || 0;
          }
          next[row][col] = String(total);
          commit({ rows: next, columns });
          return;
        }
        // Simple arithmetic: =A1+B1, =A1*2, etc.
        const cellRefFormula = formula.replace(/([A-Z])(\d+)/g, (_, letter, num) => {
          const c = letter.charCodeAt(0) - 65;
          const r = parseInt(num) - 1;
          return next[r]?.[c] || '0';
        });
        const result = Function(`"use strict"; return (${cellRefFormula})`)();
        next[row][col] = String(result);
        commit({ rows: next, columns });
        return;
      } catch {
        next[row][col] = value; // Keep formula text if evaluation fails
        commit({ rows: next, columns });
        return;
      }
    }
    next[row][col] = value;
    commit({ rows: next, columns });
  }

  function addRow() {
    commit({ rows: [...rows, Array(columns.length).fill('')], columns });
  }

  function addColumn() {
    const nextLetter = String.fromCharCode(65 + columns.length);
    commit({
      rows: rows.map(r => [...r, '']),
      columns: [...columns, nextLetter],
    });
  }

  function deleteRow(idx: number) {
    if (rows.length <= 1) return;
    commit({ rows: rows.filter((_, i) => i !== idx), columns });
  }

  function renameColumn(ci: number, label: string) {
    commit({ rows, columns: columns.map((c, i) => i === ci ? label : c) });
  }

  function downloadCSV() {
    const csv = [columns.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${title || 'spreadsheet'}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = await expandZipFile(e.target.files?.[0]);
    if (!file) return;
    const text = await file.text();
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
      const data = lines.slice(1).map(line => {
        const cells = line.split(',').map(c => c.replace(/"/g, '').trim());
        while (cells.length < headers.length) cells.push('');
        return cells;
      });
      commit({ rows: data.length > 0 ? data : [Array(headers.length).fill('')], columns: headers });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="border rounded-lg overflow-hidden bg-white">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b text-xs">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-700">{title || 'Bespoke Spreadsheet'}</span>
          <span className="text-slate-400">{rows.length} rows × {columns.length} cols</span>
        </div>
        <div className="flex items-center gap-1">
          <Button onClick={addRow} size="sm" variant="outline" className="h-6 text-[10px]"><Plus className="h-2.5 w-2.5 mr-0.5" />Row</Button>
          <Button onClick={addColumn} size="sm" variant="outline" className="h-6 text-[10px]"><Plus className="h-2.5 w-2.5 mr-0.5" />Col</Button>
          <Button onClick={downloadCSV} size="sm" variant="outline" className="h-6 text-[10px]"><Download className="h-2.5 w-2.5 mr-0.5" />CSV</Button>
          <Button onClick={() => fileInputRef.current?.click()} size="sm" variant="outline" className="h-6 text-[10px]"><Upload className="h-2.5 w-2.5 mr-0.5" />Upload</Button>
          <input ref={fileInputRef} type="file" accept=".csv,.zip" onChange={handleUpload} className="hidden" />
          {onSave && !hideSaveButton && <Button onClick={() => onSave({ rows, columns })} size="sm" className="h-6 text-[10px] bg-blue-600">Save</Button>}
          {onClose && <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded ml-1"><X className="h-3.5 w-3.5 text-slate-400" /></button>}
        </div>
      </div>

      {/* Grid */}
      <div className="overflow-auto max-h-[400px]">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <th className="w-8 px-1 py-1 border-r border-b border-slate-200 text-slate-400 font-mono text-[9px]">#</th>
              {columns.map((col, ci) => (
                <th key={ci} className="px-2 py-1 border-r border-b border-slate-200 text-slate-600 font-semibold min-w-[80px]">
                  <input value={col} onChange={e => renameColumn(ci, e.target.value)}
                    className="w-full bg-transparent text-center text-xs font-semibold outline-none" />
                </th>
              ))}
              <th className="w-6 border-b border-slate-200"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className={ri % 2 ? 'bg-slate-50/30' : ''}>
                <td className="px-1 py-0.5 border-r border-slate-100 text-slate-400 font-mono text-[9px] text-center">{ri + 1}</td>
                {row.map((cell, ci) => (
                  <td key={ci} className={`border-r border-slate-100 p-0 ${selectedCell?.row === ri && selectedCell?.col === ci ? 'ring-2 ring-blue-500 ring-inset' : ''}`}>
                    <input value={cell}
                      onChange={e => updateCell(ri, ci, e.target.value)}
                      onFocus={() => setSelectedCell({ row: ri, col: ci })}
                      className="w-full px-1.5 py-1 text-xs outline-none bg-transparent" />
                  </td>
                ))}
                <td className="px-0.5">
                  <button onClick={() => deleteRow(ri)} className="p-0.5 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100">
                    <Trash2 className="h-2.5 w-2.5 text-red-400" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
