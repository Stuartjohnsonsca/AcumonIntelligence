'use client';

import { useState, useCallback, useRef, type RefObject } from 'react';

export interface TableSelection {
  type: 'none' | 'cell' | 'range' | 'row' | 'column';
  anchor: { row: number; col: number } | null;
  focus: { row: number; col: number } | null;
  isFullRow: boolean;
  isFullColumn: boolean;
  selectedRows: number[];
  selectedCols: number[];
}

const EMPTY_SELECTION: TableSelection = {
  type: 'none',
  anchor: null,
  focus: null,
  isFullRow: false,
  isFullColumn: false,
  selectedRows: [],
  selectedCols: [],
};

function cellsInRange(
  anchor: { row: number; col: number },
  focus: { row: number; col: number }
): Array<{ row: number; col: number }> {
  const minRow = Math.min(anchor.row, focus.row);
  const maxRow = Math.max(anchor.row, focus.row);
  const minCol = Math.min(anchor.col, focus.col);
  const maxCol = Math.max(anchor.col, focus.col);
  const cells: Array<{ row: number; col: number }> = [];
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      cells.push({ row: r, col: c });
    }
  }
  return cells;
}

export function useTableSelection(tableRef: RefObject<HTMLTableElement | null>) {
  const [selection, setSelection] = useState<TableSelection>(EMPTY_SELECTION);
  // Track total columns for full-column selection
  const totalColsRef = useRef(0);
  const totalRowsRef = useRef(0);

  const setTableDimensions = useCallback((rows: number, cols: number) => {
    totalRowsRef.current = rows;
    totalColsRef.current = cols;
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(EMPTY_SELECTION);
  }, []);

  const onCellClick = useCallback(
    (row: number, col: number, e: React.MouseEvent) => {
      e.stopPropagation();
      if (e.shiftKey && selection.anchor) {
        // Range selection from anchor to clicked cell
        setSelection({
          type: 'range',
          anchor: selection.anchor,
          focus: { row, col },
          isFullRow: false,
          isFullColumn: false,
          selectedRows: [],
          selectedCols: [],
        });
      } else {
        setSelection({
          type: 'cell',
          anchor: { row, col },
          focus: { row, col },
          isFullRow: false,
          isFullColumn: false,
          selectedRows: [],
          selectedCols: [],
        });
      }
    },
    [selection.anchor]
  );

  const onRowHeaderClick = useCallback(
    (row: number, e: React.MouseEvent) => {
      e.stopPropagation();
      if (e.shiftKey && selection.selectedRows.length > 0) {
        // Extend row selection
        const minRow = Math.min(selection.selectedRows[0], row);
        const maxRow = Math.max(selection.selectedRows[selection.selectedRows.length - 1], row);
        const rows: number[] = [];
        for (let r = minRow; r <= maxRow; r++) rows.push(r);
        setSelection({
          type: 'row',
          anchor: { row: minRow, col: 0 },
          focus: { row: maxRow, col: totalColsRef.current - 1 },
          isFullRow: true,
          isFullColumn: false,
          selectedRows: rows,
          selectedCols: [],
        });
      } else {
        setSelection({
          type: 'row',
          anchor: { row, col: 0 },
          focus: { row, col: totalColsRef.current - 1 },
          isFullRow: true,
          isFullColumn: false,
          selectedRows: [row],
          selectedCols: [],
        });
      }
    },
    [selection.selectedRows]
  );

  const onColumnHeaderClick = useCallback(
    (col: number, e: React.MouseEvent) => {
      e.stopPropagation();
      if (e.shiftKey && selection.selectedCols.length > 0) {
        const minCol = Math.min(selection.selectedCols[0], col);
        const maxCol = Math.max(selection.selectedCols[selection.selectedCols.length - 1], col);
        const cols: number[] = [];
        for (let c = minCol; c <= maxCol; c++) cols.push(c);
        setSelection({
          type: 'column',
          anchor: { row: 0, col: minCol },
          focus: { row: totalRowsRef.current - 1, col: maxCol },
          isFullRow: false,
          isFullColumn: true,
          selectedRows: [],
          selectedCols: cols,
        });
      } else {
        setSelection({
          type: 'column',
          anchor: { row: 0, col },
          focus: { row: totalRowsRef.current - 1, col },
          isFullRow: false,
          isFullColumn: true,
          selectedRows: [],
          selectedCols: [col],
        });
      }
    },
    [selection.selectedCols]
  );

  const isCellSelected = useCallback(
    (row: number, col: number): boolean => {
      if (selection.type === 'none') return false;
      if (selection.type === 'row') {
        return selection.selectedRows.includes(row);
      }
      if (selection.type === 'column') {
        return selection.selectedCols.includes(col);
      }
      if (!selection.anchor || !selection.focus) return false;
      const cells = cellsInRange(selection.anchor, selection.focus);
      return cells.some((c) => c.row === row && c.col === col);
    },
    [selection]
  );

  const getSelectedCells = useCallback((): Array<{ row: number; col: number }> => {
    if (selection.type === 'none') return [];
    if (selection.type === 'row') {
      const cells: Array<{ row: number; col: number }> = [];
      for (const r of selection.selectedRows) {
        for (let c = 0; c < totalColsRef.current; c++) {
          cells.push({ row: r, col: c });
        }
      }
      return cells;
    }
    if (selection.type === 'column') {
      const cells: Array<{ row: number; col: number }> = [];
      for (let r = 0; r < totalRowsRef.current; r++) {
        for (const c of selection.selectedCols) {
          cells.push({ row: r, col: c });
        }
      }
      return cells;
    }
    if (!selection.anchor || !selection.focus) return [];
    return cellsInRange(selection.anchor, selection.focus);
  }, [selection]);

  const getSelectionValues = useCallback((): string[][] => {
    const table = tableRef.current;
    if (!table) return [];
    const cells = getSelectedCells();
    if (cells.length === 0) return [];

    // Determine bounds
    const rows = [...new Set(cells.map((c) => c.row))].sort((a, b) => a - b);
    const cols = [...new Set(cells.map((c) => c.col))].sort((a, b) => a - b);

    const tbody = table.querySelector('tbody');
    if (!tbody) return [];
    const trs = tbody.querySelectorAll('tr');

    const result: string[][] = [];
    for (const r of rows) {
      const tr = trs[r];
      if (!tr) continue;
      const tds = tr.querySelectorAll('td, th');
      const rowVals: string[] = [];
      for (const c of cols) {
        // Offset by 1 if row-number column exists (first td is row number)
        const td = tds[c + 1]; // +1 to skip row-number cell
        rowVals.push(td?.textContent?.trim() ?? '');
      }
      result.push(rowVals);
    }
    return result;
  }, [tableRef, getSelectedCells]);

  // Arrow key navigation
  const moveSelection = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      if (!selection.focus) return;
      const { row, col } = selection.focus;
      let newRow = row;
      let newCol = col;
      switch (direction) {
        case 'up':
          newRow = Math.max(0, row - 1);
          break;
        case 'down':
          newRow = Math.min(totalRowsRef.current - 1, row + 1);
          break;
        case 'left':
          newCol = Math.max(0, col - 1);
          break;
        case 'right':
          newCol = Math.min(totalColsRef.current - 1, col + 1);
          break;
      }
      setSelection({
        type: 'cell',
        anchor: { row: newRow, col: newCol },
        focus: { row: newRow, col: newCol },
        isFullRow: false,
        isFullColumn: false,
        selectedRows: [],
        selectedCols: [],
      });
    },
    [selection.focus]
  );

  return {
    selection,
    clearSelection,
    onCellClick,
    onRowHeaderClick,
    onColumnHeaderClick,
    isCellSelected,
    getSelectedCells,
    getSelectionValues,
    moveSelection,
    setTableDimensions,
  };
}
