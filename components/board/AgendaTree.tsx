'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  GripVertical,
  Trash2,
  FileText,
  Paperclip,
  ChevronRight,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AgendaItem {
  id: string;
  title: string;
  sortOrder: number;
  parentId: string | null;
  hasNotes: boolean;
  attachmentCount: number;
  children: AgendaItem[];
}

interface AgendaTreeProps {
  meetingId: string;
  readOnly?: boolean;
  onSelectItem?: (itemId: string) => void;
  selectedItemId?: string | null;
}

export function AgendaTree({ meetingId, readOnly, onSelectItem, selectedItemId }: AgendaTreeProps) {
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [addingParentId, setAddingParentId] = useState<string | null | 'root'>( null);
  const [newItemTitle, setNewItemTitle] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/board/meetings/${meetingId}/agenda`);
      if (!res.ok) throw new Error('Failed to load agenda');
      const data = await res.json();
      setItems(data.items || []);
      // auto-expand all parents
      const parentIds = new Set<string>();
      function collectParents(list: AgendaItem[]) {
        for (const item of list) {
          if (item.children && item.children.length > 0) {
            parentIds.add(item.id);
            collectParents(item.children);
          }
        }
      }
      collectParents(data.items || []);
      setExpandedIds(parentIds);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load agenda');
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAddItem(parentId: string | null) {
    if (!newItemTitle.trim()) return;
    try {
      const res = await fetch(`/api/board/meetings/${meetingId}/agenda`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newItemTitle.trim(), parentId }),
      });
      if (!res.ok) throw new Error('Failed to add item');
      setNewItemTitle('');
      setAddingParentId(null);
      await fetchItems();
    } catch {
      // silently fail for now
    }
  }

  async function handleUpdateTitle(itemId: string) {
    if (!editTitle.trim()) {
      setEditingId(null);
      return;
    }
    try {
      await fetch(`/api/board/meetings/${meetingId}/agenda/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle.trim() }),
      });
      await fetchItems();
    } catch {
      // silently fail
    } finally {
      setEditingId(null);
    }
  }

  async function handleDelete(itemId: string) {
    try {
      await fetch(`/api/board/meetings/${meetingId}/agenda/${itemId}`, {
        method: 'DELETE',
      });
      await fetchItems();
    } catch {
      // silently fail
    }
  }

  async function handleDrop(targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    try {
      await fetch(`/api/board/meetings/${meetingId}/agenda/${draggedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ afterItemId: targetId }),
      });
      await fetchItems();
    } catch {
      // silently fail
    } finally {
      setDraggedId(null);
    }
  }

  function renderItem(item: AgendaItem, depth: number) {
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedIds.has(item.id);
    const isSelected = selectedItemId === item.id;
    const isEditing = editingId === item.id;

    return (
      <div key={item.id}>
        <div
          className={`flex items-center gap-1 py-1.5 px-2 rounded-md group transition-colors cursor-pointer ${
            isSelected ? 'bg-blue-50 border border-blue-200' : 'hover:bg-slate-50 border border-transparent'
          }`}
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
          draggable={!readOnly}
          onDragStart={() => setDraggedId(item.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleDrop(item.id)}
          onClick={() => onSelectItem?.(item.id)}
        >
          {!readOnly && (
            <GripVertical className="h-4 w-4 text-slate-300 flex-shrink-0 opacity-0 group-hover:opacity-100 cursor-grab" />
          )}

          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(item.id);
              }}
              className="p-0.5 rounded hover:bg-slate-200 flex-shrink-0"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-slate-500" />
              ) : (
                <ChevronRight className="h-4 w-4 text-slate-500" />
              )}
            </button>
          ) : (
            <span className="w-5 flex-shrink-0" />
          )}

          {isEditing && !readOnly ? (
            <Input
              className="h-7 text-sm flex-1"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={() => handleUpdateTitle(item.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleUpdateTitle(item.id);
                if (e.key === 'Escape') setEditingId(null);
              }}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="flex-1 text-sm text-slate-800 truncate"
              onDoubleClick={() => {
                if (!readOnly) {
                  setEditingId(item.id);
                  setEditTitle(item.title);
                }
              }}
            >
              {item.title}
            </span>
          )}

          <div className="flex items-center gap-1 flex-shrink-0">
            {item.hasNotes && (
              <FileText className="h-3.5 w-3.5 text-blue-400" title="Has notes" />
            )}
            {item.attachmentCount > 0 && (
              <span className="inline-flex items-center text-xs text-slate-500" title={`${item.attachmentCount} attachment(s)`}>
                <Paperclip className="h-3.5 w-3.5 mr-0.5" />
                {item.attachmentCount}
              </span>
            )}
            {!readOnly && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setAddingParentId(item.id);
                    setNewItemTitle('');
                    setExpandedIds((prev) => new Set([...prev, item.id]));
                  }}
                  className="p-0.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Add sub-item"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(item.id);
                  }}
                  className="p-0.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete item"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Inline add sub-item */}
        {addingParentId === item.id && !readOnly && (
          <div className="flex items-center gap-2 py-1 px-2" style={{ paddingLeft: `${(depth + 1) * 20 + 8}px` }}>
            <Input
              className="h-7 text-sm flex-1"
              placeholder="Sub-item title..."
              value={newItemTitle}
              onChange={(e) => setNewItemTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddItem(item.id);
                if (e.key === 'Escape') setAddingParentId(null);
              }}
              autoFocus
            />
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => handleAddItem(item.id)}>
              Add
            </Button>
          </div>
        )}

        {/* Children */}
        {hasChildren && isExpanded && item.children.map((child) => renderItem(child, depth + 1))}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading agenda...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
    );
  }

  return (
    <div className="space-y-1">
      {items.map((item) => renderItem(item, 0))}

      {/* Add root item */}
      {addingParentId === 'root' && !readOnly ? (
        <div className="flex items-center gap-2 py-1 px-2">
          <Input
            className="h-7 text-sm flex-1"
            placeholder="Item title..."
            value={newItemTitle}
            onChange={(e) => setNewItemTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddItem(null);
              if (e.key === 'Escape') setAddingParentId(null);
            }}
            autoFocus
          />
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => handleAddItem(null)}>
            Add
          </Button>
        </div>
      ) : (
        !readOnly && (
          <Button
            variant="ghost"
            size="sm"
            className="text-slate-500 hover:text-blue-600"
            onClick={() => {
              setAddingParentId('root');
              setNewItemTitle('');
            }}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add item
          </Button>
        )
      )}
    </div>
  );
}
