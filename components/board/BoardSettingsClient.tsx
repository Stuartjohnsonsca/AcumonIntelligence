'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Trash2,
  GripVertical,
  ChevronRight,
  ChevronDown,
  Save,
  Loader2,
  ArrowLeft,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface TemplateItem {
  id: string;
  title: string;
  sortOrder: number;
  children: TemplateItem[];
}

export function BoardSettingsClient() {
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [addingParentId, setAddingParentId] = useState<string | null | 'root'>(null);
  const [newItemTitle, setNewItemTitle] = useState('');

  let nextTempId = 0;
  function generateTempId() {
    nextTempId++;
    return `temp-${Date.now()}-${nextTempId}`;
  }

  const fetchTemplate = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/board/settings/agenda-template');
      if (!res.ok) throw new Error('Failed to load template');
      const data = await res.json();
      setItems(data.items || []);
      // expand all
      const ids = new Set<string>();
      function collect(list: TemplateItem[]) {
        for (const item of list) {
          if (item.children?.length > 0) {
            ids.add(item.id);
            collect(item.children);
          }
        }
      }
      collect(data.items || []);
      setExpandedIds(ids);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load template');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplate();
  }, [fetchTemplate]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addItem(parentId: string | null) {
    if (!newItemTitle.trim()) return;
    const newItem: TemplateItem = {
      id: generateTempId(),
      title: newItemTitle.trim(),
      sortOrder: 0,
      children: [],
    };

    if (parentId === null) {
      setItems((prev) => {
        const updated = [...prev, { ...newItem, sortOrder: prev.length }];
        return updated;
      });
    } else {
      setItems((prev) => insertChild(prev, parentId, newItem));
    }

    setNewItemTitle('');
    setAddingParentId(null);
  }

  function insertChild(list: TemplateItem[], parentId: string, child: TemplateItem): TemplateItem[] {
    return list.map((item) => {
      if (item.id === parentId) {
        return {
          ...item,
          children: [...item.children, { ...child, sortOrder: item.children.length }],
        };
      }
      if (item.children.length > 0) {
        return { ...item, children: insertChild(item.children, parentId, child) };
      }
      return item;
    });
  }

  function updateItemTitle(list: TemplateItem[], itemId: string, title: string): TemplateItem[] {
    return list.map((item) => {
      if (item.id === itemId) return { ...item, title };
      if (item.children.length > 0) {
        return { ...item, children: updateItemTitle(item.children, itemId, title) };
      }
      return item;
    });
  }

  function removeItem(list: TemplateItem[], itemId: string): TemplateItem[] {
    return list
      .filter((item) => item.id !== itemId)
      .map((item) => ({
        ...item,
        children: removeItem(item.children, itemId),
      }));
  }

  function handleEditSave(itemId: string) {
    if (editTitle.trim()) {
      setItems((prev) => updateItemTitle(prev, itemId, editTitle.trim()));
    }
    setEditingId(null);
  }

  function handleDelete(itemId: string) {
    setItems((prev) => removeItem(prev, itemId));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch('/api/board/settings/agenda-template', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error('Failed to save template');
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      await fetchTemplate();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function renderItem(item: TemplateItem, depth: number) {
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedIds.has(item.id);
    const isEditing = editingId === item.id;

    return (
      <div key={item.id}>
        <div
          className="flex items-center gap-1 py-1.5 px-2 rounded-md group hover:bg-slate-50 transition-colors"
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
        >
          <GripVertical className="h-4 w-4 text-slate-300 flex-shrink-0 opacity-0 group-hover:opacity-100 cursor-grab" />

          {hasChildren ? (
            <button
              onClick={() => toggleExpand(item.id)}
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

          {isEditing ? (
            <Input
              className="h-7 text-sm flex-1"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={() => handleEditSave(item.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleEditSave(item.id);
                if (e.key === 'Escape') setEditingId(null);
              }}
              autoFocus
            />
          ) : (
            <span
              className="flex-1 text-sm text-slate-800 truncate cursor-pointer"
              onDoubleClick={() => {
                setEditingId(item.id);
                setEditTitle(item.title);
              }}
            >
              {item.title}
            </span>
          )}

          <button
            onClick={() => {
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
            onClick={() => handleDelete(item.id)}
            className="p-0.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Delete item"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {addingParentId === item.id && (
          <div className="flex items-center gap-2 py-1 px-2" style={{ paddingLeft: `${(depth + 1) * 20 + 8}px` }}>
            <Input
              className="h-7 text-sm flex-1"
              placeholder="Sub-item title..."
              value={newItemTitle}
              onChange={(e) => setNewItemTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addItem(item.id);
                if (e.key === 'Escape') setAddingParentId(null);
              }}
              autoFocus
            />
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => addItem(item.id)}>
              Add
            </Button>
          </div>
        )}

        {hasChildren && isExpanded && item.children.map((child) => renderItem(child, depth + 1))}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading template...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/tools/board"
        className="inline-flex items-center text-sm text-slate-500 hover:text-slate-700 transition-colors"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to Board
      </Link>

      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Default Agenda Template</h2>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Save Template
          </Button>
        </div>

        <p className="text-sm text-slate-500 mb-4">
          Define a default agenda structure that will be used as a starting point when creating new meetings.
          Double-click an item to rename it.
        </p>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">
            {error}
          </div>
        )}

        {success && (
          <div className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-md p-3 mb-4">
            Template saved successfully.
          </div>
        )}

        <div className="space-y-1">
          {items.map((item) => renderItem(item, 0))}

          {addingParentId === 'root' ? (
            <div className="flex items-center gap-2 py-1 px-2">
              <Input
                className="h-7 text-sm flex-1"
                placeholder="Item title..."
                value={newItemTitle}
                onChange={(e) => setNewItemTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addItem(null);
                  if (e.key === 'Escape') setAddingParentId(null);
                }}
                autoFocus
              />
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => addItem(null)}>
                Add
              </Button>
            </div>
          ) : (
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
          )}
        </div>
      </div>
    </div>
  );
}
