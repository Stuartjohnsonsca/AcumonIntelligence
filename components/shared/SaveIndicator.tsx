'use client';

import { useState, useEffect } from 'react';
import { Cloud, CloudOff, Loader2, Check } from 'lucide-react';
import { getAutoSaveState } from '@/lib/stores/auto-save';

interface Props {
  idbKey: string;
  pollMs?: number;
}

/**
 * Subtle save status indicator.
 * Shows: saving spinner, saved checkmark, error warning, or offline icon.
 */
export function SaveIndicator({ idbKey, pollMs = 1000 }: Props) {
  const [state, setState] = useState({ isDirty: false, isSaving: false, lastSavedAt: null as number | null, lastError: null as string | null });

  useEffect(() => {
    const interval = setInterval(() => {
      const s = getAutoSaveState(idbKey);
      setState(s);
    }, pollMs);
    return () => clearInterval(interval);
  }, [idbKey, pollMs]);

  if (state.isSaving) {
    return (
      <div className="flex items-center gap-1 text-blue-500" title="Saving...">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span className="text-[10px]">Saving</span>
      </div>
    );
  }

  if (state.lastError) {
    return (
      <div className="flex items-center gap-1 text-red-500" title={state.lastError}>
        <CloudOff className="h-3.5 w-3.5" />
        <span className="text-[10px]">Save failed</span>
      </div>
    );
  }

  if (state.isDirty) {
    return (
      <div className="flex items-center gap-1 text-amber-500" title="Unsaved changes">
        <Cloud className="h-3.5 w-3.5" />
        <span className="text-[10px]">Unsaved</span>
      </div>
    );
  }

  if (state.lastSavedAt) {
    const ago = Math.round((Date.now() - state.lastSavedAt) / 1000);
    const label = ago < 5 ? 'Just saved' : ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`;
    return (
      <div className="flex items-center gap-1 text-green-500" title={`Last saved ${label}`}>
        <Check className="h-3.5 w-3.5" />
        <span className="text-[10px]">{label}</span>
      </div>
    );
  }

  return null;
}
