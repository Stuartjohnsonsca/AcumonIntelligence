'use client';

import { useEffect, useCallback, useRef } from 'react';
import { useKeyboardShortcutContext } from '@/components/ui/KeyboardShortcutProvider';
import { useToast } from '@/components/ui/use-toast';
import type { ShortcutActions, SelectionState } from '@/lib/keyboard-shortcuts';
import type { useTableSelection } from './useTableSelection';

type TableSelectionReturn = ReturnType<typeof useTableSelection>;

/**
 * Hook to wire a table component's selection and actions into the keyboard shortcut manager.
 * Call this in each table component that should respond to keyboard shortcuts.
 */
export function useKeyboardShortcuts(
  scopeId: string,
  {
    tableSelection,
    onDeleteRows,
    onDeleteColumns,
  }: {
    tableSelection: TableSelectionReturn;
    onDeleteRows?: (rowIndices: number[]) => void;
    onDeleteColumns?: (colIndices: number[]) => void;
  }
) {
  const { registerScope, unregisterScope } = useKeyboardShortcutContext();
  const { toast } = useToast();
  const selectionRef = useRef(tableSelection);
  selectionRef.current = tableSelection;

  const showPlaceholder = useCallback(
    (label: string) => {
      toast({
        title: label,
        description: 'This feature is not yet implemented.',
      });
    },
    [toast]
  );

  const copySelection = useCallback(async () => {
    const values = selectionRef.current.getSelectionValues();
    if (values.length === 0) {
      toast({ title: 'Nothing to copy', description: 'Select cells first.' });
      return;
    }
    const text = values.map((row) => row.join('\t')).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Copied', description: `${values.flat().length} cell(s) copied to clipboard.` });
    } catch {
      toast({ title: 'Copy failed', description: 'Clipboard access denied.' });
    }
  }, [toast]);

  const pasteToSelection = useCallback(async () => {
    toast({
      title: 'Paste',
      description: 'Table is read-only. Paste is not supported here.',
    });
  }, [toast]);

  const deleteSelectedRows = useCallback(() => {
    const sel = selectionRef.current.selection;
    if (!sel.isFullRow || sel.selectedRows.length === 0) {
      toast({ title: 'Delete Row', description: 'Select a full row first (click row number).' });
      return;
    }
    if (onDeleteRows) {
      onDeleteRows(sel.selectedRows);
      selectionRef.current.clearSelection();
      toast({
        title: 'Rows Deleted',
        description: `${sel.selectedRows.length} row(s) removed.`,
      });
    } else {
      showPlaceholder('Delete Row');
    }
  }, [onDeleteRows, toast, showPlaceholder]);

  const deleteSelectedColumns = useCallback(() => {
    if (onDeleteColumns) {
      const sel = selectionRef.current.selection;
      onDeleteColumns(sel.selectedCols);
    } else {
      toast({
        title: 'Delete Column',
        description: 'Columns have a fixed schema and cannot be deleted.',
      });
    }
  }, [onDeleteColumns, toast]);

  const sumSelection = useCallback(() => {
    const values = selectionRef.current.getSelectionValues();
    if (values.length === 0) {
      toast({ title: 'Sum', description: 'Select cells first.' });
      return;
    }

    let sum = 0;
    let count = 0;
    for (const row of values) {
      for (const cell of row) {
        // Strip currency symbols and parse
        const cleaned = cell.replace(/[£$€,\s]/g, '').replace(/[()]/g, (m) => (m === '(' ? '-' : ''));
        const num = parseFloat(cleaned);
        if (!isNaN(num)) {
          sum += num;
          count++;
        }
      }
    }

    if (count === 0) {
      toast({ title: 'Sum', description: 'No numeric values in selection.' });
    } else {
      const formatted = new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: 'GBP',
      }).format(sum);
      toast({
        title: `Sum: ${formatted}`,
        description: `${count} numeric value(s) summed.`,
      });
    }
  }, [toast]);

  // Build the actions object
  const actionsRef = useRef<ShortcutActions>({
    copySelection,
    pasteToSelection,
    deleteSelectedRows,
    deleteSelectedColumns,
    sumSelection,
    showPlaceholder,
  });

  // Keep ref updated
  actionsRef.current = {
    copySelection,
    pasteToSelection,
    deleteSelectedRows,
    deleteSelectedColumns,
    sumSelection,
    showPlaceholder,
  };

  // Build the selection state getter
  const getSelection = useCallback((): SelectionState => {
    const sel = selectionRef.current.selection;
    return {
      type: sel.type,
      cells: selectionRef.current.getSelectedCells(),
      isFullRow: sel.isFullRow,
      isFullColumn: sel.isFullColumn,
      selectedRows: sel.selectedRows,
      selectedCols: sel.selectedCols,
      getValues: () => selectionRef.current.getSelectionValues(),
    };
  }, []);

  // Register with the provider
  useEffect(() => {
    registerScope(scopeId, {
      actions: new Proxy({} as ShortcutActions, {
        get(_target, prop: string) {
          return (actionsRef.current as unknown as Record<string, unknown>)[prop];
        },
      }),
      getSelection,
    });

    return () => {
      unregisterScope(scopeId);
    };
  }, [scopeId, registerScope, unregisterScope, getSelection]);

  // Handle arrow key navigation and Escape
  useEffect(() => {
    function handleNav(e: KeyboardEvent) {
      const activeEl = document.activeElement as HTMLElement;
      const scopeEl = activeEl?.closest?.('[data-kb-scope]');
      if (!scopeEl || scopeEl.getAttribute('data-kb-scope-id') !== scopeId) return;

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          selectionRef.current.moveSelection('up');
          break;
        case 'ArrowDown':
          e.preventDefault();
          selectionRef.current.moveSelection('down');
          break;
        case 'ArrowLeft':
          e.preventDefault();
          selectionRef.current.moveSelection('left');
          break;
        case 'ArrowRight':
          e.preventDefault();
          selectionRef.current.moveSelection('right');
          break;
        case 'Escape':
          selectionRef.current.clearSelection();
          break;
      }
    }

    document.addEventListener('keydown', handleNav);
    return () => document.removeEventListener('keydown', handleNav);
  }, [scopeId]);
}
